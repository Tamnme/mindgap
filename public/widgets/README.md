# Widget kinds

A chapter widget block is `{ id, kind, title, hint, takeaway, ...config }`. `kind` defaults to `"sim"`.
`chapter.js` loads `/widgets/<kind>.js` and calls `mount(host, block)`.

Each module exports `mount(host, config) -> { destroy() }` and `validate(config) -> string[]` (empty = valid),
plus the pure functions its tests use. No DOM access at module top level (tests import it in Node).
`mount` must work again after `destroy` (Reset).

## sim

The switch simulator. `sim` is a key of `SCENARIOS` in `public/sim/switch-sim.js`.

```json
{ "id": "mac-table", "kind": "sim", "title": "Watch the MAC table", "sim": "switch-learning" }
```

## subnet

Subnet calculator: IP text input, prefix slider, mask/network/broadcast/usable readout, 32-bit binary view.
`aws: true` applies AWS rules (5 reserved, only /16-/28 valid).

```json
{ "id": "subnet-calc", "kind": "subnet", "title": "Carve a subnet", "ip": "10.0.1.77", "prefix": 26, "minPrefix": 8, "maxPrefix": 32, "aws": false }
```

## routes

Route-table decision (longest-prefix match). Destination input plus preset buttons; each row shows
"matches /N", "no match" or "winner", and a verdict line names the target. `validate` rejects bad prefixes,
bad addresses, and two routes with the same network and length (ambiguous tie). `caption` and `presets` are optional.

```json
{ "id": "route-lpm", "kind": "routes", "title": "Which route wins?", "routes": [{ "prefix": "10.0.0.0/16", "target": "local" }, { "prefix": "0.0.0.0/0", "target": "igw-1" }], "dest": "10.0.3.4", "presets": ["10.0.3.4", "8.8.8.8"], "caption": "Subnet route table" }
```

## timeline

Sequence-diagram stepper. `lanes` are vertical lifelines (name's first word is line 1, the rest wraps to line 2);
each scenario is a list of steps (`from`/`to` are lane indexes, `label` required, `at` time and `note` optional).
Prev/Next reveal arrows up to the current step and show its `note`. `drop: true` stops the arrow halfway with an ✕ and "dropped".
`validate` rejects fewer than 2 lanes, bad indexes, same-lane steps and missing labels.

```json
{ "id": "tcp-open", "kind": "timeline", "title": "Handshake outcomes", "lanes": ["client 10.0.0.1:51514", "server 10.0.0.2:80"], "scenarios": [{ "name": "Port open", "steps": [{ "from": 0, "to": 1, "label": "SYN seq=100" }, { "from": 1, "to": 0, "label": "SYN/ACK seq=300 ack=101" }, { "from": 0, "to": 1, "label": "ACK ack=301", "note": "connected after 1 RTT" }] }, { "name": "Firewall drops", "steps": [{ "from": 0, "to": 1, "label": "SYN", "drop": true, "at": "0 s" }, { "from": 0, "to": 1, "label": "SYN (retry)", "drop": true, "at": "+1 s", "note": "…until the timeout" }] }] }
```
