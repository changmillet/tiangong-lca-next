const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');
const test = require('node:test');
const { once } = require('node:events');
const {
  packageCopies,
  onePackage,
  loadPackage,
  packageFromParent,
} = require('./auditPackageResolution.cjs');

// These are owned library fixtures. They do not start the application, load its
// environment, reach a backend, or use production credentials/data.
const resources = { servers: new Set(), sockets: new Set(), directories: new Set() };

async function withServer(server, run) {
  const closedSockets = [];
  server.on('connection', (socket) => {
    resources.sockets.add(socket);
    closedSockets.push(
      new Promise((resolve) => {
        socket.once('close', () => {
          resources.sockets.delete(socket);
          resolve();
        });
      }),
    );
  });
  resources.servers.add(server);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  try {
    return await run('http://127.0.0.1:' + server.address().port);
  } finally {
    const closed = once(server, 'close');
    server.close();
    server.closeAllConnections();
    await closed;
    await Promise.all(closedSockets);
    resources.servers.delete(server);
  }
}

function nativeRequest(url, options = {}, body) {
  assert.equal(new URL(url).hostname, '127.0.0.1');
  return new Promise((resolve, reject) => {
    const request = http.request(url, { ...options, agent: false }, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.once('error', reject);
      response.once('end', () =>
        resolve({
          status: response.statusCode,
          headers: response.headers,
          body: Buffer.concat(chunks),
        }),
      );
    });
    request.setTimeout(3000, () => request.destroy(new Error('Owned HTTP fixture timed out')));
    request.once('error', reject);
    request.end(body);
  });
}

test(
  'both installed Undici generations preserve request/fetch/cancellation on owned loopback',
  { timeout: 10000 },
  async () => {
    await withServer(
      http.createServer((request, response) => {
        if (request.url === '/wait') return;
        response.setHeader('content-type', 'application/json');
        response.end(JSON.stringify({ method: request.method, value: 'owned fixture' }));
      }),
      async (origin) => {
        for (const copy of packageCopies('undici')) {
          const undici = loadPackage(copy);
          const dispatcher = new undici.Agent({ connections: 1 });
          try {
            const result = await undici.request(origin, { dispatcher });
            assert.equal(result.statusCode, 200);
            assert.deepEqual(await result.body.json(), { method: 'GET', value: 'owned fixture' });
            const response = await undici.fetch(origin, {
              method: 'POST',
              body: 'owned',
              dispatcher,
            });
            assert.deepEqual(await response.json(), { method: 'POST', value: 'owned fixture' });
            const controller = new AbortController();
            const pending = undici.fetch(origin + '/wait', {
              dispatcher,
              signal: controller.signal,
            });
            controller.abort();
            await assert.rejects(pending, { name: 'AbortError' });
            await assert.rejects(
              undici.request(origin, { dispatcher, method: 'GET\r\nowned: invalid' }),
            );
          } finally {
            await dispatcher.destroy();
          }
        }
      },
    );
  },
);

test(
  'the actual Axios redirect dependency strips array credentials and literal custom sensitive headers across origins',
  { timeout: 10000 },
  async () => {
    const plugins = onePackage('@umijs/plugins');
    const axios = packageFromParent(plugins, 'axios');
    const copy = packageFromParent(axios, 'follow-redirects');
    assert.equal(copy.manifest.version, '1.16.2');
    const redirects = loadPackage(copy);
    await withServer(
      http.createServer((request, response) => {
        response.setHeader('content-type', 'application/json');
        response.end(JSON.stringify(request.headers));
      }),
      async (target) => {
        await withServer(
          http.createServer((request, response) => {
            response.writeHead(302, { location: target + '/result' });
            response.end();
          }),
          async (source) => {
            const address = new URL(source);
            const result = await new Promise((resolve, reject) => {
              const request = redirects.http.request(
                {
                  protocol: 'http:',
                  hostname: '127.0.0.1',
                  port: address.port,
                  path: '/',
                  headers: [
                    'Authorization',
                    'owned synthetic credential',
                    'Cookie',
                    'audit=synthetic',
                    'x.secret',
                    'owned sensitive',
                    'xasecret',
                    'owned ordinary',
                  ],
                  sensitiveHeaders: ['x.secret'],
                  maxRedirects: 2,
                  agent: false,
                },
                (response) => {
                  const chunks = [];
                  response.on('data', (chunk) => chunks.push(chunk));
                  response.once('error', reject);
                  response.once('end', () => resolve(JSON.parse(Buffer.concat(chunks).toString())));
                },
              );
              request.setTimeout(3000, () =>
                request.destroy(new Error('Owned redirect fixture timed out')),
              );
              request.once('error', reject);
              request.end();
            });
            assert.equal(result.authorization, undefined);
            assert.equal(result.cookie, undefined);
            assert.equal(result['x.secret'], undefined);
            assert.equal(result.xasecret, 'owned ordinary');
          },
        );
      },
    );
  },
);

test(
  'real Express/body-parser/compression consumers retain payload, limit, error and gzip behavior',
  { timeout: 10000 },
  async () => {
    const mako = onePackage('@umijs/bundler-mako');
    const expressCopy = packageFromParent(mako, 'express');
    const express = loadPackage(expressCopy);
    const parserCopy = packageFromParent(expressCopy, 'body-parser');
    const parser = loadPackage(parserCopy);
    assert.equal(expressCopy.manifest.version, '4.22.3');
    assert.equal(parserCopy.manifest.version, '1.20.9');
    const compression = mako.require('compression');
    const app = express();
    app.use(compression({ threshold: 0 }));
    app.use(parser.json({ limit: '128b' }));
    app.use(parser.urlencoded({ extended: true, parameterLimit: 2, limit: '128b' }));
    app.post('/body', (request, response) => response.json(request.body));
    app.get('/gzip', (request, response) =>
      response.type('text').send('owned response '.repeat(20)),
    );
    app.use((error, request, response, next) => {
      void request;
      void next;
      response.status(error.status || 500).json({ type: error.type });
    });
    await withServer(http.createServer(app), async (origin) => {
      const valid = await nativeRequest(
        origin + '/body',
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
        },
        '{"value":23}',
      );
      assert.equal(valid.status, 200);
      assert.deepEqual(JSON.parse(valid.body), { value: 23 });
      const invalid = await nativeRequest(
        origin + '/body',
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
        },
        '{',
      );
      assert.equal(invalid.status, 400);
      assert.equal(JSON.parse(invalid.body).type, 'entity.parse.failed');
      const large = await nativeRequest(
        origin + '/body',
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
        },
        JSON.stringify({ value: 'x'.repeat(129) }),
      );
      assert.equal(large.status, 413);
      const form = await nativeRequest(
        origin + '/body',
        {
          method: 'POST',
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
        },
        'filter[name]=owned&items[]=one',
      );
      assert.equal(form.status, 200);
      assert.deepEqual(JSON.parse(form.body), { filter: { name: 'owned' }, items: ['one'] });
      const many = await nativeRequest(
        origin + '/body',
        {
          method: 'POST',
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
        },
        'a=1&b=2&c=3',
      );
      assert.equal(many.status, 413);
      const gzip = await nativeRequest(origin + '/gzip', {
        headers: { 'accept-encoding': 'gzip' },
      });
      assert.equal(gzip.headers['content-encoding'], 'gzip');
      assert.equal(zlib.gunzipSync(gzip.body).toString(), 'owned response '.repeat(20));
    });
  },
);

test(
  'actual Hono/node-server adapters preserve routes, CORS and malformed JSON handling',
  { timeout: 10000 },
  async () => {
    const adapterCopy = onePackage('@hono/node-server');
    const hono = packageFromParent(adapterCopy, 'hono');
    const { Hono } = loadPackage(hono);
    const { cors } = hono.require('hono/cors');
    const { createAdaptorServer } = loadPackage(adapterCopy);
    const app = new Hono();
    app.use('*', cors({ origin: 'https://owned.example' }));
    app.get('/fixture/:id', (context) => context.json({ id: context.req.param('id') }));
    app.post('/body', async (context) => {
      try {
        return context.json(await context.req.json());
      } catch {
        return context.json({ error: 'invalid JSON' }, 400);
      }
    });
    await withServer(createAdaptorServer({ fetch: app.fetch }), async (origin) => {
      const result = await nativeRequest(origin + '/fixture/23');
      assert.equal(result.status, 200);
      assert.deepEqual(JSON.parse(result.body), { id: '23' });
      const preflight = await nativeRequest(origin + '/fixture/23', {
        method: 'OPTIONS',
        headers: {
          origin: 'https://owned.example',
          'access-control-request-method': 'POST',
          'access-control-request-headers': 'x-owned,   x-other',
        },
      });
      assert.equal(preflight.status, 204);
      assert.equal(preflight.headers['access-control-allow-origin'], 'https://owned.example');
      assert.equal(preflight.headers['access-control-allow-headers'], 'x-owned,x-other');
      const invalid = await nativeRequest(
        origin + '/body',
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
        },
        '{',
      );
      assert.equal(invalid.status, 400);
      assert.deepEqual(JSON.parse(invalid.body), { error: 'invalid JSON' });
    });
  },
);

test(
  'the actual cacheable-request parent revalidates prohibited responses after serialization',
  { timeout: 10000 },
  async () => {
    const copy = onePackage('cacheable-request', 7);
    const policy = packageFromParent(copy, 'http-cache-semantics');
    assert.equal(copy.manifest.version, '7.0.4');
    assert.equal(policy.manifest.version, '4.3.0');
    const CacheableRequest = loadPackage(copy);
    const counts = new Map();
    const cases = [
      ['cookie', 'max-age=0', true],
      ['no-cache', 'no-cache', false],
      ['proxy', 'public, max-age=0, proxy-revalidate', false],
      ['shared-age', 'public, max-age=0, s-maxage=0', false],
      ['private', 'private, max-age=0', false],
      ['no-store', 'no-store', false],
    ];
    const cacheHeaders = new Map(cases.map(([name, value]) => ['/' + name, value]));
    await withServer(
      http.createServer((request, response) => {
        const count = (counts.get(request.url) || 0) + 1;
        counts.set(request.url, count);
        response.writeHead(200, {
          'cache-control': cacheHeaders.get(request.url),
          'set-cookie': 'audit=synthetic',
        });
        response.end('owned response ' + count);
      }),
      async (origin) => {
        const address = new URL(origin);
        for (const [name, cacheControl, mayReuse] of cases) {
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
          const cachedRequest = new CacheableRequest((options, handler) => {
            assert.equal(options.hostname, '127.0.0.1');
            assert.equal(String(options.port), address.port);
            return http.request({ ...options, agent: false }, handler);
          }, cache);
          const get = (headers) =>
            new Promise((resolve, reject) => {
              const events = cachedRequest(
                {
                  protocol: 'http:',
                  hostname: '127.0.0.1',
                  port: address.port,
                  path: '/' + name,
                  method: 'GET',
                  headers,
                  shared: true,
                },
                (response) => {
                  const chunks = [];
                  response.on('data', (chunk) => chunks.push(chunk));
                  response.once('error', reject);
                  response.once('end', () =>
                    resolve({
                      fromCache: response.fromCache,
                      body: Buffer.concat(chunks).toString(),
                    }),
                  );
                },
              );
              events.once('error', reject);
              events.once('request', (request) => {
                request.setTimeout(3000, () =>
                  request.destroy(new Error('Owned cache fixture timed out')),
                );
                request.end();
              });
            });
          try {
            assert.equal((await get({})).fromCache, false);
            if (!['private', 'no-store'].includes(name)) {
              let timer;
              try {
                await Promise.race([
                  stored,
                  new Promise((resolve, reject) => {
                    timer = setTimeout(
                      () => reject(new Error('Owned cache storage timed out')),
                      3000,
                    );
                  }),
                ]);
              } finally {
                clearTimeout(timer);
              }
            }
            const second = await get({ 'cache-control': 'max-stale=99999' });
            assert.equal(second.fromCache, mayReuse, cacheControl);
            assert.equal(counts.get('/' + name), mayReuse ? 1 : 2, cacheControl);
            assert.equal(second.body, 'owned response ' + (mayReuse ? 1 : 2));
          } finally {
            cache.clear();
          }
        }
      },
    );
  },
);

test('the installed packaging tar preserves archive roundtrips and bounds deep member filtering', async () => {
  const tar = loadPackage(onePackage('tar', 7));
  const options = {};
  tar.filesFilter(options, ['selected']);
  assert.equal(options.filter('selected/nested/file.txt'), true);
  assert.equal(options.filter('other/file.txt'), false);
  assert.equal(options.filter('other/' + 'nested/'.repeat(256) + 'file.txt'), false);
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'platform-audit-tar-'));
  resources.directories.add(directory);
  try {
    fs.mkdirSync(path.join(directory, 'input/nested'), { recursive: true });
    fs.mkdirSync(path.join(directory, 'output'));
    fs.writeFileSync(path.join(directory, 'input/nested/owned.txt'), 'owned archive fixture');
    const archive = path.join(directory, 'owned.tar');
    await tar.c({ cwd: path.join(directory, 'input'), file: archive }, ['nested']);
    const members = [];
    await tar.t({ file: archive, onReadEntry: (entry) => members.push(entry.path) });
    assert.ok(members.includes('nested/owned.txt'));
    await tar.x({ cwd: path.join(directory, 'output'), file: archive });
    assert.equal(
      fs.readFileSync(path.join(directory, 'output/nested/owned.txt'), 'utf8'),
      'owned archive fixture',
    );
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
    resources.directories.delete(directory);
  }
});

test.after(() => {
  assert.equal(resources.servers.size, 0);
  assert.equal(resources.sockets.size, 0);
  assert.equal(resources.directories.size, 0);
});
