// Pure chapter rules (no DOM), shared by chapter.js and the tests.

// Index into blocks (in reading order) of the first checkpoint not yet answered or skipped.
// Every block after it is locked. Returns blocks.length when nothing is locked.
export function firstOpenCheckpoint(blocks, answers) {
  const i = blocks.findIndex((b) => b.checkpoint && !answers[b.checkpoint.id]);
  return i === -1 ? blocks.length : i;
}

export function flatBlocks(chapter) {
  return chapter.sections.flatMap((s) => s.blocks.map((b) => ({ ...b, section: s.id })));
}

// The learner event for a committed answer. The key travels with it so the tutor never has to guess.
export function answerEvent(cp, chosenIndex, confidence, reasoning) {
  return {
    type: 'checkpoint',
    id: cp.id,
    prompt: cp.prompt,
    options: cp.options,
    chosen: cp.options[chosenIndex],
    key: cp.options[cp.key],
    correct: chosenIndex === cp.key,
    confidence,
    ...(reasoning ? { reasoning } : {}),
  };
}

// Latest checkpoint event per id from a lesson transcript.
export function answersFrom(events) {
  const answers = {};
  for (const ev of events) {
    if (ev.role === 'learner' && ev.data?.type === 'checkpoint') answers[ev.data.id] = ev.data;
  }
  return answers;
}

// locked: starts after the open checkpoint; done: every block is before it; open: holds it.
export function sectionState(chapter, answers) {
  const blocks = flatBlocks(chapter);
  const open = firstOpenCheckpoint(blocks, answers);
  return Object.fromEntries(chapter.sections.map((s) => {
    const idx = blocks.map((b, i) => (b.section === s.id ? i : -1)).filter((i) => i >= 0);
    return [s.id, idx[0] > open ? 'locked' : idx.at(-1) < open ? 'done' : 'open'];
  }));
}
