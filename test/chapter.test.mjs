// Self-check for the chapter format, the pilot chapter's content, and the gating rules.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { firstOpenCheckpoint, flatBlocks, answerEvent, answersFrom, sectionState } from '../public/chapter-logic.js';

const PUB = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
const ids = JSON.parse(await readFile(path.join(PUB, 'chapters', 'index.json'), 'utf8'));
const map = JSON.parse(await readFile(path.join(PUB, '..', 'learner', 'map.json'), 'utf8'));

for (const id of ids) {
  test(`chapter ${id} is well formed`, async () => {
    const ch = (await import(`../public/chapters/${id}.js`)).default;
    assert.equal(ch.node, id);
    assert.ok(map.nodes.some((n) => n.id === id), 'chapter node exists on the map');
    const blocks = flatBlocks(ch);
    const cps = blocks.filter((b) => b.checkpoint).map((b) => b.checkpoint);
    assert.ok(cps.length >= 2 && cps.length <= 4, '2-4 checkpoints per chapter');
    assert.equal(new Set(cps.map((c) => c.id)).size, cps.length, 'checkpoint ids unique');
    for (const c of cps) {
      assert.ok(Number.isInteger(c.key) && c.key >= 0 && c.key < c.options.length, `${c.id} key in range`);
      assert.ok(c.prompt && c.why, `${c.id} has prompt and why`);
      const labels = c.options.map((o) => String(o).split(': ')[0]);
      assert.equal(new Set(labels).size, labels.length, `${c.id} receipt labels are distinct: ${JSON.stringify(labels)}`);
    }
    for (const b of blocks) {
      const kinds = ['md', 'checkpoint', 'widget', 'lab'].filter((k) => b[k]);
      assert.equal(kinds.length, 1, 'each block is exactly one kind');
      if (b.widget) {
        const mod = await import(`../public/widgets/${b.widget.kind || 'sim'}.js`);
        assert.deepEqual(mod.validate(b.widget), [], `widget ${b.widget.id} config valid`);
      }
      if (b.lab) assert.ok(b.lab.cmd.length <= 4000, 'lab fits the server limit');
    }
  });
}

test('gating: the first unanswered checkpoint locks everything after it', () => {
  const blocks = [{ md: 'a' }, { checkpoint: { id: 'c1' } }, { md: 'b' }, { checkpoint: { id: 'c2' } }, { md: 'c' }];
  assert.equal(firstOpenCheckpoint(blocks, {}), 1);
  assert.equal(firstOpenCheckpoint(blocks, { c1: { skipped: true } }), 3);
  assert.equal(firstOpenCheckpoint(blocks, { c1: {}, c2: {} }), 5);
});

test('section states follow the open checkpoint', () => {
  const ch = { sections: [
    { id: 's1', blocks: [{ md: 'a' }, { checkpoint: { id: 'c1' } }, { md: 'b' }] },
    { id: 's2', blocks: [{ md: 'c' }, { checkpoint: { id: 'c2' } }] },
    { id: 's3', blocks: [{ md: 'd' }] },
  ] };
  assert.deepEqual(sectionState(ch, {}), { s1: 'open', s2: 'locked', s3: 'locked' });
  assert.deepEqual(sectionState(ch, { c1: {} }), { s1: 'done', s2: 'open', s3: 'locked' });
  assert.deepEqual(sectionState(ch, { c1: {}, c2: {} }), { s1: 'done', s2: 'done', s3: 'done' });
});

test('answer events carry the key and are restored from the transcript', () => {
  const cp = { id: 'c1', prompt: 'p', options: ['x', 'y'], key: 1 };
  const ev = answerEvent(cp, 0, 3, '');
  assert.deepEqual(ev, { type: 'checkpoint', id: 'c1', prompt: 'p', options: ['x', 'y'], chosen: 'x', key: 'y', correct: false, confidence: 3 });
  assert.equal(answerEvent(cp, 1, 5, 'because').reasoning, 'because');
  const restored = answersFrom([
    { role: 'learner', data: ev },
    { role: 'tutor', data: { say: '' } },
    { role: 'learner', data: { type: 'ask', text: '?' } },
    { role: 'learner', data: { ...ev, chosen: 'y', correct: true } },
  ]);
  assert.deepEqual(Object.keys(restored), ['c1']);
  assert.equal(restored.c1.correct, true);
});
