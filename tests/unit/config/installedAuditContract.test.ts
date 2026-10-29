import { spawnSync } from 'node:child_process';
import path from 'node:path';

const repositoryRoot = path.resolve(__dirname, '../../..');

// Native resolution exercises installed dependency bytes outside Jest's mappers.
// Each child owns bounded loopback/worker/temp fixtures and verifies their closure.
describe('installed compatible security dependency contracts', () => {
  it.each([
    ['installedAuditSecurity.contract.cjs', 14],
    ['installedAuditWorkers.contract.cjs', 6],
    ['installedAuditHttp.contract.cjs', 6],
    ['installedAuditCache.contract.cjs', 7],
  ])('%s verifies its actual consumers and releases owned resources', (file, count) => {
    const result = spawnSync(
      process.execPath,
      ['--test', path.join(repositoryRoot, 'tests/package-contracts', file)],
      { cwd: repositoryRoot, encoding: 'utf8', timeout: 20_000 },
    );
    expect({
      error: result.error?.message,
      signal: result.signal,
      status: result.status,
      diagnostic: result.status === 0 ? '' : result.stderr + result.stdout,
    }).toEqual({
      error: undefined,
      signal: null,
      status: 0,
      diagnostic: '',
    });
    expect(result.stdout).toMatch(new RegExp('(?:#|ℹ) pass ' + count + '(?:\\s|$)', 'u'));
  });
});
