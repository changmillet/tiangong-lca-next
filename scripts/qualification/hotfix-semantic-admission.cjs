const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { HOTFIX_MARKER_PREFIX, RELEASE_MARKER_PREFIX, hotfixContextFromPullRequest } = require('../release/release-gate-proof.cjs');
const SEMANTIC_MARKER_PREFIX = 'tiangong-next-main-semantic:v1';
const CANONICAL = { name: 'tiangong-lca/platform', id: 805297890, owner: 327771381 };
function requireFact(value, code) { if (!value) { const error = new Error(code); error.code = code; throw error; } }
function gitText(root, args) { return execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' }).trim(); }
function repoMatches(repo) { return repo?.full_name === CANONICAL.name && repo?.id === CANONICAL.id && repo?.owner?.id === CANONICAL.owner; }
function markerLine(body, prefix) {
  requireFact(typeof body === 'string' && Buffer.byteLength(body, 'utf8') <= 262144 && body.split(prefix).length === 2, 'semantic_marker_missing_or_ambiguous');
  const lines = body.split(/\r?\n/u);
  requireFact(lines.length <= 8192, 'semantic_marker_body_too_large');
  let fence = null, inComment = false, found;
  const raw = [];
  for (const line of lines) {
    const delimiter = /^ {0,3}(`{3,}|~{3,})(.*)$/u.exec(line);
    if (delimiter && !raw.length && !inComment) {
      const run = delimiter[1], tail = delimiter[2];
      if (!fence) {
        requireFact(run[0] !== '`' || !tail.includes('`'), 'semantic_marker_invalid_fence');
        fence = { character: run[0], length: run.length };
      } else if (run[0] === fence.character && run.length >= fence.length && !tail.trim()) fence = null;
    }
    if (!fence && !inComment) {
      for (const token of line.matchAll(/<(\/?)(pre|code|script|style|textarea|xmp|plaintext|blockquote)(?=[\s/>]|$)[^<>]*>?/giu)) {
        const closing = token[1] === '/', tag = token[2].toLowerCase();
        if (!closing) raw.push(tag);
        else if (tag !== 'plaintext' && raw.at(-1) === tag && new RegExp(`^</${tag}\\s*>$`, 'iu').test(token[0])) raw.pop();
      }
    }
    if (line.includes(prefix)) {
      requireFact(!fence && !raw.length && !inComment && line.startsWith('<!-- ') && line.endsWith(' -->'), 'semantic_marker_not_authoritative');
      found = line;
    } else if (!fence && !raw.length) {
      for (const token of line.matchAll(/<!--|-->/gu)) {
        if (token[0] === '<!--') { requireFact(!inComment, 'semantic_marker_nested_comment'); inComment = true; }
        else if (inComment) inComment = false;
      }
    }
  }
  requireFact(found, 'semantic_marker_missing_or_ambiguous');
  return found;
}

function admit(input, dependencies = {}) {
  const { root, eventName, event, repository, expectedHead, dependencyResult, actionResult } = input;
  requireFact(['pull_request', 'workflow_dispatch'].includes(eventName), 'semantic_unknown_event');
  requireFact(repository === CANONICAL.name && repoMatches(event?.repository), 'semantic_noncanonical_repository');
  requireFact(/^[a-f0-9]{40}$/u.test(expectedHead || ''), 'semantic_invalid_head');
  const git = dependencies.gitText || gitText;
  requireFact(git(root, ['rev-parse', 'HEAD']) === expectedHead, 'semantic_checkout_head_mismatch');
  if (eventName === 'workflow_dispatch') {
    requireFact(!event.pull_request, 'semantic_ambiguous_dispatch');
    requireFact(dependencyResult === 'success' && actionResult === 'success', 'semantic_ordinary_dependencies_failed');
    return { schema: 'platform.semantic-admission.v1', complete: true, kind: 'ordinary', head: expectedHead };
  }
  const pr = event.pull_request;
  requireFact(pr?.state === 'open' && Number.isSafeInteger(pr.number) && pr.number > 0 && event.number === pr.number, 'semantic_invalid_pr');
  requireFact(repoMatches(pr.base?.repo), 'semantic_fork_or_unknown_repository');
  requireFact(pr.head?.sha === expectedHead && ['dev', 'main'].includes(pr.base?.ref) && typeof pr.head?.ref === 'string', 'semantic_pr_head_or_base_mismatch');
  const body = String(pr.body || '');
  const hotfix = pr.base.ref === 'main' && pr.head.ref.startsWith('codex/hotfix-');
  if (!hotfix) {
    requireFact(!(pr.base.ref === 'dev' && body.includes(RELEASE_MARKER_PREFIX)) && !(pr.base.ref === 'main' && (pr.head.ref === 'dev' || pr.head.ref.startsWith('codex/promote-'))), 'semantic_protected_phase_not_opted_in');
    requireFact(!body.includes(SEMANTIC_MARKER_PREFIX), 'semantic_opt_in_wrong_route');
    requireFact(dependencyResult === 'success' && actionResult === 'success', 'semantic_ordinary_dependencies_failed');
    return { schema: 'platform.semantic-admission.v1', complete: true, kind: 'ordinary', head: expectedHead };
  }
  requireFact(repoMatches(pr.head?.repo), 'semantic_fork_or_unknown_repository');
  requireFact(dependencyResult === 'skipped' && actionResult === 'skipped', 'semantic_hotfix_dependencies_not_skipped');
  const hotfixLine = markerLine(body, HOTFIX_MARKER_PREFIX);
  requireFact(/^<!-- tiangong-next-main-hotfix:v1 issue=[1-9][0-9]* main-base=[a-f0-9]{40} candidate=[a-f0-9]{40} -->$/u.test(hotfixLine), 'semantic_hotfix_marker_invalid');
  const optIn = markerLine(body, SEMANTIC_MARKER_PREFIX);
  const pattern = /^<!-- tiangong-next-main-semantic:v1 issue=([1-9][0-9]*) main-base=([a-f0-9]{40}) candidate=([a-f0-9]{40}) version=((?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)) -->$/u;
  const match = pattern.exec(optIn);
  requireFact(match && Number.isSafeInteger(Number(match[1])), 'semantic_opt_in_invalid');
  requireFact(git(root, ['rev-parse', 'refs/remotes/origin/main']) === pr.base.sha, 'semantic_current_main_changed');
  // Reuse the same exact-base/head/version validator as Main Candidate.
  const context = hotfixContextFromPullRequest({ root, pullRequest: pr }, { gitText: git });
  requireFact(context.gate_mode === 'hotfix-full' && Number(match[1]) === context.issue && match[2] === context.release_base && match[3] === context.promotion_head && match[4] === context.release_version, 'semantic_opt_in_binding_mismatch');
  return { schema: 'platform.semantic-admission.v1', complete: true, kind: 'main-hotfix', head: expectedHead, mainBase: context.release_base, version: context.release_version, issue: context.issue };
}
if (require.main === module) {
  try {
    const args = {};
    for (let i = 2; i < process.argv.length; i += 2) { requireFact(['--event-path', '--expected-head', '--github-output'].includes(process.argv[i]) && process.argv[i + 1] && !args[process.argv[i]], 'semantic_invalid_cli'); args[process.argv[i]] = process.argv[i + 1]; }
    requireFact(args['--event-path'], 'semantic_missing_event_path');
    const result = admit({ root: process.cwd(), eventName: process.env.GITHUB_EVENT_NAME, repository: process.env.GITHUB_REPOSITORY, event: JSON.parse(fs.readFileSync(path.resolve(args['--event-path']), 'utf8')), expectedHead: args['--expected-head'], dependencyResult: process.env.DEPENDENCY_GATE_RESULT, actionResult: process.env.ACTION_COMPATIBILITY_RESULT });
    if (args['--github-output']) fs.appendFileSync(args['--github-output'], `admission_kind=${result.kind}\nadmitted_head=${result.head}\n`);
    process.stdout.write(JSON.stringify(result) + '\n');
  } catch (error) { process.stderr.write(JSON.stringify({ schema: 'platform.semantic-admission.v1', complete: false, error: { code: error.code || 'semantic_admission_failed', message: error.message } }) + '\n'); process.exitCode = 1; }
}
module.exports = { admit, markerLine, SEMANTIC_MARKER_PREFIX };
