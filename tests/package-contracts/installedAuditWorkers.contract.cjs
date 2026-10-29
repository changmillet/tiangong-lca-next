const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { once } = require('node:events');
const { test, mock } = require('node:test');
const { repositoryRoot, onePackage, packageFromParent } = require('./auditPackageResolution.cjs');

const mako = onePackage('@umijs/mako');
const piscina = packageFromParent(mako, 'piscina');

// This isolated child controls CPU discovery only while loading the packages.
// Pool/thread behavior and the Mako modules themselves remain unmodified.
const cpuFixture = mock.method(os, 'availableParallelism', () => 2);
let Piscina;
let LessPlugin;
let PostcssPlugin;
try {
  Piscina = piscina.require('piscina').Piscina;
  ({ LessPlugin } = require(path.join(mako.directory, 'dist/plugins/less/index.js')));
  ({ PostcssPlugin } = require(path.join(mako.directory, 'dist/plugins/postcss/index.js')));
} finally {
  cpuFixture.mock.restore();
}

const resources = { directories: new Set(), pools: new Set() };

function temporaryDirectory() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'platform-audit-worker-'));
  resources.directories.add(directory);
  return directory;
}

function removeDirectory(directory) {
  fs.rmSync(directory, { recursive: true });
  assert.equal(fs.existsSync(directory), false);
  resources.directories.delete(directory);
}

async function disposePool(pool) {
  if (!pool) return;
  await pool.destroy();
  assert.equal(pool.threads.length, 0);
  resources.pools.delete(pool);
}

function harmlessWorker(directory) {
  const filename = path.join(directory, 'worker.cjs');
  fs.writeFileSync(
    filename,
    [
      "const { parentPort } = require('node:worker_threads');",
      'module.exports = async (input) => {',
      "  if (input.mode === 'throw') throw new Error('owned worker rejection');",
      "  if (input.mode === 'pending') {",
      '    parentPort.postMessage({ auditStarted: input.id });',
      '    return new Promise(() => {});',
      '  }',
      '  return {',
      '    value: input.value,',
      '    marker: process.env.PLATFORM_AUDIT_INHERITED_ENV || null,',
      "    inheritedTrace: process.execArgv.includes('--trace-warnings'),",
      '  };',
      '};',
    ].join('\n'),
  );
  return filename;
}

function inheritedFixture(properties, action) {
  const previous = new Map();
  for (const [key, value] of Object.entries(properties)) {
    previous.set(key, Object.getOwnPropertyDescriptor(Object.prototype, key));
    Object.defineProperty(Object.prototype, key, {
      configurable: true,
      enumerable: false,
      writable: true,
      value,
    });
  }
  try {
    return action();
  } finally {
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(Object.prototype, key, descriptor);
      else delete Object.prototype[key];
    }
  }
}

test('the Mako loader binds the compatible patched Piscina cohort', () => {
  assert.equal(mako.manifest.version, '0.11.10');
  assert.equal(piscina.manifest.version, '4.9.4');
  assert.equal(mako.manifest.dependencies.piscina, '^4.5.1');
});

test('Piscina ignores inert inherited env and execArgv while real workers retain own options', async () => {
  const directory = temporaryDirectory();
  let pool;
  try {
    const filename = harmlessWorker(directory);
    pool = inheritedFixture(
      {
        env: { PLATFORM_AUDIT_INHERITED_ENV: 'untrusted prototype fixture' },
        execArgv: ['--trace-warnings'],
        loadBalancer: () => {
          throw new Error('inherited load balancer must never run');
        },
      },
      () => new Piscina({ filename, minThreads: 1, maxThreads: 1 }),
    );
    resources.pools.add(pool);
    assert.deepEqual(await pool.run({ value: 17 }), {
      value: 17,
      marker: null,
      inheritedTrace: false,
    });
    assert.equal(Object.getPrototypeOf(pool.options), null);
    assert.equal(pool.options.env, undefined);
    assert.equal(pool.options.execArgv, undefined);
    // Piscina4 has no active load-balancer option; this checks options isolation,
    // not a claim that this callback is an executed Mako or Piscina4 caller.
    assert.equal(pool.options.loadBalancer, undefined);
    assert.equal(pool.options.filename, filename);
    const ownPool = new Piscina({
      filename,
      minThreads: 1,
      maxThreads: 1,
      env: { PLATFORM_AUDIT_INHERITED_ENV: 'explicit owned fixture' },
    });
    resources.pools.add(ownPool);
    try {
      assert.equal((await ownPool.run({ value: 23 })).marker, 'explicit owned fixture');
    } finally {
      await disposePool(ownPool);
    }
  } finally {
    await disposePool(pool);
    removeDirectory(directory);
  }
});

test('an inherited filename cannot become a constructor option', async () => {
  const directory = temporaryDirectory();
  let pool;
  try {
    const filename = harmlessWorker(directory);
    pool = inheritedFixture({ filename: 42 }, () => new Piscina({ minThreads: 0, maxThreads: 1 }));
    resources.pools.add(pool);
    assert.equal(pool.options.filename, null);
    assert.equal((await pool.run({ value: 29 }, { filename })).value, 29);
  } finally {
    await disposePool(pool);
    removeDirectory(directory);
  }
});

test('real worker failure and acknowledged-running cancellation preserve usable pool cleanup', async () => {
  const directory = temporaryDirectory();
  let pool;
  try {
    pool = new Piscina({ filename: harmlessWorker(directory), minThreads: 1, maxThreads: 1 });
    resources.pools.add(pool);
    await assert.rejects(pool.run({ mode: 'throw' }), /owned worker rejection/u);
    const started = once(pool, 'message', { signal: AbortSignal.timeout(5000) });
    const controller = new AbortController();
    const pending = pool.run(
      { mode: 'pending', id: 'owned-running-task' },
      {
        signal: controller.signal,
      },
    );
    assert.deepEqual(await started, [{ auditStarted: 'owned-running-task' }]);
    controller.abort();
    await assert.rejects(pending, { name: 'AbortError' });
    assert.equal((await pool.run({ value: 31 })).value, 31);
  } finally {
    await disposePool(pool);
    removeDirectory(directory);
  }
});

test('the actual Mako Less plugin compiles imports, reports failures and invokes its real destroy path', async () => {
  const directory = temporaryDirectory();
  const previousDirectory = process.cwd();
  let plugin;
  let destruction;
  try {
    process.chdir(directory);
    fs.writeFileSync('palette.less', '@tone: blue;');
    fs.writeFileSync('input.less', '@import "./palette.less"; .button { color: @tone; }');
    plugin = new LessPlugin({
      root: directory,
      resolveAlias: {},
      config: { less: { modifyVars: { tone: 'red' } } },
      watch: false,
    });
    const result = await plugin.load({}, 'input.less');
    resources.pools.add(plugin.parallelLoader);
    assert.equal(result.type, 'css');
    assert.match(result.content, /\.button\s*\{\s*color:\s*red;/u);
    assert.equal(plugin.parallelLoader.options.recordTiming, false);
    assert.equal(plugin.parallelLoader.options.useAtomics, false);
    assert.equal(plugin.parallelLoader.options.minThreads, 1);
    assert.equal(plugin.parallelLoader.threads.length, 1);
    assert.ok(
      [...plugin.moduleGraph.get('input.less').deps].some((entry) =>
        entry.id.endsWith('palette.less'),
      ),
    );
    fs.writeFileSync('invalid.less', '.broken { color: @missing; }');
    await assert.rejects(plugin.load({}, 'invalid.less'), /@missing|undefined/u);
    const pool = plugin.parallelLoader;
    const destroy = pool.destroy.bind(pool);
    pool.destroy = () => {
      destruction = destroy();
      return destruction;
    };
    plugin.generateEnd();
    assert.equal(plugin.parallelLoader, undefined);
    assert.ok(destruction);
    await destruction;
    assert.equal(pool.threads.length, 0);
    resources.pools.delete(pool);
  } finally {
    if (plugin?.parallelLoader) await disposePool(plugin.parallelLoader);
    if (destruction) await destruction;
    process.chdir(previousDirectory);
    removeDirectory(directory);
  }
});

test('the actual Mako PostCSS plugin runs its installed loader and rejects malformed CSS', async () => {
  const directory = temporaryDirectory();
  const previousDirectory = process.cwd();
  let plugin;
  try {
    process.chdir(directory);
    plugin = new PostcssPlugin({ root: directory, resolveAlias: {}, config: {}, watch: false });
    const result = await plugin.transform({}, '.button { color: red }', 'input.css');
    resources.pools.add(plugin.parallelLoader);
    assert.equal(result.type, 'css');
    assert.equal(result.content, '.button { color: red }');
    assert.equal(plugin.parallelLoader.threads.length, 1);
    await assert.rejects(plugin.transform({}, '.broken {', 'invalid.css'), /Unclosed block/u);
  } finally {
    // This published PostCSS plugin has no generateEnd hook. The fixture owns
    // and awaits disposal explicitly; it does not claim an automatic build hook.
    if (plugin?.parallelLoader) await disposePool(plugin.parallelLoader);
    process.chdir(previousDirectory);
    removeDirectory(directory);
  }
});

test.after(() => {
  assert.equal(process.cwd(), repositoryRoot);
  assert.equal(resources.pools.size, 0);
  assert.equal(resources.directories.size, 0);
});
