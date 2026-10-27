// Shape and rules for written (generated) chapters. Pure: no I/O, never mutates its inputs.
// normalizeChapter turns the model's nullable blocks into the stored shape; checkChapter says whether that is saveable.

// Raw model output -> stored shape. Does not validate. A block with both md and checkpoint set keeps both
// keys so checkChapter can refuse it; one with neither is dropped.
export function normalizeChapter(raw, { node, number, kicker }) {
  const sections = (raw?.sections ?? []).map((s) => ({
    id: s.id,
    title: s.title,
    blocks: (s.blocks ?? []).flatMap((b) => {
      const out = {};
      if (b?.md != null) out.md = b.md;
      if (b?.checkpoint != null) out.checkpoint = b.checkpoint;
      return Object.keys(out).length ? [out] : [];
    }),
  }));
  return { node, number, kicker, title: raw?.title, lede: raw?.lede, sections };
}

const str = (v) => typeof v === 'string' && v.trim() !== '';

function checkCheckpoint(c) {
  if (!c || typeof c !== 'object') return 'checkpoint must be an object';
  if (!str(c.id)) return 'checkpoint needs an id';
  const at = `checkpoint ${c.id}`;
  if (!str(c.prompt)) return `${at} needs a prompt`;
  if (!Array.isArray(c.options) || c.options.length < 3 || c.options.length > 5 || !c.options.every(str)) {
    return `${at} needs 3-5 non-empty options`;
  }
  if (!Number.isInteger(c.key) || c.key < 0 || c.key >= c.options.length) return `${at} key must be an option index`;
  if (!str(c.why)) return `${at} needs a why`;
  return null;
}

// The first problem with a stored chapter, or null when it can be saved.
export function checkChapter(ch) {
  if (!ch || typeof ch !== 'object') return 'chapter must be an object';
  if (typeof ch.node !== 'string') return 'chapter needs a node';
  if (!Number.isInteger(ch.number) || ch.number < 1) return 'chapter number must be a positive integer';
  if (typeof ch.kicker !== 'string') return 'chapter needs a kicker';
  if (!str(ch.title)) return 'chapter needs a title';
  if (!str(ch.lede)) return 'chapter needs a lede';
  if (!Array.isArray(ch.sections) || ch.sections.length < 2 || ch.sections.length > 8) {
    return 'chapter needs 2-8 sections';
  }
  const sectionIds = new Set();
  const cpIds = new Set();
  for (const s of ch.sections) {
    if (!s || !str(s.id)) return 'every section needs an id';
    if (sectionIds.has(s.id)) return `duplicate section id: ${s.id}`;
    sectionIds.add(s.id);
    if (!str(s.title)) return `section ${s.id} needs a title`;
    if (!Array.isArray(s.blocks) || s.blocks.length < 1) return `section ${s.id} needs at least one block`;
    for (const b of s.blocks) {
      if (!b || typeof b !== 'object') return `section ${s.id} has a malformed block`;
      const keys = Object.keys(b);
      const other = keys.filter((k) => k !== 'md' && k !== 'checkpoint');
      if (other.length) return `section ${s.id} has a ${other.join('/')} block; only md and checkpoint are allowed`;
      if (keys.length !== 1) return `section ${s.id} has a block that is not exactly one of md or checkpoint`;
      if ('md' in b) {
        if (!str(b.md)) return `section ${s.id} has an empty md block`;
      } else {
        const p = checkCheckpoint(b.checkpoint);
        if (p) return p;
        if (cpIds.has(b.checkpoint.id)) return `duplicate checkpoint id: ${b.checkpoint.id}`;
        cpIds.add(b.checkpoint.id);
      }
    }
  }
  if (cpIds.size < 2 || cpIds.size > 4) return `chapter needs 2-4 checkpoints, has ${cpIds.size}`;
  return null;
}
