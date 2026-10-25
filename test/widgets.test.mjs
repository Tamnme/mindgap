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
