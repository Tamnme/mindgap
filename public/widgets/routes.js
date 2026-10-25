// Route table widget: longest-prefix match. Pure logic exported for tests; DOM only inside mount().
import { parseIPv4 } from './subnet.js';

const maskOf = (len) => (len === 0 ? 0 : (0xffffffff << (32 - len)) >>> 0);

export function parseCidr(str) {
  const m = /^([\d.]+)\/(\d{1,2})$/.exec(String(str).trim());
  if (!m) return null;
  const ip = parseIPv4(m[1]);
  const len = Number(m[2]);
  if (ip == null || len > 32) return null;
  return { net: (ip & maskOf(len)) >>> 0, len };
}

export function lpm(routes, dest) {
  const matches = [];
  routes.forEach((r, index) => {
    const c = parseCidr(r.prefix);
    if (c && ((dest & maskOf(c.len)) >>> 0) === c.net) matches.push({ index, len: c.len });
  });
  let winner = null, best = -1;
  for (const m of matches) if (m.len > best) { best = m.len; winner = m.index; }
  return { matches, winner };
}

export function validate(cfg) {
  const errs = [];
  if (!Array.isArray(cfg.routes) || !cfg.routes.length) return ['routes must be a non-empty array'];
  const seen = new Map();
  cfg.routes.forEach((r, i) => {
    const c = parseCidr(r && r.prefix);
    if (!c) return errs.push(`route ${i}: invalid prefix "${r && r.prefix}"`);
    if (!r.target || typeof r.target !== 'string') errs.push(`route ${i}: missing target`);
    const key = `${c.net}/${c.len}`;
    if (seen.has(key)) errs.push(`routes ${seen.get(key)} and ${i}: same prefix length /${c.len} on the same network (ambiguous tie)`);
    else seen.set(key, i);
  });
  for (const d of [cfg.dest, ...(cfg.presets || [])]) if (parseIPv4(d) == null) errs.push(`invalid address "${d}"`);
  return errs;
}

const h = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
};

export function mount(host, cfg) {
  const uid = `rt${Math.random().toString(36).slice(2, 8)}`;
  const root = h('div', 'nbroutes');
  const input = h('input'); input.type = 'text'; input.id = `${uid}-d`; input.value = cfg.dest; input.spellcheck = false; input.autocomplete = 'off';
  const lab = h('label', null, 'Destination address'); lab.htmlFor = input.id;
  const row = h('div', 'rt-row'); row.append(lab, input);
  for (const p of cfg.presets || []) {
    const b = h('button', 'rt-preset', p); b.type = 'button';
    b.addEventListener('click', () => { input.value = p; update(); });
    row.append(b);
  }
  const err = h('p', 'rt-err hidden'); err.setAttribute('role', 'alert');
  const tbody = h('tbody');
  const table = h('table', 'rt-table');
  if (cfg.caption) table.append(h('caption', null, cfg.caption));
  const head = h('tr'); for (const t of ['Prefix', 'Length', 'Target', 'Status']) head.append(h('th', null, t));
  const thead = h('thead'); thead.append(head);
  table.append(thead, tbody);
  const wrap = h('div', 'rt-wrap'); wrap.tabIndex = 0; wrap.setAttribute('role', 'region'); wrap.setAttribute('aria-label', cfg.caption || 'Route table'); wrap.append(table);
  const verdict = h('p', 'rt-verdict'); verdict.setAttribute('aria-live', 'polite');
  root.append(row, err, wrap, verdict);

  const render = (dest) => {
    const { matches, winner } = lpm(cfg.routes, dest);
    const byIdx = new Map(matches.map((m) => [m.index, m]));
    tbody.replaceChildren();
    cfg.routes.forEach((r, i) => {
      const c = parseCidr(r.prefix);
      const m = byIdx.get(i);
      const tr = h('tr', i === winner ? 'rt-win' : m ? 'rt-match' : '');
      tr.append(h('td', 'rt-mono', r.prefix), h('td', 'rt-mono', `/${c.len}`), h('td', 'rt-mono', r.target),
        h('td', 'rt-status', i === winner ? 'winner' : m ? `matches /${c.len}` : 'no match'));
      tbody.append(tr);
    });
    verdict.textContent = winner == null
      ? 'No matching route: dropped (no default route)'
      : `→ ${cfg.routes[winner].target} via ${cfg.routes[winner].prefix} (longest of ${matches.length} matching)`;
  };
  function update() {
    const v = parseIPv4(input.value);
    err.classList.toggle('hidden', v != null);
    input.setAttribute('aria-invalid', String(v == null));
    if (v == null) { err.textContent = 'Not a valid IPv4 address (four numbers 0-255). Showing the last valid result.'; return; }
    render(v);
  }
  input.addEventListener('input', update);

  host.append(root);
  render(parseIPv4(cfg.dest));
  return { destroy: () => root.remove() };
}
