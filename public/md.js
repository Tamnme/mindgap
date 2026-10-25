// Safe markdown subset for tutor bubbles. Pure function, no DOM access.
// Every character of model text is HTML-escaped before any markup is added,
// so the only tags in the output are the ones this file emits.

export function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Inline: code spans are cut out first so their contents are never formatted.
// Links only survive for http(s) and mailto; anything else stays as literal text.
function renderInline(text) {
  const parts = escapeHtml(text).split(/`([^`\n]+)`/);
  return parts.map((part, i) => {
    if (i % 2 === 1) return `<code>${part}</code>`;
    return part
      .replace(/\[([^\]\n]+)\]\((https?:\/\/[^\s)]+|mailto:[^\s)]+)\)/g,
        (_, label, href) => `<a href="${href}" target="_blank" rel="noopener noreferrer">${label}</a>`)
      .replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
      .replace(/\*([^*\n]+)\*/g, '<em>$1</em>');
  }).join('');
}

const LIST_RE = /^\s*[-*]\s+(.*)$/;
const FENCE_RE = /^\s*```/;

export function renderMarkdown(src) {
  const lines = String(src ?? '').replace(/\r\n?/g, '\n').split('\n');
  const out = [];
  let para = [];
  let list = [];

  const flushPara = () => {
    if (para.length) out.push(`<p>${para.map(renderInline).join('<br>')}</p>`);
    para = [];
  };
  const flushList = () => {
    if (list.length) out.push(`<ul>${list.map(li => `<li>${renderInline(li)}</li>`).join('')}</ul>`);
    list = [];
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (FENCE_RE.test(line)) {
      flushPara(); flushList();
      const code = [];
      i++;
      while (i < lines.length && !FENCE_RE.test(lines[i])) code.push(lines[i++]);
      out.push(`<pre><code>${escapeHtml(code.join('\n'))}</code></pre>`);
      continue;
    }

    const h = line.match(/^(#{1,4})\s+(.*)$/);
    if (h) {
      flushPara(); flushList();
      const lvl = Math.min(h[1].length + 2, 6); // inside a bubble: # → h3
      out.push(`<h${lvl}>${renderInline(h[2])}</h${lvl}>`);
      continue;
    }

    // Blockquote, incl. GitHub-style callouts "> [!IMPORTANT]".
    if (/^\s*>/.test(line)) {
      flushPara(); flushList();
      const q = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) q.push(lines[i++].replace(/^\s*>\s?/, ''));
      i--;
      const kind = q[0]?.match(/^\[!(\w+)\]\s*$/);
      if (kind) q.shift();
      const cls = kind ? ` class="callout callout-${kind[1].toLowerCase()}"` : '';
      out.push(`<blockquote${cls}>${renderMarkdown(q.join('\n'))}</blockquote>`);
      continue;
    }

    // Table: consecutive lines starting with "|"; a |---| row separates header from body.
    if (/^\s*\|/.test(line)) {
      flushPara(); flushList();
      const rows = [];
      while (i < lines.length && /^\s*\|/.test(lines[i])) rows.push(lines[i++]);
      i--;
      const cells = r => r.trim().replace(/^\||\|$/g, '').split('|').map(c => renderInline(c.trim()));
      const isSep = r => /^\s*\|?[\s:|-]+\|?\s*$/.test(r) && r.includes('-');
      const hasHead = rows.length > 1 && isSep(rows[1]);
      const head = hasHead ? `<thead><tr>${cells(rows[0]).map(c => `<th>${c}</th>`).join('')}</tr></thead>` : '';
      const body = (hasHead ? rows.slice(2) : rows).filter(r => !isSep(r))
        .map(r => `<tr>${cells(r).map(c => `<td>${c}</td>`).join('')}</tr>`).join('');
      out.push(`<div class="table-wrap"><table>${head}<tbody>${body}</tbody></table></div>`);
      continue;
    }

    const m = line.match(LIST_RE) || line.match(/^\s*\d+[.)]\s+(.*)$/);
    if (m) {
      flushPara();
      list.push(m[1]);
      continue;
    }

    if (line.trim() === '') {
      flushPara(); flushList();
      continue;
    }

    flushList();
    para.push(line);
  }
  flushPara(); flushList();
  return out.join('\n');
}
