import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseIPv4, formatIPv4, subnetInfo, validate } from '../public/widgets/subnet.js';

const info = (ip, p, o) => {
  const r = subnetInfo(parseIPv4(ip), p, o);
  return r && { ...r, mask: formatIPv4(r.mask), network: formatIPv4(r.network), broadcast: formatIPv4(r.broadcast), first: formatIPv4(r.first), last: formatIPv4(r.last) };
};

test('parse/format IPv4', () => {
  assert.equal(parseIPv4('10.0.1.77'), 0x0a00014d);
  assert.equal(formatIPv4(0x0a00014d), '10.0.1.77');
  assert.equal(formatIPv4(0xffffffff), '255.255.255.255');
  for (const bad of ['', '1.2.3', '1.2.3.4.5', '256.1.1.1', 'a.b.c.d', '1.2.3.-4', '01.2.3.4x', ' ', '1..2.3']) assert.equal(parseIPv4(bad), null, bad);
});

test('/24', () => {
  const r = info('10.0.1.77', 24);
  assert.deepEqual([r.mask, r.network, r.broadcast, r.first, r.last, r.usable], ['255.255.255.0', '10.0.1.0', '10.0.1.255', '10.0.1.1', '10.0.1.254', 254]);
});

test('/26', () => {
  const r = info('10.0.1.77', 26);
  assert.deepEqual([r.mask, r.network, r.broadcast, r.first, r.last, r.usable], ['255.255.255.192', '10.0.1.64', '10.0.1.127', '10.0.1.65', '10.0.1.126', 62]);
});

test('/31 point-to-point', () => {
  const r = info('10.0.1.77', 31);
  assert.equal(r.usable, 2);
  assert.equal(r.first, '10.0.1.76');
  assert.equal(r.last, '10.0.1.77');
  assert.match(r.note, /3021/);
});

test('/32 single host', () => {
  const r = info('10.0.1.77', 32);
  assert.equal(r.usable, 1);
  assert.equal(r.first, '10.0.1.77');
  assert.equal(r.last, '10.0.1.77');
});

test('/0 edge', () => {
  const r = info('10.0.1.77', 0);
  assert.deepEqual([r.mask, r.network, r.broadcast, r.usable], ['0.0.0.0', '0.0.0.0', '255.255.255.255', 4294967294]);
});

test('AWS', () => {
  assert.equal(info('10.0.1.77', 28, { aws: true }).usable, 11);
  assert.equal(info('10.0.0.0', 16, { aws: true }).usable, 65531);
  const bad = info('10.0.1.77', 29, { aws: true });
  assert.equal(bad.usable, null);
  assert.match(bad.note, /not a valid VPC subnet size/);
  assert.equal(info('10.0.1.77', 15, { aws: true }).usable, null);
});

test('validate', () => {
  assert.deepEqual(validate({ ip: '10.0.1.77', prefix: 26, minPrefix: 8, maxPrefix: 32 }), []);
  assert.ok(validate({ ip: 'x', prefix: 26 }).length);
  assert.ok(validate({ ip: '10.0.0.1', prefix: 40 }).length);
});

import { parseCidr, lpm, validate as validateRoutes } from '../public/widgets/routes.js';

const R = (...p) => p.map((prefix) => ({ prefix, target: 't' }));
const win = (rs, d) => lpm(rs, parseIPv4(d));

test('routes: parseCidr', () => {
  assert.deepEqual(parseCidr('10.0.0.0/16'), { net: 0x0a000000, len: 16 });
  assert.deepEqual(parseCidr('10.0.3.4/16'), { net: 0x0a000000, len: 16 });
  assert.deepEqual(parseCidr('0.0.0.0/0'), { net: 0, len: 0 });
  for (const bad of ['10.0.0.0', '10.0.0.0/33', '10.0.0.0/-1', '10.0.0/8', '10.0.0.0/x', '']) assert.equal(parseCidr(bad), null, bad);
});

test('routes: lpm overlapping /8 /16 /24 /32', () => {
  const rs = R('10.0.0.0/8', '10.0.0.0/16', '10.0.3.0/24', '10.0.3.4/32');
  assert.equal(win(rs, '10.0.3.4').winner, 3);
  assert.equal(win(rs, '10.0.3.4').matches.length, 4);
  assert.equal(win(rs, '10.0.3.5').winner, 2);
  assert.equal(win(rs, '10.0.9.9').winner, 1);
  assert.equal(win(rs, '10.9.9.9').winner, 0);
});

test('routes: default only, no match, /32 beats /24', () => {
  assert.deepEqual(win(R('0.0.0.0/0'), '8.8.8.8'), { matches: [{ index: 0, len: 0 }], winner: 0 });
  assert.deepEqual(win(R('10.0.0.0/16'), '8.8.8.8'), { matches: [], winner: null });
  assert.equal(win(R('10.0.3.0/24', '10.0.3.4/32'), '10.0.3.4').winner, 1);
});

test('routes: validate', () => {
  const ok = { routes: R('10.0.0.0/16', '0.0.0.0/0'), dest: '10.0.3.4' };
  assert.deepEqual(validateRoutes(ok), []);
  assert.ok(validateRoutes({ ...ok, routes: R('10.0.0.0/16', '10.0.1.2/16') }).length);
  assert.ok(validateRoutes({ ...ok, routes: R('10.0.0.0/33') }).length);
  assert.ok(validateRoutes({ ...ok, dest: 'nope' }).length);
  assert.ok(validateRoutes({ ...ok, presets: ['1.2.3'] }).length);
});

import { mount as mountRoutes } from '../public/widgets/routes.js';

test('routes: mount runs against a fake DOM and renders winner + verdict', () => {
  const mk = (tag) => {
    const el = { tag, children: [], attrs: {}, listeners: {}, textContent: '', className: '',
      classList: { toggle() {} },
      append(...k) { this.children.push(...k); }, // returns undefined, like the real DOM
      replaceChildren(...k) { this.children = k; },
      setAttribute(k, v) { this.attrs[k] = v; },
      addEventListener(t, f) { this.listeners[t] = f; },
      remove() {} };
    return el;
  };
  const prev = globalThis.document;
  globalThis.document = { createElement: mk };
  try {
    const host = mk('div');
    const w = mountRoutes(host, { routes: R('10.0.0.0/16', '0.0.0.0/0'), dest: '10.0.3.4', presets: ['8.8.8.8'] });
    const flat = (e) => [e, ...e.children.flatMap(flat)];
    const all = flat(host);
    assert.ok(all.some((e) => e.textContent === 'winner'));
    assert.ok(all.some((e) => e.className === 'rt-verdict' && e.textContent.startsWith('→ t via 10.0.0.0/16')));
    w.destroy();
  } finally { globalThis.document = prev; }
});

import { clampStep, layoutSteps, validate as validateTimeline, mount as mountTimeline } from '../public/widgets/timeline.js';

const TL = {
  lanes: ['client', 'server'],
  scenarios: [
    { name: 'Open', steps: [{ from: 0, to: 1, label: 'SYN' }, { from: 1, to: 0, label: 'SYN/ACK' }, { from: 0, to: 1, label: 'ACK', note: 'connected' }] },
    { name: 'Drop', steps: [{ from: 0, to: 1, label: 'SYN', drop: true, at: '0 s', note: 'lost' }] },
  ],
};

test('timeline: clampStep', () => {
  assert.equal(clampStep(-1, 3), 0);
  assert.equal(clampStep(0, 3), 0);
  assert.equal(clampStep(2, 3), 2);
  assert.equal(clampStep(9, 3), 2);
  assert.equal(clampStep(5, 0), 0);
});

test('timeline: layoutSteps puts drop end between lanes, y increases', () => {
  const L = layoutSteps([{ from: 0, to: 1 }, { from: 1, to: 0, drop: true }, { from: 0, to: 1, drop: true }], 480);
  assert.equal(L.length, 3);
  assert.equal(L[0].dropX, undefined);
  assert.ok(L[0].x1 < L[0].x2);
  const lo = Math.min(L[2].x1, L[2].x2), hi = Math.max(L[2].x1, L[2].x2);
  assert.ok(L[2].dropX > lo && L[2].dropX < hi);
  assert.ok(L[1].dropX > lo && L[1].dropX < hi);
  assert.ok(L[0].y < L[1].y && L[1].y < L[2].y);
});

test('timeline: validate', () => {
  assert.deepEqual(validateTimeline(TL), []);
  assert.ok(validateTimeline({ ...TL, lanes: ['a'] }).length);
  assert.ok(validateTimeline({ ...TL, scenarios: [] }).length);
  assert.ok(validateTimeline({ ...TL, scenarios: [{ name: 'x', steps: [{ from: 0, to: 5, label: 'l' }] }] }).length);
  assert.ok(validateTimeline({ ...TL, scenarios: [{ name: 'x', steps: [{ from: 0, to: 0, label: 'l' }] }] }).length);
  assert.ok(validateTimeline({ ...TL, scenarios: [{ name: 'x', steps: [{ from: 0, to: 1 }] }] }).length);
});

test('timeline: mount in fake DOM, Next updates counter + note, remount after destroy', () => {
  const mk = (tag) => ({ tag, children: [], attrs: {}, listeners: {}, textContent: '', className: '',
    classList: { toggle() {} },
    append(...k) { this.children.push(...k); },
    replaceChildren(...k) { this.children = k; },
    setAttribute(k, v) { this.attrs[k] = v; },
    addEventListener(t, f) { this.listeners[t] = f; },
    remove() {} });
  const prev = globalThis.document;
  globalThis.document = { createElement: mk, createElementNS: (_ns, t) => mk(t) };
  const flat = (e) => [e, ...e.children.flatMap(flat)];
  try {
    for (let round = 0; round < 2; round++) {
      const host = mk('div');
      const w = mountTimeline(host, TL);
      const q = (cls) => flat(host).find((e) => e.className === cls);
      assert.equal(q('tl-count').textContent, '1 / 3');
      q('tl-next').listeners.click();
      assert.equal(q('tl-count').textContent, '2 / 3');
      q('tl-next').listeners.click();
      assert.equal(q('tl-count').textContent, '3 / 3');
      assert.equal(q('tl-note').textContent, 'connected');
      q('tl-next').listeners.click(); // clamped
      assert.equal(q('tl-count').textContent, '3 / 3');
      flat(host).filter((e) => e.className === 'tl-scn')[1].listeners.click();
      assert.equal(q('tl-count').textContent, '1 / 1');
      assert.equal(q('tl-note').textContent, 'lost');
      assert.ok(flat(host).some((e) => e.textContent === 'dropped'));
      w.destroy();
    }
  } finally { globalThis.document = prev; }
});

test('timeline: viewBox width follows host width (1 unit = 1 px) and long labels wrap', () => {
  const mk = (tag) => ({ tag, children: [], attrs: {}, listeners: {}, textContent: '', className: '',
    classList: { toggle() {} },
    append(...k) { this.children.push(...k); },
    replaceChildren(...k) { this.children = k; },
    setAttribute(k, v) { this.attrs[k] = v; },
    addEventListener(t, f) { this.listeners[t] = f; },
    remove() {} });
  const prev = globalThis.document;
  globalThis.document = { createElement: mk, createElementNS: (_ns, t) => mk(t) };
  const flat = (e) => [e, ...e.children.flatMap(flat)];
  try {
    const host = mk('div'); host.clientWidth = 326;
    const long = { ...TL, scenarios: [{ name: 'L', steps: [{ from: 1, to: 0, label: 'SYN/ACK seq=300 ack=101 extra words' }] }] };
    const w = mountTimeline(host, long);
    const svg = flat(host).find((e) => e.tag === 'svg');
    assert.equal(svg.attrs.viewBox.split(' ')[2], '326');
    const texts = flat(host).filter((e) => e.attrs.class === 'tl-label');
    assert.equal(texts.length, 2);
    w.destroy();
  } finally { globalThis.document = prev; }
});

import { mtuOutcome, validate as validateMtu, mount as mountMtu } from '../public/widgets/mtu.js';

const HOPS = [{ name: 'pod', mtu: 1500 }, { name: 'VXLAN tunnel', mtu: 1450 }, { name: 'server', mtu: 1500 }];

test('mtu: delivered when size fits everywhere; pathMtu is the min', () => {
  assert.deepEqual(mtuOutcome(HOPS, 1450, true, false), { kind: 'delivered', pathMtu: 1450 });
  assert.equal(mtuOutcome(HOPS, 576, false, false).kind, 'delivered');
});

test('mtu: fragment counts use IPv4 rules', () => {
  const a = mtuOutcome(HOPS, 1500, false, false);
  assert.equal(a.kind, 'fragmented'); assert.equal(a.hop, 'VXLAN tunnel'); assert.equal(a.fragments, 2); assert.equal(a.pathMtu, 1450);
  const b = mtuOutcome([{ name: 'a', mtu: 9000 }, { name: 'b', mtu: 1500 }], 9000, false, false);
  assert.equal(b.fragments, 7);
});

test('mtu: DF on gives frag-needed or black-hole', () => {
  const a = mtuOutcome(HOPS, 1500, true, false);
  assert.equal(a.kind, 'frag-needed'); assert.equal(a.hop, 'VXLAN tunnel'); assert.equal(a.pathMtu, 1450);
  const b = mtuOutcome(HOPS, 1500, true, true);
  assert.equal(b.kind, 'black-hole'); assert.equal(b.hop, 'VXLAN tunnel');
});

test('mtu: validate', () => {
  const ok = { hops: HOPS, size: 1500, minSize: 576, maxSize: 9000, df: true, icmpBlocked: false };
  assert.deepEqual(validateMtu(ok), []);
  assert.ok(validateMtu({ ...ok, hops: [HOPS[0]] }).length);
  assert.ok(validateMtu({ ...ok, hops: [{ name: 'x', mtu: 10 }, HOPS[1]] }).length);
  assert.ok(validateMtu({ ...ok, hops: [{ mtu: 1500 }, HOPS[1]] }).length);
  assert.ok(validateMtu({ ...ok, size: 100 }).length);
  assert.ok(validateMtu({ ...ok, minSize: 9000, maxSize: 576 }).length);
});

test('mtu: mount in fake DOM, slider and checkboxes change outcome, remount after destroy', () => {
  const mk = (tag) => ({ tag, children: [], attrs: {}, listeners: {}, textContent: '', className: '',
    append(...k) { this.children.push(...k); },
    replaceChildren(...k) { this.children = k; },
    setAttribute(k, v) { this.attrs[k] = v; },
    addEventListener(t, f) { this.listeners[t] = f; },
    remove() {} });
  const prev = globalThis.document;
  globalThis.document = { createElement: mk };
  const flat = (e) => [e, ...e.children.flatMap(flat)];
  try {
    for (let round = 0; round < 2; round++) {
      const host = mk('div');
      const w = mountMtu(host, { hops: HOPS, size: 1400, minSize: 576, maxSize: 9000, df: true, icmpBlocked: false });
      const q = (cls) => flat(host).find((e) => e.className === cls);
      assert.equal(q('mt-outcome').textContent, 'delivered');
      const slider = q('mt-size');
      slider.value = '1500'; slider.listeners.input();
      assert.match(q('mt-outcome').textContent, /^dropped at VXLAN tunnel; ICMP frag-needed \(type 3 code 4, next-hop MTU 1450\) sent back/);
      assert.equal(q('mt-sizeval').textContent, '1500');
      const icmp = q('mt-icmp'); icmp.checked = true; icmp.listeners.change();
      assert.match(q('mt-outcome').textContent, /silently.*black hole/);
      const df = q('mt-df'); df.checked = false; df.listeners.change();
      assert.equal(q('mt-outcome').textContent, 'fragmented into 2 at VXLAN tunnel');
      w.destroy();
    }
  } finally { globalThis.document = prev; }
});

test('mtu: frag-needed reports the first dropping hop MTU, not the path minimum', () => {
  const hops = [{ name: 'a', mtu: 1500 }, { name: 'b', mtu: 1400 }, { name: 'c', mtu: 1300 }];
  const o = mtuOutcome(hops, 1500, true, false);
  assert.equal(o.hopMtu, 1400); assert.equal(o.pathMtu, 1300); assert.equal(o.hopIndex, 1);
  assert.equal(mtuOutcome(hops, 1500, true, true).hopMtu, 1400);
});
