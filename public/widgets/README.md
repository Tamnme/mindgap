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
