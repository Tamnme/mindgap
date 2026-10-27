// Self-check for lib/chapters.mjs: normalising a written chapter and the rules it must pass to be saved.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { normalizeChapter, checkChapter } from '../lib/chapters.mjs';

const meta = { node: 'n1', number: '3', kicker: 'Layer 1' };
const cp = (id, over = {}) => ({ checkpoint: { id, prompt: 'Which?', options: ['a', 'b', 'c'], key: 1, why: 'because', ...over } });
function good() {
  return {
    ...meta, title: 'T', lede: 'L',
    sections: [
      { id: 's1', title: 'One', blocks: [{ md: 'text' }, cp('c1')] },
      { id: 's2', title: 'Two', blocks: [cp('c2')] },
    ],
  };
}
const withCp = (n) => {
  const c = good();
  c.sections[0].blocks = Array.from({ length: n }, (_, i) => cp(`k${i}`));
  c.sections[1].blocks = [{ md: 'x' }];
  return c;
};

test('a valid chapter returns null', () => assert.equal(checkChapter(good()), null));

test('invalid chapters get a problem naming it', () => {
  const bad = (fn, re) => { const c = good(); fn(c); assert.match(checkChapter(c), re); };
  bad((c) => { delete c.sections[0].blocks[1].checkpoint.why; }, /why/);
  bad((c) => { c.sections[0].blocks[1].checkpoint.key = 3; }, /key/);
  bad((c) => { c.sections[0].blocks[1].checkpoint.key = 1.5; }, /key/);
  bad((c) => { c.sections[1].blocks = [{ md: 'x' }]; }, /checkpoint/);
  bad((c) => { c.sections[0].blocks[0] = { md: 'x', checkpoint: cp('z').checkpoint }; }, /exactly one/);
  bad((c) => { c.sections[1].blocks[0].checkpoint.id = 'c1'; }, /duplicate|twice/);
  bad((c) => { c.sections[1].id = 's1'; }, /duplicate|twice/);
  bad((c) => { c.sections.pop(); }, /section/);
  bad((c) => { c.title = ' '; }, /title/);
  bad((c) => { c.lede = ''; }, /lede/);
  bad((c) => { c.sections[0].blocks[0] = { md: '' }; }, /md/);
  bad((c) => { c.sections[0].blocks = []; }, /block/);
  bad((c) => { c.sections[0].blocks[1].checkpoint.options = ['a', 'b']; }, /options/);
  bad((c) => { c.sections[0].blocks[1].checkpoint.options = ['a', 'b', 'c', 'd', 'e', 'f']; }, /options/);
  bad((c) => { c.sections[0].blocks[1].checkpoint.options = ['a', '', 'c']; }, /options/);
  bad((c) => { c.sections[0].blocks[1].checkpoint.prompt = ''; }, /prompt/);
  bad((c) => { c.sections[0].blocks.push({ lab: { id: 'x' } }); }, /lab/);
  bad((c) => { c.sections[0].blocks.push({ widget: 'w' }); }, /widget/);
  bad((c) => { c.number = 3; }, /number/);
  bad((c) => { delete c.node; }, /node/);
  bad((c) => { c.kicker = 1; }, /kicker/);
});

test('checkpoint count must be 2-4 and section count 2-8', () => {
  assert.equal(checkChapter(withCp(4)), null);
  assert.match(checkChapter(withCp(5)), /checkpoint/);
  const c = good();
  c.sections = Array.from({ length: 9 }, (_, i) => ({ id: `s${i}`, title: 't', blocks: [cp(`k${i}`)] }));
  assert.match(checkChapter(c), /section/);
});

test('normalizeChapter maps nullable blocks to the stored shape and adds metadata', () => {
  const out = normalizeChapter({
    title: 'T', lede: 'L', extra: 1,
    sections: [{ id: 's', title: 'S', blocks: [
      { md: 'hi', checkpoint: null }, { md: null, checkpoint: cp('c').checkpoint }, { md: null, checkpoint: null },
      { md: 'both', checkpoint: cp('d').checkpoint },
    ] }],
  }, meta);
  assert.deepEqual(Object.keys(out), ['node', 'number', 'kicker', 'title', 'lede', 'sections']);
  assert.deepEqual(out.sections[0].blocks[0], { md: 'hi' });
  assert.deepEqual(Object.keys(out.sections[0].blocks[1]), ['checkpoint']);
  assert.equal(out.sections[0].blocks.length, 3); // empty block dropped
  assert.equal(Object.keys(out.sections[0].blocks[2]).length, 2); // both kept for checkChapter
  assert.equal(normalizeChapter({}, { ...meta, number: 3 }).number, '3');
  assert.equal(out.number, '3');
});

test('a real model output normalises to a valid chapter', () => {
  const raw = JSON.parse(readFileSync(new URL('./fixtures/chapter-raw.json', import.meta.url), 'utf8'));
  assert.equal(checkChapter(normalizeChapter(raw, meta)), null);
});

test('shipped networking chapters fail only for lab/widget blocks', () => {
  const dir = new URL('../courses/networking/chapters/', import.meta.url);
  for (const f of readdirSync(dir).filter((f) => f.endsWith('.json') && f !== 'index.json')) {
    const ch = JSON.parse(readFileSync(new URL(f, dir), 'utf8'));
    const extra = (b) => Object.keys(b).some((k) => k === 'lab' || k === 'widget');
    const has = ch.sections.some((s) => s.blocks.some(extra));
    const problem = checkChapter(ch);
    if (has) assert.match(problem, /lab|widget/, f); else assert.equal(problem, null, f);
    const stripped = { ...ch, sections: ch.sections.map((s) => ({ ...s, blocks: s.blocks.filter((b) => !extra(b)) })) };
    assert.equal(checkChapter(stripped), null, f);
  }
});
