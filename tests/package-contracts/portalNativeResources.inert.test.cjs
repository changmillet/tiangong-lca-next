const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { performance } = require('node:perf_hooks');
const { readSnapshot, Ownership, createRuntime, runtimeRemovable } = require('../../scripts/e2e/portal-native-resources.cjs');
const self = { pid: 42, ppid: 1, pgid: 42, rss: 1, start: 'self' };
const row = (pid, ppid, pgid, start) => ({ pid, ppid, pgid, start, rss: 10 });
const snapshot = rows => ({ status: 'ok', rows: new Map([self, ...rows].map(value => [value.pid, value])), observedAt: performance.now() });
const registry = () => { const value = new Ownership(42); value.capture(10, { pid: 10, exitCode: null, signalCode: null }); assert.equal(value.bind(10, snapshot([row(10, 42, 10, 'owner')])), true); return value; };
test('inspection failure and missing inventory are unknown, never absence', () => {
  for (const run of [() => ({ status: 1, stdout: '' }), () => ({ status: 0, stdout: '' }), () => { throw Error('inert inspection failure'); }]) assert.equal(readSnapshot({ remainingMs: 1000, selfPid: 42, run }).status, 'unknown');
  assert.equal(readSnapshot({ remainingMs: 0 }).status, 'unknown');
});
test('a complete bounded snapshot distinguishes verified PID absence', () => {
  const value = readSnapshot({ remainingMs: 1000, selfPid: 42, run: () => ({ status: 0, stdout: '42 1 42 1 Tue Oct 27 12:00:00 2026\n' }) });
  assert.equal(value.status, 'ok'); assert.equal(value.rows.has(10), false);
});
test('stale PID and PGID identities never seed adoption or synthetic foreign signals', () => {
  const value = registry(); value.refresh(snapshot([row(10, 42, 10, 'owner'), row(11, 10, 10, 'child')]));
  const foreign = snapshot([row(10, 99, 10, 'foreign'), row(11, 10, 10, 'foreign-child'), row(12, 10, 10, 'foreign-new')]);
  value.refresh(foreign); assert.equal(value.records.has(12), false); assert.deepEqual(value.signalPlan(foreign, 1000).pids, []); assert.equal(value.groups.get(10).state, 'retired');
});
test('a fresh known parent permits only current-snapshot descendants', () => {
  const value = registry(); const current = snapshot([row(10, 42, 10, 'owner'), row(11, 10, 10, 'child'), row(12, 11, 10, 'grandchild')]); value.refresh(current); assert.deepEqual(value.signalPlan(current, 1000).pids.sort((a, b) => a - b), [10, 11, 12]);
});
test('closed leaders cannot seed unknown group remnants; empty groups retire', () => {
  const value = registry(); const remnant = snapshot([row(12, 1, 10, 'unproved')]); assert.equal(value.closure(remnant).verified, false); assert.equal(value.records.has(12), false); assert.equal(value.closure(snapshot([])).verified, true); assert.equal(value.groups.get(10).reason, 'verified_empty'); value.refresh(remnant); assert.equal(value.records.has(12), false);
});
test('failed final inspection fails closure and signals nothing', () => {
  const value = registry(), unknown = { status: 'unknown', reason: 'inert', rows: new Map(), observedAt: performance.now() }; assert.equal(value.closure(unknown).verified, false); assert.deepEqual(value.signalPlan(unknown, 1000).pids, []);
});
test('an unbound first-launch identity stays unknown even after apparent absence', () => {
  const value = new Ownership(42); value.capture(10, { pid: 10, exitCode: null }); value.bind(10, { status: 'unknown' }); assert.equal(value.closure(snapshot([])).verified, false); assert.deepEqual(value.signalPlan(snapshot([]), 1000).pids, []);
});
test('expired snapshots and cleanup budget do not authorize signals', () => {
  const value = registry(), current = snapshot([row(10, 42, 10, 'owner')]); current.observedAt -= 1000; assert.deepEqual(value.signalPlan(current, 1000).pids, []); assert.deepEqual(value.signalPlan(snapshot([]), 0).pids, []);
});
test('owned runtime redirects temp/config/cache, retains on unknown cleanup, and is removed exactly', () => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'portal-inert-owner-')); let runtime;
  try { runtime = createRuntime(parent); assert.equal(runtime.env.TMPDIR, path.join(runtime.path, 'tmp')); assert.equal(runtime.env.XDG_CACHE_HOME, path.join(runtime.path, 'cache')); assert.equal(runtimeRemovable(runtime, { verified: false }), false); assert.equal(fs.existsSync(runtime.path), true); assert.equal(runtimeRemovable(runtime, { verified: true }), true); fs.rmSync(runtime.path, { recursive: true }); runtime = null; } finally { if (runtime && fs.existsSync(runtime.path)) fs.rmSync(runtime.path, { recursive: true }); fs.rmdirSync(parent); }
});
test('first-launch and cleanup failure controls preserve explicit retention and exact inert cleanup', () => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'portal-inert-failure-')); let runtime;
  try { runtime = createRuntime(parent); const value = new Ownership(42); let launchFailed = false, retained = true; try { throw Error('inert first-launch failure'); } catch { launchFailed = true; } assert.equal(launchFailed, true); const closure = value.closure(snapshot([])); assert.equal(runtimeRemovable(runtime, closure), true); try { throw Error('inert remove failure'); } catch { retained = true; } assert.equal(retained, true); assert.equal(fs.existsSync(runtime.path), true); fs.rmSync(runtime.path, { recursive: true }); runtime = null; } finally { if (runtime && fs.existsSync(runtime.path)) fs.rmSync(runtime.path, { recursive: true }); fs.rmdirSync(parent); }
});
test('runtime identity replacement is not removable', () => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'portal-inert-drift-')); const runtime = createRuntime(parent); try { fs.writeFileSync(path.join(runtime.path, '.owner'), 'foreign'); assert.equal(runtimeRemovable(runtime, { verified: true }), false); } finally { fs.rmSync(runtime.path, { recursive: true }); fs.rmdirSync(parent); }
});
