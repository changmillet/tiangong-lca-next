const {
  admit,
  SEMANTIC_MARKER_PREFIX,
} = require('../../../scripts/qualification/hotfix-semantic-admission.cjs');
const base = 'a'.repeat(40),
  head = 'b'.repeat(40),
  other = 'c'.repeat(40);
const hotfix = `<!-- tiangong-next-main-hotfix:v1 issue=1358 main-base=${base} candidate=${head} -->`;
const semantic = `<!-- ${SEMANTIC_MARKER_PREFIX} issue=1358 main-base=${base} candidate=${head} version=0.0.144 -->`;
function fixture() {
  const repo = { full_name: 'tiangong-lca/platform', id: 805297890, owner: { id: 327771381 } };
  return {
    root: '/synthetic',
    eventName: 'pull_request',
    repository: repo.full_name,
    expectedHead: head,
    dependencyResult: 'skipped',
    actionResult: 'skipped',
    event: {
      repository: repo,
      number: 7,
      pull_request: {
        number: 7,
        state: 'open',
        body: `${hotfix}\n${semantic}`,
        base: { ref: 'main', sha: base, repo: { ...repo, owner: { ...repo.owner } } },
        head: {
          ref: 'codex/hotfix-portal-escape-1358',
          sha: head,
          repo: { ...repo, owner: { ...repo.owner } },
        },
      },
    },
  };
}
function gitText(_root: string, args: string[]) {
  if (args.join(' ') === 'rev-parse HEAD') return head;
  if (args.join(' ') === 'rev-parse refs/remotes/origin/main') return base;
  if (args[0] === 'merge-base') return base;
  if (args[0] === 'show') return JSON.stringify({ version: '0.0.144' });
  throw Error('Unexpected Git request');
}
it('admits only a bound canonical opted-in Main hotfix with protected-job skips', () => {
  expect(admit(fixture(), { gitText })).toMatchObject({
    complete: true,
    kind: 'main-hotfix',
    head,
    mainBase: base,
    version: '0.0.144',
    issue: 1358,
  });
});
it.each(['dev', 'main'])(
  'retains ordinary %s admission only with both successful jobs',
  (target) => {
    const value = fixture();
    value.event.pull_request.base.ref = target;
    value.event.pull_request.head.ref = 'feature/example';
    value.event.pull_request.body = '';
    value.dependencyResult = value.actionResult = 'success';
    expect(admit(value, { gitText }).kind).toBe('ordinary');
    for (const status of ['failure', 'cancelled', 'skipped', 'unknown']) {
      expect(() => admit({ ...value, dependencyResult: status }, { gitText })).toThrow(
        'semantic_ordinary_dependencies_failed',
      );
      expect(() => admit({ ...value, actionResult: status }, { gitText })).toThrow(
        'semantic_ordinary_dependencies_failed',
      );
    }
  },
);
it.each([
  ['missing opt-in', hotfix],
  ['ambiguous hotfix line', `${hotfix} trailing -->\n${semantic}`],
  ['missing hotfix', semantic],
  ['duplicate opt-in', `${hotfix}\n${semantic}\n${semantic}`],
  ['duplicate hotfix', `${hotfix}\n${hotfix}\n${semantic}`],
  ['fenced', `${hotfix}\n\x60\x60\x60\n${semantic}\n\x60\x60\x60`],
  ['quoted', `${hotfix}\n> ${semantic}`],
  ['raw code', `${hotfix}\n<pre>\n${semantic}\n</pre>`],
  ['malformed', `${hotfix}\n${semantic.replace('version=0.0.144', 'version=latest')}`],
  ['stale semantic head', `${hotfix}\n${semantic.replace(head, other)}`],
  ['stale semantic base', `${hotfix}\n${semantic.replace(base, other)}`],
  ['stale version', `${hotfix}\n${semantic.replace('0.0.144', '0.0.145')}`],
  ['wrong issue', `${hotfix}\n${semantic.replace('1358', '1359')}`],
  ['stale hotfix head', `${hotfix.replace(head, other)}\n${semantic}`],
  ['stale hotfix base', `${hotfix.replace(base, other)}\n${semantic}`],
])('rejects %s before expensive work', (_label, body) => {
  const value = fixture();
  value.event.pull_request.body = body;
  expect(() => admit(value, { gitText })).toThrow();
});
it.each(['failure', 'cancelled', 'success', 'unknown'])(
  'rejects hotfix dependency status %s',
  (status) => {
    expect(() => admit({ ...fixture(), dependencyResult: status }, { gitText })).toThrow(
      'semantic_hotfix_dependencies_not_skipped',
    );
    expect(() => admit({ ...fixture(), actionResult: status }, { gitText })).toThrow(
      'semantic_hotfix_dependencies_not_skipped',
    );
  },
);
it('rejects foreign repositories, forks, unknown events and malformed PR identities', () => {
  let value = fixture();
  value.event.pull_request.head.repo.id++;
  expect(() => admit(value, { gitText })).toThrow('semantic_fork_or_unknown_repository');
  value = fixture();
  value.event.pull_request.base.repo.full_name = 'foreign/repo';
  expect(() => admit(value, { gitText })).toThrow('semantic_fork_or_unknown_repository');
  value = fixture();
  value.event.repository.owner.id++;
  expect(() => admit(value, { gitText })).toThrow('semantic_noncanonical_repository');
  expect(() => admit({ ...fixture(), eventName: 'push' }, { gitText })).toThrow(
    'semantic_unknown_event',
  );
  value = fixture();
  value.event.pull_request.head.sha = other;
  expect(() => admit(value, { gitText })).toThrow('semantic_pr_head_or_base_mismatch');
  value = fixture();
  value.event.number++;
  expect(() => admit(value, { gitText })).toThrow('semantic_invalid_pr');
});
it('uses the existing validator for current checkout, Main ancestry and version', () => {
  expect(() =>
    admit(fixture(), {
      gitText: (_r: string, args: string[]) =>
        args.join(' ') === 'rev-parse HEAD' ? other : gitText(_r, args),
    }),
  ).toThrow('semantic_checkout_head_mismatch');
  expect(() =>
    admit(fixture(), {
      gitText: (_r: string, args: string[]) =>
        args.join(' ') === 'rev-parse refs/remotes/origin/main' ? other : gitText(_r, args),
    }),
  ).toThrow('semantic_current_main_changed');
  expect(() =>
    admit(fixture(), {
      gitText: (_r: string, args: string[]) =>
        args[0] === 'merge-base' ? other : gitText(_r, args),
    }),
  ).toThrow('not based on current main');
  expect(() =>
    admit(fixture(), {
      gitText: (_r: string, args: string[]) =>
        args[0] === 'show' && args[1].startsWith(head)
          ? JSON.stringify({ version: '0.0.145' })
          : gitText(_r, args),
    }),
  ).toThrow('must not change package version');
});
it.each(['dev', 'codex/promote-example'])('refuses protected Main promotion %s', (source) => {
  const value = fixture();
  value.event.pull_request.head.ref = source;
  value.event.pull_request.body = '';
  expect(() => admit(value, { gitText })).toThrow('semantic_protected_phase_not_opted_in');
});
it('refuses Dev Release and opt-in on a routine route', () => {
  const value = fixture();
  value.event.pull_request.base.ref = 'dev';
  value.event.pull_request.head.ref = 'feature/example';
  value.event.pull_request.body = 'tiangong-next-release-automation:v2';
  expect(() => admit(value, { gitText })).toThrow('semantic_protected_phase_not_opted_in');
  value.event.pull_request.body = semantic;
  expect(() => admit(value, { gitText })).toThrow('semantic_opt_in_wrong_route');
});
it('retains manual dispatch only with ordinary job successes', () => {
  const value: any = fixture();
  value.eventName = 'workflow_dispatch';
  delete value.event.pull_request;
  value.dependencyResult = value.actionResult = 'success';
  expect(admit(value, { gitText }).kind).toBe('ordinary');
  expect(() => admit({ ...value, dependencyResult: 'skipped' }, { gitText })).toThrow(
    'semantic_ordinary_dependencies_failed',
  );
});

it('rejects an ambiguous dispatch payload', () => {
  const value = fixture();
  value.eventName = 'workflow_dispatch';
  value.dependencyResult = value.actionResult = 'success';
  expect(() => admit(value, { gitText })).toThrow('semantic_ambiguous_dispatch');
});
