import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseJsonBlock, parseGroupResult, parseStaleResult, parseImportantResult, parseCommandResult, parseOrganizeResult, parseDescribeResult, parseSplitResult } from '../native-host/parse.js';

test('parseOrganizeResult coerces ids to strings and requires a destination', () => {
  const m = parseOrganizeResult('{"moves":[{"bookmarkId":12,"targetFolderId":5,"reason":"ref"},{"bookmarkId":13,"newFolderPath":["Dev","X"]},{"bookmarkId":14,"reason":"no dest"}]}');
  assert.equal(m.length, 2);
  assert.equal(m[0].bookmarkId, '12');
  assert.equal(m[0].targetFolderId, '5');
  assert.deepEqual(m[1].newFolderPath, ['Dev', 'X']);
  assert.ok(!m.some((x) => x.bookmarkId === '14')); // no destination → dropped
});

test('parseJsonBlock reads plain JSON', () => {
  assert.deepEqual(parseJsonBlock('{"a":1}'), { a: 1 });
});

test('parseJsonBlock strips a code fence', () => {
  assert.deepEqual(parseJsonBlock('```json\n{"a":1}\n```'), { a: 1 });
});

test('parseJsonBlock finds JSON amid prose', () => {
  assert.deepEqual(parseJsonBlock('Here you go: {"a":1} done'), { a: 1 });
});

test('parseJsonBlock throws when no JSON present', () => {
  assert.throws(() => parseJsonBlock('nothing here'), /No JSON/);
});

test('parseJsonBlock skips prose-with-braces before the JSON answer', () => {
  assert.deepEqual(
    parseJsonBlock('Here is my plan {step 1}. Answer: {"groups":[{"name":"X","tabIds":[1]}]}'),
    { groups: [{ name: 'X', tabIds: [1] }] },
  );
});

test('parseCommandResult tolerates null/primitive model output', () => {
  assert.deepEqual(parseCommandResult('null'), { close: [], groups: [], important: [] });
});

test('parseJsonBlock strips ANSI color codes and a leading label (kiro-shaped)', () => {
  const kiro = '[38;5;141m> [0m[1mjson\n[0m[38;5;10m{"groups":[{"name":"Dev","tabIds":[1]}]}\n[0m';
  assert.deepEqual(parseJsonBlock(kiro), { groups: [{ name: 'Dev', tabIds: [1] }] });
});

test('parseJsonBlock skips a leading bracketed log line (codex/copilot-shaped)', () => {
  const logged = '[2026-07-11 10:00] thinking...\n{"close":[{"tabId":5}]}';
  assert.deepEqual(parseJsonBlock(logged), { close: [{ tabId: 5 }] });
});

test('parseJsonBlock extracts a balanced object and ignores trailing text', () => {
  assert.deepEqual(parseJsonBlock('here: {"a":{"b":1}} -- done'), { a: { b: 1 } });
});

test('parseJsonBlock does not mistake a brace inside a string for the end', () => {
  assert.deepEqual(parseJsonBlock('{"name":"a}b","x":1} trailing'), { name: 'a}b', x: 1 });
});

test('parseGroupResult coerces tabIds to ints and drops empty groups', () => {
  const g = parseGroupResult('{"groups":[{"name":"A","color":"blue","tabIds":["1",2]},{"name":"B","tabIds":[]}]}');
  assert.deepEqual(g, [{ name: 'A', color: 'blue', tabIds: [1, 2] }]);
});

test('parseStaleResult defaults suggestBookmark to false and action to close', () => {
  const s = parseStaleResult('{"close":[{"tabId":5,"reason":"old"}]}');
  assert.deepEqual(s, [{ tabId: 5, reason: 'old', suggestBookmark: false, action: 'close' }]);
});

test('parseImportantResult keeps folderPath as string array', () => {
  const i = parseImportantResult('{"important":[{"tabId":9,"folderPath":["Dev","X"],"reason":"ref"}]}');
  assert.deepEqual(i, [{ tabId: 9, folderPath: ['Dev', 'X'], reason: 'ref' }]);
});

test('parseDescribeResult trims fields and drops entries without a name', () => {
  const d = parseDescribeResult('prose {"descriptions":[{"name":" Dev ","description":"  dev stuff "},{"description":"no name"}]} trailing');
  assert.deepEqual(d, [{ name: 'Dev', description: 'dev stuff' }]);
});

test('parseDescribeResult reads a code-fenced answer leniently', () => {
  const d = parseDescribeResult('```json\n{"descriptions":[{"name":"Trip","description":"travel tabs"}]}\n```');
  assert.deepEqual(d, [{ name: 'Trip', description: 'travel tabs' }]);
});

test('parseSplitResult keeps only sent tabIds and drops unknown ones', () => {
  const g = parseSplitResult('{"groups":[{"name":"Docs","description":"reading","tabIds":[1,"2",99]}]}', [1, 2, 3]);
  assert.equal(g.length, 1);
  // 99 was never sent → dropped; 3 was sent but left out → folded into group 0.
  assert.deepEqual(g[0].tabIds.sort((a, b) => a - b), [1, 2, 3]);
});

test('parseSplitResult puts left-out tabs into the first sub-group', () => {
  const g = parseSplitResult('{"groups":[{"name":"A","tabIds":[1]},{"name":"B","tabIds":[2]}]}', [1, 2, 3, 4]);
  assert.deepEqual(g[0].tabIds, [1, 3, 4]);
  assert.deepEqual(g[1].tabIds, [2]);
});

test('parseSplitResult cleans names and descriptions to one capped line', () => {
  const longName = 'n'.repeat(100);
  const longDesc = 'd'.repeat(300);
  const g = parseSplitResult(JSON.stringify({ groups: [
    { name: `  ${longName}\u0007 `, description: `line one\nline\u0007 two`, tabIds: [1] },
    { name: 'Travel', description: longDesc, tabIds: [2] },
  ] }), [1, 2]);
  assert.equal(g[0].name.length, 60);
  assert.equal(g[0].name.includes('\u0007'), false);
  assert.equal(g[0].description, 'line one line two');
  assert.equal(g[1].description.length, 200);
});

test('parseSplitResult falls back to one group when the model drops everything', () => {
  const g = parseSplitResult('{"groups":[]}', [1, 2]);
  assert.equal(g.length, 1);
  assert.deepEqual(g[0].tabIds, [1, 2]);
});

test('parseStaleResult preserves a suspend action', () => {
  const s = parseStaleResult('{"close":[{"tabId":5,"reason":"idle","action":"suspend"}]}');
  assert.equal(s[0].action, 'suspend');
});

test('parseCommandResult returns the three optional action arrays', () => {
  const r = parseCommandResult('{"close":[{"tabId":1,"reason":"travel"}],"groups":[],"important":[]}');
  assert.equal(r.close.length, 1);
  assert.deepEqual(r.groups, []);
  assert.deepEqual(r.important, []);
});

test('parseJsonBlock stays fast on adversarial unbalanced input (scan budget)', () => {
  // A crafted body of hundreds of KB of "{" would drive the O(n^2) scan for
  // minutes without the budget cap, freezing the single-threaded host.
  const evil = '{'.repeat(300000);
  const t0 = process.hrtime.bigint();
  assert.throws(() => parseJsonBlock(evil), /No JSON found/);
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  assert.ok(ms < 500, `scan took ${ms.toFixed(0)}ms — budget cap not effective`);
});

test('parseJsonBlock still finds JSON after some leading prose/braces', () => {
  const out = parseJsonBlock('note: {partial and prose { here\nActual answer: {"groups":[{"name":"A","color":"blue","tabIds":[1,2]}]}');
  assert.deepEqual(out.groups[0].tabIds, [1, 2]);
});

test('parseJsonBlock preserves bracketed substrings in values, still strips real ANSI', () => {
  // Old stripAnsi ate a bare "[" + digits + letter anywhere → corrupted values.
  assert.deepEqual(parseJsonBlock('{"name":"Docs [v2]","g":"[Draft] Work"}'), { name: 'Docs [v2]', g: '[Draft] Work' });
  // A genuine ANSI CSI sequence (ESC-prefixed) around the JSON is still removed.
  assert.deepEqual(parseJsonBlock('\x1b[32m{"a":1}\x1b[0m'), { a: 1 });
});
