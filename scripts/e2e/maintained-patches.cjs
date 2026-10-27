'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');

// This source boundary accepts pnpm's scalar patchedDependencies map only. Refuse
// richer YAML rather than guessing which local files an install would consume.
function patchMap(raw) {
  const lines = raw.toString('utf8').split(/\r?\n/u);
  if (lines.some((line) => line.trim() && !/^(?:[ \t#]|[A-Za-z][A-Za-z0-9_-]*:)/u.test(line)))
    throw new Error('Unsupported pnpm source mapping key.');
  const starts = lines.flatMap((line, index) =>
    /^patchedDependencies:/u.test(line) ? [index] : [],
  );
  if (
    lines.some((line) =>
      /^(?:['"]patchedDependencies['"]|[ \t]+patchedDependencies|patchedDependencies[ \t]+)\s*:/u.test(
        line,
      ),
    )
  )
    throw new Error('Unsupported maintained patch map.');
  if (!starts.length) return {};
  if (starts.length !== 1) throw new Error('Duplicate maintained patch map.');
  const start = starts[0];
  if (/^patchedDependencies:\s*\{\}\s*$/u.test(lines[start])) return {};
  if (!/^patchedDependencies:\s*(?:#.*)?$/u.test(lines[start]))
    throw new Error('Unsupported maintained patch map.');
  const result = {};
  const scalar = (value) => {
    if (/^'[^']*'$/u.test(value)) return value.slice(1, -1);
    if (/^"[^"\\]*"$/u.test(value)) return JSON.parse(value);
    if (/^[A-Za-z0-9@_./+-]+$/u.test(value)) return value;
    throw new Error('Unsupported maintained patch scalar.');
  };
  for (const line of lines.slice(start + 1)) {
    if (!line.trim() || /^\s*#/u.test(line)) continue;
    if (/^\S/u.test(line)) break;
    const match = /^ {2}('[^']*'|"[^"\\]*"|[^\s:]+):\s+(.+?)\s*$/u.exec(line);
    if (!match) throw new Error('Unsupported maintained patch entry.');
    const key = scalar(match[1]);
    if (Object.hasOwn(result, key)) throw new Error('Duplicate maintained patch entry.');
    Object.defineProperty(result, key, { value: scalar(match[2]), enumerable: true });
  }
  return result;
}

function regularFile(root, relativePath) {
  const parts = relativePath.split('/');
  let current = root;
  for (const [index, part] of parts.entries()) {
    current = path.join(current, part);
    const entry = fs.lstatSync(current);
    if (
      entry.isSymbolicLink() ||
      (index === parts.length - 1 ? !entry.isFile() : !entry.isDirectory())
    )
      throw new Error('Maintained patch source must be a regular file in patches/.');
  }
  return fs.readFileSync(current);
}

function maintainedPatchIdentity({ workspaceRaw, lockRaw, readFile }) {
  const declared = patchMap(workspaceRaw);
  const locked = patchMap(lockRaw);
  if (JSON.stringify(Object.keys(declared).sort()) !== JSON.stringify(Object.keys(locked).sort()))
    throw new Error('Maintained patch declarations and lock disagree.');
  const files = [];
  const entries = Object.keys(declared)
    .sort()
    .map((packageName) => {
      const relativePath = declared[packageName];
      if (
        !/^patches\/(?:[A-Za-z0-9@_+.-]+\/)*[A-Za-z0-9@_+.-]+\.patch$/u.test(relativePath) ||
        relativePath.split('/').some((part) => part === '.' || part === '..')
      )
        throw new Error('Maintained patch path must stay in patches/.');
      const raw = readFile(relativePath);
      const digest = sha256(raw);
      if (!/^[a-f0-9]{64}$/u.test(locked[packageName]) || locked[packageName] !== digest)
        throw new Error('Maintained patch source digest disagrees with the lock.');
      files.push({ path: relativePath, raw });
      return { package: packageName, path: relativePath, sha256: digest };
    });
  return { entries, files, sha256: patchInventorySha256(entries) };
}

function patchInventorySha256(entries) {
  return sha256(`${JSON.stringify(entries)}\n`);
}

function readMaintainedPatches(root) {
  return maintainedPatchIdentity({
    workspaceRaw: fs.readFileSync(path.join(root, 'pnpm-workspace.yaml')),
    lockRaw: fs.readFileSync(path.join(root, 'pnpm-lock.yaml')),
    readFile: (relativePath) => regularFile(root, relativePath),
  });
}

function verifyMaintainedPatches(root, expectedEntries, expectedSha256) {
  const actual = readMaintainedPatches(root);
  if (
    !Array.isArray(expectedEntries) ||
    JSON.stringify(actual.entries) !== JSON.stringify(expectedEntries) ||
    actual.sha256 !== expectedSha256
  )
    throw new Error('Candidate maintained patch identity mismatch.');
  return actual;
}

module.exports = {
  maintainedPatchIdentity,
  patchInventorySha256,
  readMaintainedPatches,
  regularFile,
  verifyMaintainedPatches,
};
