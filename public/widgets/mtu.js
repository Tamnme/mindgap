// Path-MTU explorer. Pure logic exported for tests; DOM only inside mount().
export function mtuOutcome(hops, size, df, icmpBlocked) {
  const pathMtu = Math.min(...hops.map((x) => x.mtu));
  const hopIndex = hops.findIndex((x) => x.mtu < size);
  const bad = hops[hopIndex];
  if (!bad) return { kind: 'delivered', pathMtu };
  if (!df) {
    const per = Math.floor((bad.mtu - 20) / 8) * 8;
    return { kind: 'fragmented', hop: bad.name, fragments: Math.ceil((size - 20) / per), hopIndex, pathMtu };
  }
  return { kind: icmpBlocked ? 'black-hole' : 'frag-needed', hop: bad.name, hopIndex, hopMtu: bad.mtu, pathMtu };
}

export function validate(cfg) {
  const errs = [];
  if (!Array.isArray(cfg.hops) || cfg.hops.length < 2) return ['hops must be an array of at least 2 entries'];
  cfg.hops.forEach((x, i) => {
    if (!x || !x.name || typeof x.name !== 'string') errs.push(`hop ${i}: missing name`);
    if (!x || !Number.isInteger(x.mtu) || x.mtu < 68) errs.push(`hop ${i}: mtu must be an integer >= 68`);
  });
  const { size, minSize, maxSize } = cfg;
  if (![size, minSize, maxSize].every(Number.isInteger)) errs.push('size, minSize and maxSize must be integers');
  else if (minSize >= maxSize) errs.push('minSize must be less than maxSize');
  else if (size < minSize || size > maxSize) errs.push('size must be between minSize and maxSize');
  return errs;
}

const h = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
};

function text(o) {
  if (o.kind === 'delivered') return 'delivered';
  if (o.kind === 'fragmented') return `fragmented into ${o.fragments} at ${o.hop}`;
  if (o.kind === 'frag-needed') return `dropped at ${o.hop}; ICMP frag-needed (type 3 code 4, next-hop MTU ${o.hopMtu}) sent back. The sender lowers its size and retries.`;
  return `dropped at ${o.hop} silently. The sender never learns: black hole (small requests work, large responses hang).`;
}

export function mount(host, cfg) {
  const uid = `mt${Math.random().toString(36).slice(2, 8)}`;
  const root = h('div', 'nbmtu');
  const slider = h('input', 'mt-size'); slider.type = 'range'; slider.id = `${uid}-s`;
  slider.min = String(cfg.minSize); slider.max = String(cfg.maxSize); slider.value = String(cfg.size);
  const sLab = h('label', null, 'Packet size (IP bytes)'); sLab.htmlFor = slider.id;
  const sVal = h('span', 'mt-sizeval');
  const sRow = h('div', 'mt-row'); sRow.append(sLab, slider, sVal);
  const box = (cls, label, on) => {
    const i = h('input', cls); i.type = 'checkbox'; i.id = `${uid}-${cls}`; i.checked = !!on;
    const l = h('label', 'mt-check'); l.htmlFor = i.id; l.append(i, h('span', null, label));
    return [i, l];
  };
  const [df, dfLab] = box('mt-df', "DF (don't fragment)", cfg.df);
  const [icmp, icmpLab] = box('mt-icmp', 'ICMP blocked on the path', cfg.icmpBlocked);
  const cRow = h('div', 'mt-row'); cRow.append(dfLab, icmpLab);
  const path = h('ol', 'mt-path');
  const note = h('p', 'mt-note', 'IPv4 rules: routers fragment only when DF is off. IPv6 routers never fragment; they always drop and send ICMPv6 Packet Too Big.');
  const out = h('p', 'mt-outcome'); out.setAttribute('aria-live', 'polite');
  root.append(sRow, cRow, path, out, note);

  function render() {
    const size = Number(slider.value);
    const o = mtuOutcome(cfg.hops, size, df.checked, icmp.checked);
    sVal.textContent = String(size);
    path.replaceChildren(...cfg.hops.map((x, i) => {
      const bad = o.hopIndex === i;
      const li = h('li', bad ? 'mt-hop mt-bad' : 'mt-hop');
      li.append(h('span', 'mt-name', x.name), h('span', 'mt-mtu', `MTU ${x.mtu}`));
      if (bad) li.append(h('span', 'mt-flag', o.kind === 'fragmented' ? '⚠ fragments here' : '✕ dropped here'));
      return li;
    }));
    out.textContent = text(o);
    out.setAttribute('data-fail', String(o.kind !== 'delivered'));
  }
  slider.addEventListener('input', render);
  df.addEventListener('change', render);
  icmp.addEventListener('change', render);

  host.append(root);
  render();
  return { destroy: () => root.remove() };
}
