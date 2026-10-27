// Source helpers: the caps, the id check, and the split of converted Markdown into sections.
// Pure: no I/O. Later tasks add the fetch, convert and store functions.

export const MB = 1024 * 1024;
export const FETCH_MAX = 10 * MB;
export const FETCH_TIMEOUT_MS = 30_000;
export const UPLOAD_MAX = 20 * MB;
export const CONVERT_TIMEOUT_MS = 60_000;
export const TEXT_MAX = 1 * MB;
export const SECTION_MAX = 6000;
export const EXCERPT_MAX = 20000;
export const READ_MAX = 5;

// Same rule as server.mjs: ids are safe as file names and URL segments.
export function validId(id) {
  return typeof id === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(id);
}

// Markdown → [{id, heading, text}]. A section is the text under one #–### heading (fences respected).
// Text before the first heading takes the title. Sections over SECTION_MAX are cut into chunks.
// ponytail: whole-text string slicing per chunk; fine at TEXT_MAX, revisit only if sources get huge.
export function splitSections(markdown, sourceId, title) {
  const raw = [];
  let cur = { heading: title, lines: [] };
  let fenced = false;
  for (const line of markdown.split('\n')) {
    if (/^```/.test(line)) fenced = !fenced;
    const m = !fenced && /^#{1,3} +(.+)$/.exec(line);
    if (m) {
      raw.push(cur);
      cur = { heading: m[1].trim(), lines: [] };
    } else {
      cur.lines.push(line);
    }
  }
  raw.push(cur);

  const out = [];
  for (const { heading, lines } of raw) {
    let rest = lines.join('\n').trim();
    for (let part = 1; rest; part++) {
      const chunk = takeChunk(rest);
      rest = chunk.rest;
      out.push({ heading: part === 1 ? heading : `${heading} (${part})`, text: chunk.text });
    }
  }
  return out.map((s, i) => ({ id: `${sourceId}-${i + 1}`, heading: s.heading, text: s.text }));
}

// The first chunk of a trimmed, non-empty text: the longest prefix ending at a blank line
// whose trimmed length is within SECTION_MAX; with no such line, a hard cut at SECTION_MAX.
function takeChunk(text) {
  if (text.length <= SECTION_MAX) return { text, rest: '' };
  const blank = /\n[ \t]*\n/g;
  let cut = null;
  for (let m; (m = blank.exec(text)); ) {
    if (text.slice(0, m.index).trimEnd().length > SECTION_MAX) break;
    cut = m;
  }
  if (!cut) return { text: text.slice(0, SECTION_MAX).trim(), rest: text.slice(SECTION_MAX).trim() };
  return { text: text.slice(0, cut.index).trim(), rest: text.slice(cut.index + cut[0].length).trim() };
}
