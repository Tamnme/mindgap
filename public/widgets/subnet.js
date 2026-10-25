// Subnet calculator widget. Pure logic is exported for tests; DOM is touched only inside mount().

export function parseIPv4(str) {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(String(str).trim());
  if (!m) return null;
  const o = m.slice(1).map(Number);
  if (o.some((x) => x > 255)) return null;
  return ((o[0] << 24) | (o[1] << 16) | (o[2] << 8) | o[3]) >>> 0;
}

export const formatIPv4 = (n) => [24, 16, 8, 0].map((s) => (n >>> s) & 255).join('.');

export function subnetInfo(ip, prefix, { aws = false } = {}) {
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  const network = (ip & mask) >>> 0;
  const broadcast = (network | (~mask >>> 0)) >>> 0;
  const size = 2 ** (32 - prefix);
  let first = network + 1, last = broadcast - 1, usable = size - 2, note = '';
  if (prefix === 31) { first = network; last = broadcast; usable = 2; note = 'Point-to-point link, RFC 3021: both addresses are usable.'; }
  else if (prefix === 32) { first = last = network; usable = 1; note = 'A single address: the host itself.'; }
  if (aws) {
    if (prefix < 16 || prefix > 28) return { mask, network, broadcast, first, last, usable: null, note: 'not a valid VPC subnet size (AWS allows /16 to /28)' };
    usable = size - 5;
    note = 'AWS reserves 5 per subnet: network, +1 VPC router, +2 DNS, +3 reserved, broadcast';
  }
  return { mask, network, broadcast, first, last, usable, note };
}

export function validate(cfg) {
  const errs = [];
  const { minPrefix = 8, maxPrefix = 32 } = cfg;
  if (parseIPv4(cfg.ip) == null) errs.push(`invalid ip "${cfg.ip}"`);
  if (![minPrefix, maxPrefix, cfg.prefix].every((p) => Number.isInteger(p) && p >= 0 && p <= 32)) errs.push('prefix, minPrefix and maxPrefix must be integers 0-32');
  else if (minPrefix > maxPrefix || cfg.prefix < minPrefix || cfg.prefix > maxPrefix) errs.push('prefix must lie within minPrefix..maxPrefix');
  return errs;
}

const h = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
};

export function mount(host, cfg) {
  const { minPrefix = 8, maxPrefix = 32, aws = false } = cfg;
  const uid = `sn${Math.random().toString(36).slice(2, 8)}`;
  const root = h('div', 'nbsubnet');

  const ipIn = h('input'); ipIn.type = 'text'; ipIn.id = `${uid}-ip`; ipIn.value = cfg.ip; ipIn.spellcheck = false; ipIn.autocomplete = 'off';
  const ipLab = h('label', null, 'IPv4 address'); ipLab.htmlFor = ipIn.id;
  const err = h('p', 'sn-err hidden'); err.setAttribute('role', 'alert');
  const pIn = h('input'); pIn.type = 'range'; pIn.id = `${uid}-p`; pIn.min = minPrefix; pIn.max = maxPrefix; pIn.value = cfg.prefix;
  const pLab = h('label', null, 'Prefix length'); pLab.htmlFor = pIn.id;
  const pVal = h('output', 'sn-prefix'); pVal.htmlFor = pIn.id;
  const bits = h('div', 'sn-bits'); bits.setAttribute('role', 'img');
  const grid = h('dl', 'sn-grid');
  const note = h('p', 'sn-note small');
  note.setAttribute('aria-live', 'polite');

  const row1 = h('div', 'sn-row'); row1.append(ipLab, ipIn);
  const row2 = h('div', 'sn-row'); row2.append(pLab, pIn, pVal);
  root.replaceChildren(row1, err, row2, bits, grid, note);

  let ip = parseIPv4(cfg.ip);
  const render = () => {
    const p = Number(pIn.value);
    pVal.textContent = `/${p}`;
    const r = subnetInfo(ip, p, { aws });
    const ipBits = ip.toString(2).padStart(32, '0');
    bits.replaceChildren();
    for (let i = 0; i < 32; i++) {
      if (i && i % 8 === 0) bits.append(h('span', 'sn-dot', '.'));
      if (i === p) bits.append(h('span', 'sn-gap', ''));
      bits.append(h('span', i < p ? 'sn-net' : 'sn-host', ipBits[i]));
    }
    bits.setAttribute('aria-label', `${ipBits.slice(0, p) || 'no'} network bits, ${32 - p} host bits`);
    const rows = [
      ['Subnet mask', formatIPv4(r.mask)],
      ['Network address', formatIPv4(r.network)],
      ['Broadcast address', formatIPv4(r.broadcast)],
    ];
    if (r.usable == null) rows.push(['Usable hosts', 'not a valid VPC subnet size']);
    else rows.push(['First usable', formatIPv4(r.first)], ['Last usable', formatIPv4(r.last)], ['Usable hosts', r.usable.toLocaleString()]);
    grid.replaceChildren();
    for (const [k, v] of rows) { grid.append(h('dt', null, k), h('dd', null, v)); }
    note.textContent = r.note;
  };

  ipIn.addEventListener('input', () => {
    const v = parseIPv4(ipIn.value);
    err.classList.toggle('hidden', v != null);
    ipIn.setAttribute('aria-invalid', String(v == null));
    if (v == null) { err.textContent = 'Not a valid IPv4 address (use four numbers 0-255, like 10.0.1.77). Showing the last valid result.'; return; }
    ip = v;
    render();
  });
  pIn.addEventListener('input', render);

  host.append(root);
  render();
  return { destroy: () => root.remove() };
}
