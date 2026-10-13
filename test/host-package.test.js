import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'native-host', 'package.json'), 'utf8'));

test('host package is scoped, dependency-free, node>=20, has a bin', () => {
  assert.equal(pkg.name, 'browser-sanity-host');
  assert.equal(pkg.type, 'module');
  assert.match(pkg.engines.node, />=\s*20/);
  assert.ok(!pkg.dependencies || Object.keys(pkg.dependencies).length === 0);
  assert.ok(pkg.bin['browser-sanity-host']);
});

test('host package files whitelist stays inside the package dir', () => {
  for (const entry of pkg.files) assert.ok(!entry.includes('..'), `files entry escapes package: ${entry}`);
});
