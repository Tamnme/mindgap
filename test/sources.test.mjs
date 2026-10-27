// Self-check for lib/sources.mjs: how converted Markdown is split into sections, and their ids and headings.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { splitSections, SECTION_MAX } from '../lib/sources.mjs';

test('headings split sections, text is trimmed, ids run in document order', () => {
  assert.deepEqual(splitSections('# A\nx\n## B\ny', 's1', 'T'), [
    { id: 's1-1', heading: 'A', text: 'x' },
    { id: 's1-2', heading: 'B', text: 'y' },
  ]);
});

test('text with no headings is chunked at blank lines under the title', () => {
  const paras = Array.from({ length: 140 }, () => 'a'.repeat(100));
  const out = splitSections(paras.join('\n\n'), 's1', 'T');
  assert.equal(out.length, 3);
  assert.deepEqual(out.map((s) => s.heading), ['T', 'T (2)', 'T (3)']);
  assert.deepEqual(out.map((s) => s.id), ['s1-1', 's1-2', 's1-3']);
  for (const s of out) {
    assert.ok(s.text.length <= SECTION_MAX);
    assert.ok(s.text.split('\n\n').every((p) => p.length === 100), 'cut at a blank line');
  }
});

test('a single paragraph longer than the cap is hard-cut at the cap', () => {
  const out = splitSections('x'.repeat(7000), 's1', 'T');
  assert.deepEqual(out, [
    { id: 's1-1', heading: 'T', text: 'x'.repeat(6000) },
    { id: 's1-2', heading: 'T (2)', text: 'x'.repeat(1000) },
  ]);
});

test('a heading inside a code fence stays text', () => {
  const out = splitSections('# real\n```\n# not a heading\n```', 's1', 'T');
  assert.deepEqual(out, [{ id: 's1-1', heading: 'real', text: '```\n# not a heading\n```' }]);
});

test('four-hash lines are text, not headings', () => {
  const out = splitSections('# A\n#### deep', 's1', 'T');
  assert.deepEqual(out, [{ id: 's1-1', heading: 'A', text: '#### deep' }]);
});

test('whitespace-only sections are dropped before numbering', () => {
  const out = splitSections('# A\n\n## B\nbody', 's1', 'T');
  assert.deepEqual(out, [{ id: 's1-1', heading: 'B', text: 'body' }]);
});
