const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');
const { performance } = require('node:perf_hooks');
const MAX_OWNERS = 256;
function unknown(reason) { return { status: 'unknown', reason, rows: new Map(), observedAt: performance.now() }; }
function readSnapshot({ remainingMs, selfPid = process.pid, run = cp.spawnSync } = {}) {
  if (!Number.isFinite(remainingMs) || remainingMs < 100) return unknown('inspection_budget');
  const observedAt = performance.now();
  let result;
  try { result = run('ps', ['-axo', 'pid=,ppid=,pgid=,rss=,lstart='], { encoding: 'utf8', env: { ...process.env, LC_ALL: 'C' }, timeout: Math.min(1000, Math.floor(remainingMs - 50)), maxBuffer: 8 * 1024 * 1024 }); } catch { return unknown('inspection_failed'); }
  if (result.error || result.status !== 0 || result.signal || typeof result.stdout !== 'string') return unknown('inspection_failed');
  const lines = result.stdout.split('\n').filter(line => line.trim());
  if (!lines.length || lines.length > 16384) return unknown('inspection_incomplete');
  const rows = new Map();
  for (const line of lines) {
    const match = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+([A-Za-z]{3} [A-Za-z]{3}\s+\d{1,2} \d{2}:\d{2}:\d{2} \d{4})\s*$/u.exec(line);
    if (!match) return unknown('inspection_malformed');
    const [pid, ppid, pgid, rss] = match.slice(1, 5).map(Number);
    if (!Number.isSafeInteger(pid) || pid < 1 || rows.has(pid)) return unknown('inspection_malformed');
    rows.set(pid, { pid, ppid, pgid, rss: rss * 1024, start: match[5] });
  }
  if (!rows.has(selfPid)) return unknown('inspection_missing_self');
  return { status: 'ok', rows, observedAt };
}
class Ownership {
  constructor(selfPid = process.pid) { this.selfPid = selfPid; this.records = new Map(); this.handles = new Map(); this.groups = new Map(); this.unknownGroups = []; }
  capture(pid, handle) {
    if (!Number.isSafeInteger(pid) || pid < 1 || this.records.size >= MAX_OWNERS) throw Error('ownership_capture_failed');
    // The actual handle is retained before the first fallible inspection.
    this.handles.set(pid, handle);
    this.records.set(pid, { pid, start: null, pgid: null, state: 'pending' });
  }
  bind(pid, snapshot) {
    const record = this.records.get(pid), handle = this.handles.get(pid);
    if (!record || snapshot.status !== 'ok') { if (record) record.captureUnknown = true; return false; }
    const row = snapshot.rows.get(pid);
    if (!row) { record.captureUnknown = true; record.state = 'unknown'; return false; }
    if (row.ppid !== this.selfPid || handle?.pid !== pid || handle.exitCode !== null || handle.signalCode) { record.captureUnknown = true; return false; }
    Object.assign(record, { start: row.start, pgid: row.pgid, state: 'live' });
    if (row.pgid === pid) this.groups.set(pid, { leaderStart: row.start, state: 'live' });
    return true;
  }
  refresh(snapshot, discover = true) {
    if (snapshot.status !== 'ok') return { status: 'unknown', reason: snapshot.reason, live: [], remaining: [...this.records.keys()] };
    const live = new Map();
    for (const record of this.records.values()) {
      const row = snapshot.rows.get(record.pid);
      if (!row) { record.state = 'closed'; continue; }
      if (!record.start) { record.state = 'unknown'; continue; }
      if (row.start !== record.start || row.pgid !== record.pgid) { record.state = 'reused'; continue; }
      record.state = 'live'; live.set(record.pid, record);
    }
    this.unknownGroups = [];
    for (const [pgid, group] of this.groups) {
      if (group.state === 'retired') continue;
      const leader = snapshot.rows.get(pgid);
      if (leader && leader.start !== group.leaderStart) { group.state = 'retired'; group.reason = 'leader_identity_replaced'; continue; }
      if (!leader) {
        const members = [...snapshot.rows.values()].filter(row => row.pgid === pgid);
        if (!members.length) { group.state = 'retired'; group.reason = 'verified_empty'; }
        else { group.state = 'uncertain'; if (members.some(row => !live.has(row.pid))) this.unknownGroups.push(pgid); }
      } else group.state = live.has(pgid) ? 'live' : 'uncertain';
    }
    if (discover) {
      let changed = true;
      while (changed) {
        changed = false;
        for (const row of snapshot.rows.values()) {
          if (row.pid === this.selfPid || this.records.has(row.pid)) continue;
          const parent = live.get(row.ppid), parentRow = snapshot.rows.get(row.ppid);
          const group = this.groups.get(row.pgid), leader = live.get(row.pgid), leaderRow = snapshot.rows.get(row.pgid);
          const parentSeed = parent && parentRow?.start === parent.start;
          const groupSeed = group?.state === 'live' && leader && leaderRow?.start === leader.start && leader.start === group.leaderStart;
          if (!parentSeed && !groupSeed) continue;
          if (this.records.size >= MAX_OWNERS) return { status: 'unknown', reason: 'owner_limit', live: [...live.values()], remaining: [...this.records.keys()] };
          const record = { pid: row.pid, start: row.start, pgid: row.pgid, state: 'live' }; this.records.set(row.pid, record); live.set(row.pid, record); changed = true;
        }
      }
    }
    const uncertain = [...this.records.values()].filter(record => record.captureUnknown || record.state === 'unknown' || record.state === 'pending');
    return { status: uncertain.length || this.unknownGroups.length ? 'unknown' : 'ok', reason: uncertain.length ? 'unbound_identity' : this.unknownGroups.length ? 'unowned_group_survivor' : null, live: [...live.values()], remaining: [...live.keys()], unknownGroups: this.unknownGroups.slice() };
  }
  signalPlan(snapshot, remainingMs) {
    if (remainingMs < 100 || snapshot.status !== 'ok' || performance.now() - snapshot.observedAt > 250) return { status: 'unknown', pids: [] };
    const state = this.refresh(snapshot);
    if (state.status === 'unknown') return { status: 'unknown', pids: [] };
    return { status: 'ok', pids: state.live.map(record => record.pid) };
  }
  closure(snapshot) { const state = this.refresh(snapshot); return { verified: state.status === 'ok' && state.live.length === 0, status: state.status, remainingOwnedPids: state.remaining, unknownGroups: state.unknownGroups || [], reason: state.reason }; }
  evidence() { return [...this.records.values()].map(({ pid, start, pgid, state, captureUnknown }) => ({ pid, start, pgid, state, captureUnknown: Boolean(captureUnknown) })); }
}
function createRuntime(output, onCreated = () => {}) {
  const runtime = fs.mkdtempSync(path.join(output, 'runtime-')); const result = { path: runtime, parent: output }; onCreated(result); fs.chmodSync(runtime, 0o700);
  const directories = Object.fromEntries(['tmp', 'config', 'cache', 'data', 'run', 'downloads', 'traces'].map(name => { const value = path.join(runtime, name); fs.mkdirSync(value, { mode: 0o700 }); return [name, value]; }));
  const identity = fs.lstatSync(runtime); const nonce = require('node:crypto').randomUUID(); fs.writeFileSync(path.join(runtime, '.owner'), nonce, { mode: 0o600 });
  return Object.assign(result, { device: identity.dev, inode: identity.ino, nonce, path: runtime, parent: fs.realpathSync(output), directories, env: { TMPDIR: directories.tmp, TMP: directories.tmp, TEMP: directories.tmp, XDG_CONFIG_HOME: directories.config, XDG_CACHE_HOME: directories.cache, XDG_DATA_HOME: directories.data, XDG_RUNTIME_DIR: directories.run } });
}
function runtimeRemovable(runtime, closure) { try { return closure.verified === true && fs.lstatSync(runtime.path).dev === runtime.device && fs.lstatSync(runtime.path).ino === runtime.inode && fs.readFileSync(path.join(runtime.path, '.owner'), 'utf8') === runtime.nonce && fs.realpathSync(path.dirname(runtime.path)) === runtime.parent && path.basename(runtime.path).startsWith('runtime-') && !fs.lstatSync(runtime.path).isSymbolicLink(); } catch { return false; } }
module.exports = { readSnapshot, Ownership, createRuntime, runtimeRemovable };
