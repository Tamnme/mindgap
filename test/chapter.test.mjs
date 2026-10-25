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
      for (const l of labels) {
        assert.ok(/[A-Za-z]{3,}/.test(l.replace(/(^|\s)-\w+/g, '')) && !/^(yes|no)$/i.test(l.trim()), `${c.id} receipt label must carry a belief, not a bare value: ${JSON.stringify(l)}`);
      }
    }
    const FIRST_PERSON = /(?<![-/\w])(I|I'm|I've|I'd)(?![/\w])|\b(my|me)\b/g; // I/G, -I and quoted speech are not first person
    const prose = [...blocks.filter((b) => b.md).map((b) => b.md), ...cps.map((c) => c.why), ...blocks.filter((b) => b.lab).map((b) => b.lab.explain)];
    for (const t of prose) assert.ok(!new RegExp(FIRST_PERSON.source, 'i').test(t.replace(/`[^`]*`|"[^"]*"/g, '')), `first person in chapter text: ${t.match(new RegExp(FIRST_PERSON.source, 'i'))?.[0]} in "${t.slice(0, 60)}"`);
    for (const t of prose) assert.ok(!/\bfetch(ed|ing)?\b/i.test(t), `learner text mentions fetching: "${t.match(/.{0,40}\bfetch(ed|ing)?\b.{0,20}/i)?.[0]}"`);
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
