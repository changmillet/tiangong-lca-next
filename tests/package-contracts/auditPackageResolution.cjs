const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');

const repositoryRoot = path.resolve(__dirname, '../..');
const rootRequire = createRequire(path.join(repositoryRoot, 'package.json'));
const virtualStore = path.join(repositoryRoot, 'node_modules/.pnpm');
const directories = fs.readdirSync(virtualStore, { withFileTypes: true });
const packageCache = new Map();

function packageCopies(name) {
  if (packageCache.has(name)) return packageCache.get(name);
  const prefix = name.replaceAll('/', '+') + '@';
  const copies = directories
    .filter((entry) => entry.isDirectory() && entry.name.startsWith(prefix))
    .map((entry) => path.join(virtualStore, entry.name, 'node_modules', name))
    .filter((directory) => fs.existsSync(path.join(directory, 'package.json')))
    .map((directory) => {
      const manifestPath = path.join(directory, 'package.json');
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
      assert.equal(manifest.name, name);
      return {
        directory: fs.realpathSync(directory),
        manifest,
        require: createRequire(manifestPath),
      };
    });
  packageCache.set(name, copies);
  return copies;
}

function onePackage(name, major) {
  const copies = packageCopies(name).filter(
    (copy) => major === undefined || copy.manifest.version.startsWith(String(major) + '.'),
  );
  const versions = [...new Set(copies.map((copy) => copy.manifest.version))];
  assert.equal(versions.length, 1, name + ' must have one installed version in this cohort');
  assert.ok(copies.length > 0, name + ' must resolve from the frozen graph');
  return copies[0];
}

function loadPackage(copy) {
  return copy.require(copy.manifest.name);
}

function packageFromParent(parentCopy, name) {
  const entry = fs.realpathSync(parentCopy.require.resolve(name));
  let directory = path.dirname(entry);
  while (directory !== path.dirname(directory)) {
    const filename = path.join(directory, 'package.json');
    if (fs.existsSync(filename)) {
      const manifest = JSON.parse(fs.readFileSync(filename, 'utf8'));
      if (manifest.name === name) {
        return {
          directory,
          manifest,
          entry,
          require: createRequire(filename),
        };
      }
    }
    directory = path.dirname(directory);
  }
  throw new Error('Cannot bind installed dependency ' + name);
}

module.exports = {
  repositoryRoot,
  rootRequire,
  packageCopies,
  onePackage,
  loadPackage,
  packageFromParent,
};
