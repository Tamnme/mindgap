// mindgap switch simulator. Pure model first (no DOM, testable in node),
// then a small SVG/HTML view. Importing this module must not touch `document`.

export const BROADCAST = 'ff:ff:ff:ff:ff:ff';

// ---------- pure model ----------

function normPort(p) {
  return p.mode === 'trunk'
    ? { mode: 'trunk', vlans: [...p.vlans], native: p.native ?? 1 }
    : { mode: 'access', vlan: p.vlan };
}

// config = { switches:[{name, ports:{1:{mode:'access',vlan}, 3:{mode:'trunk',vlans,native?}}}],
//            hosts:[{name, mac, switch, port, ip?}],
//            links?:[{a:{switch,port}, b:{switch,port}}] }
export function createSwitch(config) {
  const switches = {};
  for (const s of config.switches) {
    const ports = {};
    for (const [id, p] of Object.entries(s.ports)) ports[Number(id)] = normPort(p);
    switches[s.name] = { name: s.name, ports, portIds: Object.keys(ports).map(Number).sort((a, b) => a - b), table: new Map() };
  }

  const hosts = {};
  for (const h of config.hosts) {
    const p = switches[h.switch]?.ports[h.port];
    if (!p || p.mode !== 'access') throw new Error(`${h.name}: ${h.switch} port ${h.port} is not an access port`);
    hosts[h.name] = { ...h, vlan: p.vlan };
  }

  const links = new Map();
  for (const l of config.links ?? []) {
    links.set(`${l.a.switch}:${l.a.port}`, l.b);
    links.set(`${l.b.switch}:${l.b.port}`, l.a);
  }

  const hostAt = (sw, port) => Object.values(hosts).find((h) => h.switch === sw && h.port === port);
  const member = (p, vlan) => (p.mode === 'access' ? p.vlan === vlan : p.vlans.includes(vlan));

  // Learn the source, then forward. Recursion follows trunks; `seen` guards loops.
  function forward(frame, swName, ingress, hops, seen) {
    if (seen.has(swName)) return;
    seen.add(swName);
    const s = switches[swName];
    s.table.set(`${frame.vlan}|${frame.src}`, { switch: swName, vlan: frame.vlan, mac: frame.src, port: ingress });

    const bcast = frame.dst === BROADCAST;
    const known = bcast ? null : s.table.get(`${frame.vlan}|${frame.dst}`);
    let reason;
    let egress;
    if (bcast) { reason = 'flood-broadcast'; egress = s.portIds; }
    else if (known) { reason = 'known'; egress = [known.port]; }
    else { reason = 'flood-unknown'; egress = s.portIds; }

    for (const p of egress) {
      if (p === ingress) continue;
      const port = s.ports[p];
      if (!port || !member(port, frame.vlan)) continue;
      if (port.mode === 'access') {
        const h = hostAt(swName, p);
        if (!h) continue;
        hops.push({
          from: swName, to: h.name, vlan: frame.vlan, tagged: false, reason, dst: frame.dst, port: p,
          delivered: bcast || h.mac === frame.dst,
        });
      } else {
        const far = links.get(`${swName}:${p}`);
        if (!far) continue;
        hops.push({ from: swName, to: far.switch, vlan: frame.vlan, tagged: frame.vlan !== port.native, reason, dst: frame.dst, port: p, delivered: false });
        forward(frame, far.switch, far.port, hops, seen);
      }
    }
  }

  function send(srcName, dst) {
    const src = hosts[srcName];
    if (!src) throw new Error(`unknown host ${srcName}`);
    const frame = { vlan: src.vlan, src: src.mac, dst };
    const hops = [{
      from: src.name, to: src.switch, vlan: src.vlan, tagged: false, reason: 'learned',
      mac: src.mac, port: src.port, dst, delivered: false,
    }];
    forward(frame, src.switch, src.port, hops, new Set());
    // Unicast whose target only exists in another VLAN: the switch floods its own VLAN and it never arrives.
    const blocked = dst === BROADCAST ? null : Object.values(hosts).find((h) => h.mac === dst && h.vlan !== src.vlan);
    if (blocked) {
      hops.push({ from: src.switch, to: blocked.name, vlan: src.vlan, tagged: false, reason: 'dropped-vlan', dst, port: blocked.port, delivered: false });
    }
    return hops;
  }

  function table() {
    const rows = [];
    for (const s of Object.values(switches)) {
      for (const e of s.table.values()) rows.push({ switch: s.name, vlan: e.vlan, mac: e.mac, port: e.port });
    }
    return rows.sort((a, b) => a.switch.localeCompare(b.switch) || a.vlan - b.vlan || a.mac.localeCompare(b.mac));
  }

  function reset() {
    for (const s of Object.values(switches)) s.table.clear();
  }

  return { switches: Object.keys(switches), hosts, send, table, reset };
}

// Plain-words text for one hop (used by the log; pure so it is testable).
export function describeHop(h) {
  const via = h.tagged ? `802.1Q tagged, VLAN ${h.vlan}` : `untagged, VLAN ${h.vlan}`;
  const done = h.delivered ? ' Delivered.' : '';
  switch (h.reason) {
    case 'learned': return `Switch ${h.to} learned ${h.mac} is on port ${h.port}.`;
    case 'flood-unknown': return `Unknown destination ${h.dst}: flooding out port ${h.port} to ${h.to} (${via}).${done}`;
    case 'flood-broadcast': return `Broadcast: flooding out port ${h.port} to ${h.to} (${via}).${done}`;
    case 'known': return `Known destination ${h.dst}: out port ${h.port} to ${h.to} (${via}).${done}`;
    case 'dropped-vlan': return `${h.to} is in another VLAN. This frame stays in VLAN ${h.vlan} and never reaches it.`;
    default: return h.reason;
  }
}

const host = (name, mac, sw, port, ip) => ({ name, mac, switch: sw, port, ...(ip ? { ip } : {}) });

export const SCENARIOS = {
  'switch-learning': {
    title: 'Learning from source',
    blurb: 'One switch, VLAN 1, empty MAC table. Every frame teaches the switch where its source lives.',
    layout: { S1: [115, 110], A: [10, 10], B: [180, 10], C: [95, 210] },
    topology: {
      switches: [{ name: 'S1', ports: { 1: { mode: 'access', vlan: 1 }, 2: { mode: 'access', vlan: 1 }, 3: { mode: 'access', vlan: 1 } } }],
      hosts: [host('A', 'aa:01', 'S1', 1), host('B', 'bb:02', 'S1', 2), host('C', 'cc:03', 'S1', 3)],
    },
    actions: [
      { label: 'A → C', from: 'A', dst: 'C' },
      { label: 'C → A', from: 'C', dst: 'A' },
      { label: 'B → A', from: 'B', dst: 'A' },
    ],
  },
  'switch-flood': {
    title: 'Unknown unicast vs known',
    blurb: 'Same hosts, empty table. The first frame to an unlearned MAC floods; once the switch knows the MAC, the frame goes out one port.',
    layout: { S1: [115, 110], A: [10, 10], B: [180, 10], C: [95, 210] },
    topology: {
      switches: [{ name: 'S1', ports: { 1: { mode: 'access', vlan: 1 }, 2: { mode: 'access', vlan: 1 }, 3: { mode: 'access', vlan: 1 } } }],
      hosts: [host('A', 'aa:01', 'S1', 1), host('B', 'bb:02', 'S1', 2), host('C', 'cc:03', 'S1', 3)],
    },
    actions: [
      { label: 'A → C (unknown)', from: 'A', dst: 'C' },
      { label: 'C → A (A now known)', from: 'C', dst: 'A' },
      { label: 'A → C (C now known)', from: 'A', dst: 'C' },
    ],
  },
  'vlan-broadcast': {
    title: 'VLANs stop broadcasts',
    blurb: 'All four hosts are labelled 192.168.1.0/24, but VLAN 10 and VLAN 20 are separate broadcast domains. A cannot reach C without a router.',
    layout: { S1: [115, 110], A: [10, 10], B: [180, 10], C: [10, 210], D: [180, 210] },
    topology: {
      switches: [{ name: 'S1', ports: {
        1: { mode: 'access', vlan: 10 }, 2: { mode: 'access', vlan: 10 },
        3: { mode: 'access', vlan: 20 }, 4: { mode: 'access', vlan: 20 },
      } }],
      hosts: [
        host('A', 'aa:01', 'S1', 1, '192.168.1.10'), host('B', 'bb:02', 'S1', 2, '192.168.1.11'),
        host('C', 'cc:03', 'S1', 3, '192.168.1.12'), host('D', 'dd:04', 'S1', 4, '192.168.1.13'),
      ],
    },
    actions: [
      { label: 'A ARP broadcast', from: 'A', dst: 'broadcast' },
      { label: 'C ARP broadcast', from: 'C', dst: 'broadcast' },
      { label: 'A → C (unicast)', from: 'A', dst: 'C' },
    ],
  },
  'vlan-trunk': {
    title: 'Trunk carries two VLANs',
    blurb: 'Two switches joined by a trunk allowing VLAN 10 and 20. Frames on the trunk carry an 802.1Q tag; access ports strip it.',
    layout: { S1: [10, 110], S2: [220, 110], A: [10, 10], C: [10, 210], B: [180, 10], D: [180, 210] },
    topology: {
      switches: [
        { name: 'S1', ports: { 1: { mode: 'access', vlan: 10 }, 2: { mode: 'access', vlan: 20 }, 3: { mode: 'trunk', vlans: [10, 20] } } },
        { name: 'S2', ports: { 1: { mode: 'access', vlan: 10 }, 2: { mode: 'access', vlan: 20 }, 3: { mode: 'trunk', vlans: [10, 20] } } },
      ],
      hosts: [host('A', 'aa:01', 'S1', 1), host('C', 'cc:03', 'S1', 2), host('B', 'bb:02', 'S2', 1), host('D', 'dd:04', 'S2', 2)],
      links: [{ a: { switch: 'S1', port: 3 }, b: { switch: 'S2', port: 3 } }],
    },
    actions: [
      { label: 'A → B (across trunk)', from: 'A', dst: 'B' },
      { label: 'B → A (reply)', from: 'B', dst: 'A' },
      { label: 'C → D (VLAN 20)', from: 'C', dst: 'D' },
      { label: 'A ARP broadcast', from: 'A', dst: 'broadcast' },
    ],
  },
};

// ---------- view ----------

const NS = 'http://www.w3.org/2000/svg';
const STEP_MS = 400;
const VLAN_COLOURS = { 1: '#7c8498', 10: '#2f80ed', 20: '#e0871e', 30: '#27ae60', 40: '#9b51e0' };
const colourFor = (v) => VLAN_COLOURS[v] ?? '#d64c7f';
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const reducedMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

const CSS = `
.nbsim{font:13px/1.45 system-ui,sans-serif;color:#1d1f24;color-scheme:light dark;max-width:420px;min-width:0;overflow-wrap:anywhere}
.nbsim *{box-sizing:border-box;min-width:0}
.nbsim svg{display:block;width:100%;height:auto}
.nbsim svg text{font:11px system-ui,sans-serif;fill:#1d1f24;text-anchor:middle}
.nbsim .sub{font-size:10px;fill:#4a4f5a}
.nbsim .box{fill:#e6e6e6;stroke:#8a8f99}
.nbsim .sw{fill:#cfd8ea;stroke:#6b7a99}
.nbsim .wire{stroke:#8a8f99;stroke-width:2}
.nbsim .trunk{stroke:#6b7a99;stroke-width:3;stroke-dasharray:6 3}
.nbsim .drop{fill:#d64c7f;font-size:16px;font-weight:700}
.nbsim .pk{stroke:#fff;stroke-width:1.5}
.nbsim .legend{font-size:12px;margin:4px 0}
.nbsim .sw-dot{display:inline-block;width:10px;height:10px;border-radius:50%;margin:0 3px 0 8px;vertical-align:middle}
.nbsim button{font:inherit;padding:4px 8px;margin:2px 4px 2px 0;border:1px solid rgba(128,128,128,.5);border-radius:6px;background:transparent;color:inherit;cursor:pointer;max-width:100%;overflow-wrap:anywhere}
.nbsim button:disabled{opacity:.45;cursor:default}
.nbsim label{font-size:12px}
.nbsim .log{margin:6px 0;padding-left:20px;max-height:170px;overflow:auto;font-size:12px}
.nbsim .log li{overflow-wrap:anywhere;margin:2px 0}
.nbsim table{width:100%;border-collapse:collapse;font-size:12px;table-layout:fixed}
.nbsim th,.nbsim td{text-align:left;padding:3px 4px;border-bottom:1px solid rgba(128,128,128,.3);overflow-wrap:anywhere}
@media (prefers-color-scheme:dark){
.nbsim{color:#e7e9ee}
.nbsim svg text{fill:#e7e9ee}
.nbsim .sub{fill:#b5bac6}
.nbsim .box{fill:#2a2f3a;stroke:#6b7280}
.nbsim .sw{fill:#34405a;stroke:#8fa3c9}
.nbsim .wire{stroke:#6b7280}
.nbsim .trunk{stroke:#8fa3c9}
}`;

function injectStyle() {
  if (document.getElementById('nbsim-style')) return;
  const s = document.createElement('style');
  s.id = 'nbsim-style';
  s.textContent = CSS;
  document.head.append(s);
}

// Node centre in the 340x270 viewBox. Switch boxes are 110x34, host boxes 150x40.
function centre(layout, switchNames, name) {
  const [x, y] = layout[name];
  return switchNames.has(name) ? [x + 55, y + 17] : [x + 75, y + 20];
}

function render(sc, model, vlans) {
  const { topology: topo, layout } = sc;
  const sw = new Set(model.switches);
  const c = (n) => centre(layout, sw, n);
  let wires = '';
  for (const h of topo.hosts) {
    const [x1, y1] = c(h.name);
    const [x2, y2] = c(h.switch);
    wires += `<line class="wire" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"/>`;
  }
  let trunks = '';
  for (const l of topo.links ?? []) {
    const [x1, y1] = c(l.a.switch);
    const [x2, y2] = c(l.b.switch);
    const p = topo.switches.find((s) => s.name === l.a.switch).ports[l.a.port];
    trunks += `<line class="trunk" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"/>`
      + `<text x="${(x1 + x2) / 2}" y="${y1 - 8}">tags ${p.vlans.join(',')}</text>`;
  }
  let boxes = '';
  for (const h of topo.hosts) {
    const [x, y] = layout[h.name];
    const m = model.hosts[h.name];
    const ip = m.ip ? ` · ${m.ip}` : '';
    boxes += `<rect class="box" x="${x}" y="${y}" width="150" height="40" rx="6"/>`
      + `<text x="${x + 75}" y="${y + 17}">${esc(h.name)} · ${esc(h.mac)}</text>`
      + `<text class="sub" x="${x + 75}" y="${y + 31}">VLAN ${m.vlan}${esc(ip)}</text>`;
  }
  for (const s of topo.switches) {
    const [x, y] = layout[s.name];
    boxes += `<rect class="sw" x="${x}" y="${y}" width="110" height="34" rx="6"/>`
      + `<text x="${x + 55}" y="${y + 22}">${esc(s.name)}</text>`;
  }
  const multi = model.switches.length > 1;
  const legend = vlans.map((v) => `<span class="sw-dot" style="background:${colourFor(v)}"></span>VLAN ${v}`).join(' ');
  const buttons = sc.actions.map((a, i) => `<button type="button" data-act="send" data-i="${i}">${esc(a.label)}</button>`).join('');
  return `<div class="nbsim">
  <div class="legend"><b>${esc(sc.title)}</b></div>
  <p class="legend">${esc(sc.blurb)}</p>
  <svg viewBox="0 0 340 270" role="img" aria-label="${esc(sc.title)} diagram">${wires}${trunks}${boxes}<g class="pk-layer"></g></svg>
  <div class="legend">Packet colour:${legend}</div>
  <div>${buttons}<button type="button" data-act="reset">Reset</button></div>
  <div><label><input type="checkbox" data-step> Step mode (one hop per click)</label> <button type="button" data-act="next" disabled>Next hop</button></div>
  <ol class="log" aria-live="polite"></ol>
  <table>
    <caption class="legend">Learned MAC table</caption>
    <thead><tr>${multi ? '<th>Switch</th>' : ''}<th>VLAN</th><th>MAC</th><th>Port</th></tr></thead>
    <tbody></tbody>
  </table>
</div>`;
}

export function mount(container, scenarioName) {
  const sc = SCENARIOS[scenarioName];
  if (!sc) throw new Error(`unknown scenario: ${scenarioName}`);
  injectStyle();

  const model = createSwitch(sc.topology);
  const swNames = new Set(model.switches);
  const vlanSet = new Set(Object.values(model.hosts).map((h) => h.vlan));
  for (const s of sc.topology.switches) {
    for (const p of Object.values(s.ports)) if (p.mode === 'trunk') p.vlans.forEach((v) => vlanSet.add(v));
  }
  const vlans = [...vlanSet].sort((a, b) => a - b);

  container.innerHTML = render(sc, model, vlans);
  const root = container.querySelector('.nbsim');
  const layer = root.querySelector('.pk-layer');
  const logEl = root.querySelector('.log');
  const tbody = root.querySelector('tbody');
  const nextBtn = root.querySelector('[data-act="next"]');
  const stepBox = root.querySelector('[data-step]');
  const multi = model.switches.length > 1;

  let queue = [];
  let busy = false;
  let token = 0;
  let raf = 0;
  let stepMode = false;

  function renderTable() {
    const rows = model.table();
    tbody.innerHTML = rows.length
      ? rows.map((r) => `<tr>${multi ? `<td>${esc(r.switch)}</td>` : ''}<td>${r.vlan}</td><td>${esc(r.mac)}</td><td>${r.port}</td></tr>`).join('')
      : `<tr><td colspan="${multi ? 4 : 3}"><i>(empty)</i></td></tr>`;
  }

  function logLine(text) {
    const li = document.createElement('li');
    li.textContent = text;
    logEl.appendChild(li);
    while (logEl.children.length > 60) logEl.firstChild.remove();
    logEl.scrollTop = logEl.scrollHeight;
  }

  function updateButtons() {
    nextBtn.disabled = !stepMode || busy || !queue.length;
  }

  function cancelMotion() {
    token++;
    cancelAnimationFrame(raf);
    busy = false;
    layer.replaceChildren();
  }

  // Finish whatever is pending instantly so nothing overlaps a new action.
  function flush() {
    cancelMotion();
    while (queue.length) logLine(describeHop(queue.shift()));
    updateButtons();
  }

  function animate(hop, t, done) {
    const [x1, y1] = centre(sc.layout, swNames, hop.from);
    const [x2, y2] = centre(sc.layout, swNames, hop.to);
    const dot = document.createElementNS(NS, 'circle');
    dot.setAttribute('r', '7');
    dot.setAttribute('class', 'pk');
    dot.setAttribute('fill', colourFor(hop.vlan));
    layer.appendChild(dot);
    const end = hop.reason === 'dropped-vlan' ? 0.5 : 1;
    const start = performance.now();
    const frame = (now) => {
      if (t !== token) { dot.remove(); return; }
      const k = Math.min(1, (now - start) / STEP_MS) * end;
      const cx = x1 + (x2 - x1) * k;
      const cy = y1 + (y2 - y1) * k;
      dot.setAttribute('cx', cx);
      dot.setAttribute('cy', cy);
      if (k < end) { raf = requestAnimationFrame(frame); return; }
      dot.remove();
      if (end < 1) {
        const x = document.createElementNS(NS, 'text');
        x.setAttribute('class', 'drop');
        x.setAttribute('x', cx);
        x.setAttribute('y', cy + 5);
        x.textContent = '×';
        layer.appendChild(x);
      }
      done();
    };
    raf = requestAnimationFrame(frame);
  }

  // Log and show the next queued hop. onDone runs after its animation (or at once with reduced motion).
  function step(t, onDone) {
    const hop = queue.shift();
    logLine(describeHop(hop));
    if (reducedMotion()) { onDone(); return; }
    busy = true;
    animate(hop, t, () => { busy = false; onDone(); });
  }

  function playAll(t) {
    if (t !== token || !queue.length) { updateButtons(); return; }
    step(t, () => playAll(t));
  }

  function act(a) {
    flush();
    const dst = a.dst === 'broadcast' ? BROADCAST : model.hosts[a.dst].mac;
    logLine(`${a.label}: ${a.from} sends a frame to ${a.dst === 'broadcast' ? 'everyone (broadcast)' : a.dst}`);
    queue = model.send(a.from, dst);
    renderTable();
    if (stepMode) updateButtons();
    else playAll(token);
  }

  function reset() {
    flush();
    model.reset();
    logLine('MAC table cleared.');
    renderTable();
  }

  root.addEventListener('click', (ev) => {
    const b = ev.target.closest('button');
    if (!b || !root.contains(b)) return;
    if (b.dataset.act === 'send') act(sc.actions[Number(b.dataset.i)]);
    else if (b.dataset.act === 'reset') reset();
    else if (b.dataset.act === 'next' && !busy && queue.length) step(token, updateButtons);
    updateButtons();
  });

  stepBox.addEventListener('change', () => {
    stepMode = stepBox.checked;
    if (!stepMode && !busy && queue.length) playAll(token);
    updateButtons();
  });

  renderTable();
  updateButtons();

  return {
    destroy() {
      cancelMotion();
      container.innerHTML = '';
    },
  };
}
