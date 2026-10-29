import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

// The server rejects a POST without a JSON content-type (400). Twice a UI POST
// shipped without it with every test green (f2 Write chapter, design-pass Cancel),
// because the test client always sets the header. This scans the browser code instead.
const PUBLIC = path.join(import.meta.dirname, '..', 'public');

// For each `method: 'POST'`, the enclosing object literal must carry the header.
export function postsWithoutJsonType(src) {
  const bad = [];
  for (const m of src.matchAll(/method:\s*['"]POST['"]/g)) {
    let depth = 0, start = m.index;
    for (; start >= 0; start--) {
      if (src[start] === '}') depth++;
      else if (src[start] === '{' && depth-- === 0) break;
    }
    let end = m.index;
    for (depth = 0; end < src.length; end++) {
      if (src[end] === '{') depth++;
      else if (src[end] === '}' && depth-- === 0) break;
    }
    const init = src.slice(start, end + 1);
    if (!/['"]content-type['"]\s*:\s*['"]application\/json['"]/i.test(init)) {
      bad.push(src.slice(0, m.index).split('\n').length);
    }
  }
  return bad;
}

test('the scanner flags a POST without the header (positive control)', () => {
  assert.deepEqual(postsWithoutJsonType("fetch(u, { method: 'POST', body: '{}' });"), [1]);
  assert.deepEqual(postsWithoutJsonType("fetch(u, {\n  method: 'POST',\n  headers: { 'content-type': 'application/json' },\n});"), []);
});

test('every UI POST sends a JSON content-type', async () => {
  const files = (await readdir(PUBLIC)).filter((f) => f.endsWith('.js'));
  const offenders = [];
  for (const f of files) {
    for (const line of postsWithoutJsonType(await readFile(path.join(PUBLIC, f), 'utf8'))) {
      offenders.push(`public/${f}:${line}`);
    }
  }
  assert.deepEqual(offenders, [], `POST without 'content-type': 'application/json'`);
});
