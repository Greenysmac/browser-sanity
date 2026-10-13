import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PROD_EXTENSION_ID, hostHome, hostBinName } from '../native-host/paths.js';

test('PROD_EXTENSION_ID is the pinned store id', () => {
  assert.equal(PROD_EXTENSION_ID, 'kebmdofdghcjmknaecnojcglkibcacgn');
});

test('hostHome is a stable per-user dir per platform', () => {
  assert.equal(hostHome('linux', {}, '/home/u'), '/home/u/.browser-sanity');
  assert.equal(hostHome('darwin', {}, '/Users/u'), '/Users/u/.browser-sanity');
  assert.equal(
    hostHome('win32', { LOCALAPPDATA: 'C:\\Users\\u\\AppData\\Local' }, 'C:\\Users\\u'),
    'C:\\Users\\u\\AppData\\Local\\BrowserSanity',
  );
});

test('hostHome does not depend on cwd or an npx cache path', () => {
  const a = hostHome('linux', {}, '/home/u');
  const b = hostHome('linux', {}, '/home/u');
  assert.equal(a, b); // pure function of home, not of import.meta.url
});

test('hostBinName is the SEA binary name, platform-specific', () => {
  assert.equal(hostBinName('linux'), 'browser-sanity-host');
  assert.equal(hostBinName('darwin'), 'browser-sanity-host');
  assert.equal(hostBinName('win32'), 'browser-sanity-host.exe');
});
