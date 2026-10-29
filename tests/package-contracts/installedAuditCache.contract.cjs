const assert = require('node:assert/strict');
const test = require('node:test');
const { EventEmitter } = require('node:events');
const { Readable } = require('node:stream');
const { onePackage, packageFromParent, loadPackage } = require('./auditPackageResolution.cjs');

const parent = onePackage('cacheable-request', 7);
const installed = packageFromParent(parent, 'http-cache-semantics');
const CachePolicy = loadPackage(installed);
const CacheableRequest = loadPackage(parent);
const baselineTime = Date.UTC(2026, 9, 28);

function timedPolicy(request, response, options, seconds) {
  let now = baselineTime;
  class Policy extends CachePolicy {
    now() {
      return now;
    }
  }
  const policy = new Policy(request, response, options);
  now += seconds * 1000;
  return { policy, Policy };
}

const definitions = [
  { label: 'ordinary fresh', cc: 'public,max-age=300', maxAge: 300 },
  { label: 'ordinary stale', cc: 'public,max-age=0', maxAge: 0 },
  { label: 'ordinary SWR', cc: 'public,max-age=0,stale-while-revalidate=300', maxAge: 0, swr: 300 },
  { label: 'ordinary SIE', cc: 'public,max-age=0,stale-if-error=300', maxAge: 0, sie: 300 },
  {
    label: 'ordinary both extensions',
    cc: 'public,max-age=0,stale-if-error=300,stale-while-revalidate=300',
    maxAge: 0,
    sie: 300,
    swr: 300,
  },
  {
    label: 'no-cache stale with extensions',
    cc: 'no-cache,max-age=0,stale-if-error=300,stale-while-revalidate=300',
    maxAge: 0,
    sie: 300,
    swr: 300,
    validate: true,
  },
  {
    label: 'no-cache fresh with extensions',
    cc: 'no-cache,max-age=300,stale-if-error=300,stale-while-revalidate=300',
    maxAge: 300,
    sie: 300,
    swr: 300,
    validate: true,
  },
  {
    label: 'must-revalidate fresh',
    cc: 'public,max-age=300,must-revalidate,stale-if-error=300,stale-while-revalidate=300',
    maxAge: 300,
    sie: 300,
    swr: 300,
    forbid: 'all',
  },
  {
    label: 'must-revalidate stale',
    cc: 'public,max-age=0,must-revalidate,stale-if-error=300,stale-while-revalidate=300',
    maxAge: 0,
    sie: 300,
    swr: 300,
    forbid: 'all',
  },
  {
    label: 'proxy-revalidate fresh',
    cc: 'max-age=300,proxy-revalidate,stale-if-error=300,stale-while-revalidate=300',
    maxAge: 300,
    sie: 300,
    swr: 300,
    forbid: 'shared',
  },
  {
    label: 'proxy-revalidate stale',
    cc: 'max-age=0,proxy-revalidate,stale-if-error=300,stale-while-revalidate=300',
    maxAge: 0,
    sie: 300,
    swr: 300,
    forbid: 'shared',
  },
  {
    label: 's-maxage fresh no public',
    cc: 'max-age=0,s-maxage=300,stale-if-error=300,stale-while-revalidate=300',
    maxAge: 0,
    sMaxAge: 300,
    sie: 300,
    swr: 300,
    forbid: 'shared',
  },
  {
    label: 's-maxage stale',
    cc: 'max-age=300,s-maxage=0,stale-if-error=300,stale-while-revalidate=300',
    maxAge: 300,
    sMaxAge: 0,
    sie: 300,
    swr: 300,
    forbid: 'shared',
  },
  {
    label: 'no-store',
    cc: 'no-store,max-age=300,stale-if-error=300,stale-while-revalidate=300',
    maxAge: 300,
    sie: 300,
    swr: 300,
    storage: 'none',
  },
  {
    label: 'private',
    cc: 'private,max-age=300,stale-if-error=300,stale-while-revalidate=300',
    maxAge: 300,
    sie: 300,
    swr: 300,
    storage: 'private',
  },
  { label: 'Expires freshness', cc: '', maxAge: 300, expires: true },
  {
    label: 'Vary star',
    cc: 'public,max-age=300,stale-if-error=300,stale-while-revalidate=300',
    maxAge: 300,
    sie: 300,
    swr: 300,
    varyStar: true,
  },
  { label: 'cookie heuristic conservative', cc: '', maxAge: 0 },
];

const examples = [
  { label: 'duplicate first zero wins', cc: 'max-age=0, MAX-AGE=300', maxAge: 0, hit: false },
  { label: 'duplicate first positive wins', cc: 'MAX-AGE=300,max-age=0', maxAge: 300, hit: true },
  {
    label: 'legacy same-case duplicate first zero',
    cc: 'max-age=0,max-age=300',
    maxAge: 0,
    hit: false,
  },
  {
    label: 'legacy same-case duplicate first positive',
    cc: 'max-age=300,max-age=0',
    maxAge: 300,
    hit: true,
  },
  {
    label: 'no-cache overrides freshness',
    cc: 'MAX-AGE=300, No-Cache',
    maxAge: 0,
    hit: false,
    error: false,
  },
  {
    label: 'private overrides public in shared',
    cc: 'Public,Max-Age=300,Private',
    maxAge: 0,
    hit: false,
    storable: false,
  },
  {
    label: 'private remains allowed in private',
    cc: 'Public,Max-Age=300,Private',
    shared: false,
    maxAge: 300,
    hit: true,
  },
  {
    label: 'no-store overrides public',
    cc: 'No-Store,Public,Max-Age=300',
    maxAge: 0,
    hit: false,
    storable: false,
  },
  {
    label: 'first shared zero prohibits stale',
    cc: 'max-age=300,s-maxage=0,s-maxage=300',
    maxAge: 0,
    hit: false,
    maxStale: true,
    error: false,
  },
  {
    label: 'first shared positive wins',
    cc: 'max-age=0,s-maxage=300,s-maxage=0',
    maxAge: 300,
    hit: true,
  },
  {
    label: 'private ignores s-maxage',
    cc: 'max-age=300,s-maxage=0',
    shared: false,
    maxAge: 300,
    hit: true,
  },
  { label: 'quoted numeric', cc: 'MAX-AGE="300"', maxAge: 300, hit: true },
  { label: 'outer whitespace', cc: '  Max-Age = "300"  ', maxAge: 300, hit: true },
  { label: 'numeric leading zeros', cc: 'Max-Age=000300', maxAge: 300, hit: true },
  ...['300junk', '-1', '+300', '1.5', '3e2', 'Infinity', 'NaN', '', '"300', '300"', '" 300 "'].map(
    (value) => ({
      label: 'malformed max-age ' + JSON.stringify(value),
      cc: 'Public,Max-Age=' + value,
      maxAge: 0,
      hit: false,
      storable: false,
    }),
  ),
  {
    label: 'missing numeric argument',
    cc: 'Public,Max-Age',
    maxAge: 0,
    hit: false,
    storable: false,
  },
  {
    label: 'overflow clamped',
    cc: 'Max-Age=999999999999999999999999999999999999999',
    maxAge: 2147483648,
    hit: true,
  },
  {
    label: 'malformed SIE no fallback',
    cc: 'Public,Max-Age=0,Stale-If-Error=300junk',
    maxAge: 0,
    hit: false,
    error: false,
    storable: false,
  },
  {
    label: 'quoted SIE positive fallback',
    cc: 'Public,Max-Age=0,Stale-If-Error="300"',
    maxAge: 0,
    hit: false,
    error: true,
  },
  {
    label: 'malformed SWR no async reuse',
    cc: 'Public,Max-Age=0,Stale-While-Revalidate=1.5',
    maxAge: 0,
    hit: false,
    storable: false,
    swr: false,
  },
  {
    label: 'quoted SWR positive async reuse',
    cc: 'Public,Max-Age=0,Stale-While-Revalidate="300"',
    maxAge: 0,
    hit: true,
    synchronous: false,
    swr: true,
  },
  {
    label: 'qualified no-cache conservatively validates',
    cc: 'Max-Age=300,No-Cache="set-cookie"',
    maxAge: 0,
    hit: false,
    error: false,
  },
  {
    label: 'empty qualified no-cache conservative',
    cc: 'Max-Age=300,No-Cache=""',
    maxAge: 0,
    hit: false,
    error: false,
  },
  {
    label: 'qualified private conservatively not shared',
    cc: 'Max-Age=300,Private="set-cookie"',
    maxAge: 0,
    hit: false,
    storable: false,
  },
  {
    label: 'empty qualified private conservative',
    cc: 'Max-Age=300,Private=""',
    maxAge: 0,
    hit: false,
    storable: false,
  },
  {
    label: 'malformed public cannot grant authorization caching',
    cc: 'Public=garbage,Max-Age=300',
    authorization: true,
    maxAge: 0,
    hit: false,
    storable: false,
  },
  {
    label: 'valid public grants authorization caching',
    cc: 'Public,Max-Age=300',
    authorization: true,
    maxAge: 300,
    hit: true,
  },
  {
    label: 'malformed must-revalidate fails storage closed',
    cc: 'Public,Max-Age=300,Must-Revalidate=garbage',
    authorization: true,
    maxAge: 0,
    hit: false,
    storable: false,
  },
  {
    label: 'malformed proxy-revalidate fails storage closed',
    cc: 'Public,Max-Age=300,Proxy-Revalidate=',
    maxAge: 0,
    hit: false,
    storable: false,
  },
  {
    label: 'malformed s-maxage cannot grant auth caching',
    cc: 'Max-Age=300,S-MaxAge=bad',
    authorization: true,
    maxAge: 0,
    hit: false,
    storable: false,
  },
  {
    label: 'no-store empty malformed argument conservative',
    cc: 'Public,Max-Age=300,No-Store=',
    maxAge: 0,
    hit: false,
    storable: false,
  },
  {
    label: 'request Pragma no-cache mixed case',
    cc: 'Public,Max-Age=300',
    requestHeaders: { pragma: 'No-Cache' },
    maxAge: 300,
    hit: false,
    error: false,
  },
  {
    label: 'request Cache-Control precedes Pragma',
    cc: 'Public,Max-Age=300',
    requestHeaders: { 'cache-control': 'max-age=300', pragma: 'No-Cache' },
    maxAge: 300,
    hit: true,
  },
  {
    label: 'empty request Cache-Control still present',
    cc: 'Public,Max-Age=300',
    requestHeaders: { 'cache-control': '', pragma: 'No-Cache' },
    maxAge: 300,
    hit: true,
  },
  {
    label: 'unrelated Pragma token ignored',
    cc: 'Public,Max-Age=300',
    requestHeaders: { pragma: 'extension-no-cache' },
    maxAge: 300,
    hit: true,
  },
  {
    label: 'Pragma quoted extension value ignored',
    cc: 'Public,Max-Age=300',
    requestHeaders: { pragma: 'extension="no-cache"' },
    maxAge: 300,
    hit: true,
  },
  {
    label: 'Pragma list exact no-cache',
    cc: 'Public,Max-Age=300',
    requestHeaders: { pragma: 'extension, NO-CACHE' },
    maxAge: 300,
    hit: false,
    error: false,
  },
  {
    label: 'response Pragma legacy fallback',
    responseHeaders: { pragma: 'No-Cache' },
    expires: true,
    maxAge: 0,
    hit: false,
    error: false,
  },
  {
    label: 'response Cache-Control precedes Pragma',
    cc: 'Public,Max-Age=300',
    responseHeaders: { pragma: 'No-Cache' },
    maxAge: 300,
    hit: true,
  },
  {
    label: 'unrelated response Pragma ignored',
    responseHeaders: { pragma: 'not-no-cache' },
    expires: true,
    maxAge: 300,
    hit: true,
  },
  {
    label: 'legacy request no-store map normalized',
    cc: 'Public,Max-Age=300',
    initialHeaders: { 'cache-control': 'No-Store' },
    maxAge: 0,
    hit: false,
    storable: false,
  },
  {
    label: 'ignored cargo-cult lower-case option retained',
    cc: 'public,max-age=300,no-cache,pre-check=0,post-check=0',
    options: { ignoreCargoCult: true },
    maxAge: 300,
    hit: true,
  },
  {
    label: 'mixed cargo-cult legacy information loss remains conservative',
    cc: 'Public,Max-Age=300,No-Cache,pre-check=0,post-check=0',
    options: { ignoreCargoCult: true },
    maxAge: 300,
    hit: true,
    legacyExpected: { maxAge: 0, hit: false },
  },
];

examples.push(
  {
    label: 'quoted Public cannot grant auth caching',
    cc: 'max-age=300,extension="x, Public, y"',
    authorization: true,
    maxAge: 0,
    hit: false,
    storable: false,
  },
  {
    label: 'quoted lower public cannot grant auth caching',
    cc: 'max-age=300,extension="x, public, y"',
    authorization: true,
    maxAge: 0,
    hit: false,
    storable: false,
  },
  {
    label: 'real Public outside quoted extension grants auth caching',
    cc: 'extension="x, private, y",Public,max-age=300',
    authorization: true,
    maxAge: 300,
    hit: true,
  },
  {
    label: 'quoted no-store is opaque',
    cc: 'public,max-age=300,extension="x, no-store, y"',
    maxAge: 300,
    hit: true,
  },
  {
    label: 'quoted no-cache is opaque',
    cc: 'public,max-age=300,extension="x, No-Cache, y"',
    maxAge: 300,
    hit: true,
  },
  {
    label: 'quoted private field list remains conservative',
    cc: 'public,max-age=300,Private="set-cookie, x-auth"',
    maxAge: 0,
    hit: false,
    storable: false,
  },
  {
    label: 'quoted no-cache field list remains conservative',
    cc: 'public,max-age=300,No-Cache="set-cookie, x-auth"',
    maxAge: 0,
    hit: false,
    error: false,
  },
  {
    label: 'escaped quote keeps Public opaque',
    cc: String.raw`max-age=300,extension="x\", Public, y"`,
    authorization: true,
    maxAge: 0,
    hit: false,
    storable: false,
  },
  {
    label: 'escaped backslash quoted extension retains real Public',
    cc: String.raw`Public,max-age=300,extension="x\\, private, y"`,
    authorization: true,
    maxAge: 300,
    hit: true,
  },
  {
    label: 'quoted-pair digits retained',
    cc: String.raw`Public,max-age="\3\0\0"`,
    maxAge: 300,
    hit: true,
  },
  {
    label: 'complete max-age multiple equals rejected',
    cc: 'Public,max-age=300=garbage',
    maxAge: 0,
    hit: false,
    storable: false,
  },
  {
    label: 'complete s-maxage multiple equals cannot grant auth',
    cc: 'max-age=300,s-maxage=300=garbage',
    authorization: true,
    maxAge: 0,
    hit: false,
    storable: false,
  },
  {
    label: 'unbalanced quote fails closed without losing Private',
    cc: 'Private,max-age=300,extension="x, Public',
    maxAge: 0,
    hit: false,
    storable: false,
  },
  {
    label: 'dangling quoted escape fails closed',
    cc: 'public,max-age=300,extension="x\\',
    maxAge: 0,
    hit: false,
    storable: false,
  },
  {
    label: 'concatenated malformed quoted value fails closed',
    cc: 'public,max-age=300,extension="x"Public"y"',
    maxAge: 0,
    hit: false,
    storable: false,
  },
  {
    label: 'CRLF malformed header fails closed',
    cc: 'public,max-age=300\r\n',
    maxAge: 0,
    hit: false,
    storable: false,
  },
  {
    label: 'Pragma quoted no-cache stays opaque',
    cc: 'public,max-age=300',
    requestHeaders: { pragma: 'extension="x, No-Cache, y"' },
    maxAge: 300,
    hit: true,
  },
  {
    label: 'bounded many quoted commas remain opaque',
    cc: 'public,max-age=300,extension="' + 'x,'.repeat(1000) + 'Private,y"',
    maxAge: 300,
    hit: true,
  },
);

examples.push(
  {
    label: 'malformed incoming quoted no-cache requires validation',
    cc: 'public,max-age=300',
    requestHeaders: { 'cache-control': 'no-cache,extension="unbalanced' },
    maxAge: 300,
    hit: false,
    error: false,
  },
  {
    label: 'malformed incoming CRLF no-cache requires validation',
    cc: 'public,max-age=300',
    requestHeaders: { 'cache-control': 'no-cache\r\n' },
    maxAge: 300,
    hit: false,
    error: false,
  },
  {
    label: 'malformed incoming extension without directive conservative',
    cc: 'public,max-age=300',
    requestHeaders: { 'cache-control': 'extension="unbalanced' },
    maxAge: 300,
    hit: false,
    error: false,
  },
  {
    label: 'applicable malformed Pragma requires validation',
    cc: 'public,max-age=300',
    requestHeaders: { pragma: 'no-cache,extension="unbalanced' },
    maxAge: 300,
    hit: false,
    error: false,
  },
  {
    label: 'Cache-Control still precedes malformed Pragma',
    cc: 'public,max-age=300',
    requestHeaders: { 'cache-control': 'max-age=300', pragma: 'no-cache,extension="unbalanced' },
    maxAge: 300,
    hit: true,
  },
  {
    label: 'valid request no-store allows existing fresh response',
    cc: 'public,max-age=300',
    requestHeaders: { 'cache-control': 'no-store' },
    maxAge: 300,
    hit: true,
  },
);

const fields = [
  ['extension="x, No-Cache, y"', 'x, No-Cache, y'],
  ['extension="x, Private, y"', 'x, Private, y'],
  ['extension="x, Public, y"', 'x, Public, y'],
  [String.raw`extension="x\", No-Cache, y"`, 'x", No-Cache, y'],
  [String.raw`extension="x\\, Private, y"`, 'x\\, Private, y'],
  ['extension="a=b, c=d"', 'a=b, c=d'],
  ['extension=""', ''],
  ['extension="a b"', 'a b'],
  ['extension="a\tb, No-Cache"', 'a\tb, No-Cache'],
  ['extension="æ, No-Cache"', 'æ, No-Cache'],
  ['extension=bare_token', 'bare_token'],
];
const token = String.fromCharCode(
  33,
  35,
  36,
  37,
  38,
  39,
  42,
  43,
  45,
  46,
  94,
  95,
  96,
  124,
  126,
  48,
  57,
  65,
  90,
  97,
  122,
);
fields.push(['extension=' + token, token]);

test('the real cacheable-request parent binds the exact maintained policy cohort', () => {
  assert.equal(parent.manifest.version, '7.0.4');
  assert.equal(installed.manifest.version, '4.3.0');
});

test('freshness, shared/private stale constraints, every error status and matching survive serialization', () => {
  for (const shared of [false, true])
    for (const cookie of [false, true])
      for (const def of definitions) {
        const declaredLifetime = shared && def.sMaxAge !== undefined ? def.sMaxAge : def.maxAge;
        const cookieOptIn = def.cc
          .split(',')
          .some((part) => ['public', 'immutable'].includes(part.trim().toLowerCase()));
        const lifetime = shared && cookie && !cookieOptIn ? 0 : declaredLifetime;
        for (const age of [1, 299, 300, 301, 599, 600])
          for (const kind of [
            'ordinary',
            'max-stale',
            'request-no-cache',
            'pragma-no-cache',
            'url-mismatch',
            'host-mismatch',
            'method-mismatch',
            'head-mismatch',
            'vary-mismatch',
          ]) {
            const request = {
              url: 'https://synthetic.invalid/owned',
              method: 'GET',
              headers: { host: 'synthetic.invalid', 'accept-language': 'en' },
            };
            const headers = {
              'cache-control': def.cc,
              date: new Date(baselineTime).toUTCString(),
              vary: def.varyStar ? '*' : 'accept-language',
              etag: '"owned-v1"',
            };
            if (cookie) headers['set-cookie'] = 'audit=synthetic';
            if (def.expires) headers.expires = new Date(baselineTime + 300000).toUTCString();
            const { policy: constructed, Policy } = timedPolicy(
              request,
              { status: 200, headers },
              { shared },
              age,
            );
            const incoming = { ...request, headers: { ...request.headers } };
            if (kind === 'max-stale') incoming.headers['cache-control'] = 'Max-Stale=99999';
            if (kind === 'request-no-cache') incoming.headers['cache-control'] = 'No-Cache';
            if (kind === 'pragma-no-cache') incoming.headers.pragma = 'NO-CACHE';
            if (kind === 'url-mismatch') incoming.url += '/different';
            if (kind === 'host-mismatch') incoming.headers.host = 'other.invalid';
            if (kind === 'method-mismatch') incoming.method = 'POST';
            if (kind === 'head-mismatch') incoming.method = 'HEAD';
            if (kind === 'vary-mismatch') incoming.headers['accept-language'] = 'fr';
            const stored = def.storage !== 'none' && !(shared && def.storage === 'private');
            const matches = !kind.includes('mismatch') && !def.varyStar;
            const force = ['request-no-cache', 'pragma-no-cache'].includes(kind);
            const fresh = age < lifetime;
            const staleAllowed =
              stored &&
              !def.validate &&
              !def.varyStar &&
              def.forbid !== 'all' &&
              !(shared && def.forbid === 'shared');
            const swr = staleAllowed && (def.swr || 0) > 0 && lifetime + def.swr > age;
            const allowedError =
              matches &&
              !force &&
              stored &&
              !def.validate &&
              !def.varyStar &&
              (fresh || staleAllowed) &&
              lifetime + (def.sie || 0) > age;
            const hit =
              stored &&
              !def.validate &&
              matches &&
              !force &&
              (fresh || (staleAllowed && (kind === 'max-stale' || swr)));
            const revalidation = !hit
              ? 'sync'
              : !fresh && kind !== 'max-stale' && swr
                ? 'async'
                : 'none';
            for (const serialized of [false, true]) {
              const policy = serialized
                ? Policy.fromObject(JSON.parse(JSON.stringify(constructed.toObject())))
                : constructed;
              const label = JSON.stringify({
                label: def.label,
                shared,
                cookie,
                age,
                kind,
                serialized,
              });
              const result = policy.evaluateRequest(incoming);
              assert.equal(Boolean(result.response), hit, label);
              assert.equal(
                !result.revalidation ? 'none' : result.revalidation.synchronous ? 'sync' : 'async',
                revalidation,
                label,
              );
              assert.equal(
                policy.satisfiesWithoutRevalidation(incoming),
                hit && revalidation === 'none',
                label,
              );
              for (const status of [500, 502, 503, 504]) {
                const update = policy.revalidatedPolicy(incoming, {
                  status,
                  headers: { 'cache-control': 'no-store' },
                });
                assert.equal(!update.modified, allowedError, label + ':' + status);
              }
              let absentReuse;
              try {
                absentReuse = !policy.revalidatedPolicy(incoming, undefined).modified;
              } catch {
                absentReuse = false;
              }
              assert.equal(absentReuse, allowedError, label + ':absent');
            }
          }
      }
});

test('case, duplicates, complete malformed values and Pragma preserve declared input boundaries', () => {
  for (const item of examples)
    for (const serialized of [false, true]) {
      const request = {
        url: 'https://synthetic.invalid/owned',
        method: 'GET',
        headers: { host: 'synthetic.invalid', ...item.initialHeaders },
      };
      if (item.authorization) request.headers.authorization = 'owned synthetic credential';
      const response = {
        status: 200,
        headers: {
          date: new Date(baselineTime).toUTCString(),
          etag: '"owned-v1"',
          ...item.responseHeaders,
        },
      };
      if (item.cc !== undefined) response.headers['cache-control'] = item.cc;
      if (item.expires) response.headers.expires = new Date(baselineTime + 300000).toUTCString();
      const { policy: constructed, Policy } = timedPolicy(
        request,
        response,
        { shared: item.shared !== false, ...item.options },
        1,
      );
      const policy = serialized
        ? Policy.fromObject(JSON.parse(JSON.stringify(constructed.toObject())))
        : constructed;
      const incoming = {
        ...request,
        headers: {
          host: 'synthetic.invalid',
          ...(item.maxStale ? { 'cache-control': 'Max-Stale=99999' } : {}),
          ...item.requestHeaders,
        },
      };
      if (item.authorization) incoming.headers.authorization = request.headers.authorization;
      const result = policy.evaluateRequest(incoming);
      const actual = {
        maxAge: policy.maxAge(),
        storable: policy.storable(),
        hit: Boolean(result.response),
        synchronous: result.revalidation?.synchronous,
        error: !policy.revalidatedPolicy(incoming, {
          status: 503,
          headers: { 'cache-control': 'no-store' },
        }).modified,
        swr: policy.useStaleWhileRevalidate(),
      };
      // These are current-artifact own roundtrips. The deliberately conservative
      // historical cargo-cult ambiguity is exercised separately below.
      for (const property of ['maxAge', 'storable', 'hit', 'synchronous', 'error', 'swr'])
        if (item[property] !== undefined)
          assert.equal(
            actual[property],
            item[property],
            item.label + ':' + property + ':' + serialized,
          );
    }
});

test('legacy maps cannot override retained wire prohibitions or infer a lost waiver', () => {
  const request = {
    url: 'https://synthetic.invalid/owned',
    headers: { host: 'synthetic.invalid' },
  };
  for (const cc of [
    'No-Cache,max-age=300',
    'Private,max-age=300',
    'public,max-age=300,s-maxage=0,s-maxage=300',
    'max-age=300,extension="x, public, y"',
  ]) {
    const initial = new CachePolicy(request, {
      status: 200,
      headers: { 'cache-control': 'public,max-age=300' },
    });
    const object = JSON.parse(JSON.stringify(initial.toObject()));
    object.resh['cache-control'] = cc;
    object.rescc = { Public: true, 'Max-Age': '300', 'S-MaxAge': '300' };
    if (cc.includes('extension')) {
      object.a = false;
    }
    const restored = CachePolicy.fromObject(object);
    assert.equal(restored.satisfiesWithoutRevalidation(request), false, cc);
    assert.equal(
      restored.revalidatedPolicy(request, { status: 503, headers: {} }).modified,
      true,
      cc,
    );
  }
  const ordinary = new CachePolicy(request, {
    status: 200,
    headers: { 'cache-control': 'public,max-age=300' },
  }).toObject();
  const noRaw = JSON.parse(JSON.stringify(ordinary));
  delete noRaw.resh['cache-control'];
  noRaw.rescc = { 'No-Cache': true, 'Max-Age': '300' };
  assert.equal(CachePolicy.fromObject(noRaw).satisfiesWithoutRevalidation(request), false);
  const noStore = JSON.parse(JSON.stringify(ordinary));
  noStore.reqcc = { 'No-Store': true };
  assert.equal(CachePolicy.fromObject(noStore).storable(), false);
  const ambiguous = new CachePolicy(
    request,
    { status: 200, headers: { 'cache-control': 'Public,Max-Age=300,No-Cache' } },
    { ignoreCargoCult: true },
  );
  assert.equal(
    CachePolicy.fromObject(ambiguous.toObject()).satisfiesWithoutRevalidation(request),
    false,
  );
});

test('opaque extension values roundtrip through the current ignoreCargoCult codec', () => {
  for (const authorization of [false, true])
    for (const [field, value] of fields) {
      const request = {
        url: 'https://synthetic.invalid/owned',
        headers: {
          host: 'synthetic.invalid',
          ...(authorization ? { authorization: 'owned synthetic credential' } : {}),
        },
      };
      let policy = new CachePolicy(
        request,
        {
          status: 200,
          headers: { 'cache-control': 'public,max-age=300,' + field + ',pre-check=0,post-check=0' },
        },
        { ignoreCargoCult: true },
      );
      for (let generation = 0; generation < 3; generation++) {
        assert.equal(policy.storable(), true, field);
        assert.equal(policy.satisfiesWithoutRevalidation(request), true, field);
        assert.equal(policy.toObject().rescc.extension, value, field);
        policy = CachePolicy.fromObject(JSON.parse(JSON.stringify(policy.toObject())));
      }
    }
});

test('successful conditional304 remains valid across Vary selection with the same strong validator', () => {
  const request = {
    url: 'https://synthetic.invalid/owned',
    method: 'GET',
    headers: { host: 'synthetic.invalid', 'accept-language': 'en' },
  };
  for (const language of ['en', 'fr']) {
    const policy = new CachePolicy(request, {
      status: 200,
      headers: {
        'cache-control': 'public,max-age=0',
        vary: 'accept-language',
        etag: '"same-representation"',
      },
    });
    const incoming = {
      ...request,
      headers: {
        ...request.headers,
        'accept-language': language,
        'if-none-match': '"same-representation"',
      },
    };
    const update = policy.revalidatedPolicy(incoming, {
      status: 304,
      headers: { 'cache-control': 'public,max-age=300', etag: '"same-representation"' },
    });
    assert.equal(update.modified, false);
    assert.equal(update.matches, true);
    assert.equal(update.policy.satisfiesWithoutRevalidation(incoming), true);
  }
});

function deadline(promise) {
  let timer;
  return Promise.race([
    promise,
    new Promise((resolve, reject) => {
      timer = setTimeout(() => reject(new Error('Owned cache fixture timed out')), 3000);
    }),
  ]).finally(() => clearTimeout(timer));
}

const consumerCases = [
  { cc: 'no-cache,stale-if-error=300', cached: false },
  { cc: 'public,max-age=0,must-revalidate,stale-if-error=300', cached: false },
  { cc: 'public,max-age=0,proxy-revalidate,stale-if-error=300', cached: false },
  { cc: 'public,max-age=0,s-maxage=0,stale-if-error=300', cached: false },
  { cc: 'public,max-age=0,stale-if-error=300', cached: true, calls: 2 },
  { cc: 'public,max-age=0,stale-if-error=300', age: 301, cached: false },
  { cc: 'max-age=0,proxy-revalidate,stale-if-error=300', shared: false, cached: true, calls: 2 },
  { cc: 'public,max-age=300', nextHeaders: { 'accept-language': 'fr' }, cached: false },
  { cc: 'max-age=300,proxy-revalidate', cached: true, calls: 1 },
  { cc: 'No-Cache,Stale-If-Error=300', cached: false },
  {
    cc: 'max-age=300,extension="x, Public, y"',
    firstHeaders: { authorization: 'owned synthetic credential' },
    storable: false,
    cached: false,
  },
  {
    cc: 'public,max-age=300,extension="x, Private, y"',
    firstHeaders: { authorization: 'owned synthetic credential' },
    cached: true,
    calls: 1,
  },
  {
    cc: 'public,max-age=300,extension="x, No-Cache, y",pre-check=0,post-check=0',
    options: { ignoreCargoCult: true },
    cached: true,
    calls: 1,
  },
  {
    cc: 'public,max-age=300',
    nextHeaders: { 'cache-control': 'no-cache,extension="unbalanced' },
    cached: false,
  },
  {
    cc: 'public,max-age=300',
    nextHeaders: { pragma: 'no-cache,extension="unbalanced' },
    cached: false,
  },
  {
    cc: 'public,max-age=300',
    nextHeaders: { 'cache-control': 'no-store' },
    cached: true,
    calls: 1,
  },
  {
    cc: 'public,max-age=300',
    nextHeaders: { 'cache-control': 'max-age=300', pragma: 'no-cache,extension="unbalanced' },
    cached: true,
    calls: 1,
  },
  { cc: 'public,max-age=0', secondStatus: 304, cached: true, calls: 2 },
];

test('actual cacheable-request consumes the installed policy with synthetic responses and closes every fixture', async () => {
  for (const example of consumerCases) {
    const streams = new Set();
    const responses = new Set();
    let acknowledgeStorage;
    const stored = new Promise((resolve) => {
      acknowledgeStorage = resolve;
    });
    class ObservedMap extends Map {
      set(key, value) {
        const result = super.set(key, value);
        acknowledgeStorage();
        return result;
      }
    }
    const cache = new ObservedMap();
    let calls = 0;
    const cached = new CacheableRequest((options, callback) => {
      assert.equal(options.hostname, 'synthetic.invalid');
      const sequence = ++calls;
      const request = new EventEmitter();
      process.nextTick(() => {
        const status = sequence === 1 ? 200 : example.secondStatus || 503;
        const response = Readable.from(
          status === 304
            ? []
            : [Buffer.from(sequence === 1 ? 'OWNED_CACHED_BODY' : 'OWNED_ORIGIN_BODY')],
        );
        response.statusCode = status;
        response.headers =
          sequence === 1
            ? {
                'cache-control': example.cc,
                age: String(example.age || 1),
                vary: 'accept-language',
                etag: '"owned-v1"',
              }
            : { 'cache-control': 'no-store', etag: '"owned-v1"' };
        response.url = 'https://synthetic.invalid/owned';
        streams.add(response);
        callback(response);
      });
      return request;
    }, cache);
    let initial = true;
    const execute = () =>
      deadline(
        new Promise((resolve, reject) => {
          const headers = {
            'accept-language': 'en',
            ...(initial ? example.firstHeaders : example.nextHeaders),
          };
          initial = false;
          const events = cached(
            {
              protocol: 'https:',
              hostname: 'synthetic.invalid',
              path: '/owned',
              method: 'GET',
              headers,
              shared: example.shared !== false,
              ...example.options,
            },
            async (response) => {
              responses.add(response);
              try {
                let body = '';
                for await (const chunk of response) body += chunk;
                resolve({ status: response.statusCode, cached: response.fromCache, body });
              } catch (error) {
                reject(error);
              }
            },
          );
          events.once('error', reject);
        }),
      );
    try {
      assert.equal((await execute()).cached, false);
      if (example.storable !== false) await deadline(stored);
      const next = await execute();
      assert.equal(next.cached, example.cached, example.cc);
      assert.equal(next.status, example.cached ? 200 : example.secondStatus || 503, example.cc);
      assert.equal(calls, example.calls || 2, example.cc);
      assert.equal(next.body, example.cached ? 'OWNED_CACHED_BODY' : 'OWNED_ORIGIN_BODY');
    } finally {
      for (const stream of [...streams, ...responses]) stream.destroy();
      cache.clear();
      assert.equal(cache.size, 0);
      assert.ok([...streams, ...responses].every((stream) => stream.destroyed));
    }
  }
});
