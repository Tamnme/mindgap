import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSwitch, SCENARIOS, BROADCAST, describeHop } from '../public/sim/switch-sim.js';

const load = (name) => createSwitch(SCENARIOS[name].topology);
const delivered = (hops) => hops.filter((h) => h.delivered).map((h) => h.to);
const nonLearned = (hops) => hops.filter((h) => h.reason !== 'learned');

test('import is DOM-free and scenario keys are exact', () => {
  assert.equal(globalThis.document, undefined);
  assert.deepEqual(Object.keys(SCENARIOS).sort(), ['switch-flood', 'switch-learning', 'vlan-broadcast', 'vlan-trunk']);
});

test('learning: the first frame teaches the switch where the source lives', () => {
  const sw = load('switch-learning');
  assert.deepEqual(sw.table(), []);
  const hops = sw.send('A', 'cc:03');
  assert.equal(hops[0].reason, 'learned');
  assert.equal(hops[0].port, 1);
  assert.deepEqual(sw.table(), [{ switch: 'S1', vlan: 1, mac: 'aa:01', port: 1 }]);
});

test('unknown unicast floods every other same-VLAN port, never back to the source', () => {
  const sw = load('switch-learning');
  const hops = sw.send('A', 'cc:03');
  const floods = nonLearned(hops);
  assert.deepEqual(floods.map((h) => h.to).sort(), ['B', 'C']);
  assert.ok(floods.every((h) => h.reason === 'flood-unknown' && h.vlan === 1));
  assert.deepEqual(delivered(hops), ['C']);
});

test('known unicast goes to exactly one port', () => {
  const sw = load('switch-flood');
  sw.send('A', 'cc:03');
  const hops = sw.send('C', 'aa:01');
  const rest = nonLearned(hops);
  assert.equal(rest.length, 1);
  assert.equal(rest[0].reason, 'known');
  assert.equal(rest[0].to, 'A');
  assert.deepEqual(delivered(hops), ['A']);
});

test('broadcast floods only its own VLAN', () => {
  const sw = load('vlan-broadcast');
  const hops = sw.send('A', BROADCAST);
  const targets = nonLearned(hops).map((h) => h.to);
  assert.deepEqual(targets, ['B']);
  assert.ok(nonLearned(hops).every((h) => h.reason === 'flood-broadcast' && h.vlan === 10));

  const fromC = sw.send('C', BROADCAST);
  assert.deepEqual(nonLearned(fromC).map((h) => h.to), ['D']);
});

test('cross-VLAN unicast is never delivered', () => {
  const sw = load('vlan-broadcast');
  const hops = sw.send('A', 'cc:03');
  assert.deepEqual(delivered(hops), []);
  assert.ok(!nonLearned(hops).some((h) => h.reason !== 'dropped-vlan' && (h.to === 'C' || h.to === 'D')));
  assert.equal(hops.at(-1).reason, 'dropped-vlan');
  assert.equal(hops.at(-1).to, 'C');
});

test('trunk frames are tagged except on the native VLAN', () => {
  const trunkHop = (hops) => hops.find((h) => h.from === 'S1' && h.to === 'S2');
  const cfg = (native) => ({
    switches: [
      { name: 'S1', ports: { 1: { mode: 'access', vlan: 10 }, 2: { mode: 'access', vlan: 20 }, 3: { mode: 'trunk', vlans: [10, 20], native } } },
      { name: 'S2', ports: { 1: { mode: 'access', vlan: 10 }, 2: { mode: 'access', vlan: 20 }, 3: { mode: 'trunk', vlans: [10, 20], native } } },
    ],
    hosts: [
      { name: 'A', mac: 'aa:01', switch: 'S1', port: 1 }, { name: 'C', mac: 'cc:03', switch: 'S1', port: 2 },
      { name: 'B', mac: 'bb:02', switch: 'S2', port: 1 }, { name: 'D', mac: 'dd:04', switch: 'S2', port: 2 },
    ],
    links: [{ a: { switch: 'S1', port: 3 }, b: { switch: 'S2', port: 3 } }],
  });
  const nativeSw = createSwitch(cfg(10));
  assert.equal(trunkHop(nativeSw.send('A', 'bb:02')).tagged, false); // VLAN 10 is native here
  assert.equal(trunkHop(nativeSw.send('C', 'dd:04')).tagged, true); // VLAN 20 is tagged
  const defaultSw = load('vlan-trunk');
  assert.equal(trunkHop(defaultSw.send('A', 'bb:02')).tagged, true); // native defaults to VLAN 1
});

test('trunk: the reply finds the path learned on the far switch', () => {
  const sw = load('vlan-trunk');
  sw.send('A', 'bb:02');
  const hops = sw.send('B', 'aa:01');
  assert.deepEqual(delivered(hops), ['A']);
  assert.ok(nonLearned(hops).every((h) => h.reason === 'known'));
});

test('reset empties the table; describeHop speaks plainly', () => {
  const sw = load('switch-learning');
  const hops = sw.send('A', 'cc:03');
  assert.match(describeHop(hops[0]), /learned aa:01 is on port 1/);
  sw.reset();
  assert.deepEqual(sw.table(), []);
});
