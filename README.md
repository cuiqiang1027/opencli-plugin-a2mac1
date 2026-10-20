# opencli-plugin-a2mac1

[A2MAC1](https://www.a2mac1.com/) IBP (Integrated Benchmarking Platform) adapters for
[opencli](https://github.com/jackwener/opencli). Browse a data domain's hierarchy, pull the
properties of one vehicle at one node, and compare many vehicles across nodes — from the
terminal, reusing the A2MAC1 session you already have open in Chrome.

## Requirements

- Node.js ≥ 20
- `@jackwener/opencli` ≥ 1.8.3 globally installed
- The opencli Browser Bridge extension installed in Chrome
- An active A2MAC1 IBP login in that Chrome profile (the plugin reuses your cookies)

## Install

```bash
# From a local checkout
opencli plugin install file:///C/Users/CQ/code/opencli-plugin-a2mac1

# Or straight from GitHub
opencli plugin install github:cuiqiang1027/opencli-plugin-a2mac1

# Confirm
opencli a2mac1 --help
```

Uninstall: `opencli plugin uninstall a2mac1`.

## Commands

| Command | What it does |
|---------|--------------|
| `hierarchies` | List the data domains (aliases) you can pass to `--hierarchy`. No network needed. |
| `tree` | Browse any domain's node tree. `--depth` expands children automatically. |
| `props` | Every property of one vehicle at one node, as a long table. |
| `compare` | Many vehicles × (one node, or a subtree via `--parent --depth`), as a long table. |
| `search` | IBP quick-search across products / parts / hierarchies. |
| `me` | Platform settings for the logged-in account — also a login health check. |
| `vop` | Preset: `props --hierarchy vop` (SAE J1100 measurements). |
| `vop-tree` | Preset: `tree --hierarchy vop`. |
| `vop-compare` | Preset: `compare --hierarchy vop --node …`. |
| `vop-list` | Static VOP nodeId reference table (48 nodes, 30 SAE-bearing leaves). |
| `weight` | Preset: `props --hierarchy weight` (3D AutoReverse teardown mass). |
| `weight-tree` | Preset: `tree --hierarchy weight`. |
| `weight-compare` | Preset: `compare --hierarchy weight`, flattened to numeric weight columns. |

All commands support opencli's standard `-f/--format` (table / plain / json / yaml / md / csv).

## Quick start

Product references accept **either a productId or a car name** — names are resolved through
quick-search, so you no longer have to look ids up by hand:

```bash
# Same command, three ways to address the car
opencli a2mac1 props "Xiaomi YU7"      --node 00000004QH72EU01
opencli a2mac1 props A0000077HXAOEU01  --node 00000004QH72EU01
opencli a2mac1 props "Xiaomi YU7 Super-Range 4X4 Pro 2025" --node 00000004QH72EU01
```

If a name matches several products the command fails with the candidates instead of guessing:

```
"BMW iX3" is ambiguous — 2 products match
Pass the productId explicitly, one of:
  A000009JDDOREU01  BMW iX3 50 xDrive 2026
  000000AROFBSEU02  BMW iX3 RWD Impressive 2021
```

## Data domains

```bash
opencli a2mac1 hierarchies          # ready domains only
opencli a2mac1 hierarchies --all    # include the ones still pending
```

| Alias | Domain | Status |
|-------|--------|--------|
| `weight` | 3D AutoReverse (teardown mass) | ready |
| `vop` | Vehicle Occupant Packaging (SAE J1100) | ready |
| `electronics` | Electronics (ECU studies) | ready |
| `xev` | xEV Powertrain | ready |
| `eearch` | Electrical Architecture | ready |
| `cell` | Cell Analysis | empty-root — drill with `--parent` |
| `planning` | Planning / Schedule Content | empty-root — drill with `--parent` |
| `biw` `chassis` `ims` `ems` `hmi` `van` | Body-in-White, Chassis, Interior/Exterior Master Sections, HMI, Van Insights | needs-recon (hierarchyId not captured yet) |

`ready` = verified end to end against the live platform. `needs-recon` domains are advertised
by A2MAC1 but their hierarchyId has not been captured, so they cannot be addressed by alias yet —
pass a raw id with `--hierarchy <id>` once you have one.

## Comparing vehicles

Single node — one row per (vehicle × property):

```bash
opencli a2mac1 compare "Xiaomi YU7,BMW iX3" --hierarchy vop --node 00000004OU52EU01 -f csv \
  > interior-length.csv
```

Whole systems — one row per (vehicle × system), flattened to numeric weight columns:

```bash
# every root system (Schedule, Body, Interior, Chassis, …)
opencli a2mac1 weight-compare A0000077HXAOEU01,A000009JDDOREU01 -f csv > systems.csv

# drill into Body, two levels deep
opencli a2mac1 compare A0000077HXAOEU01,A000009JDDOREU01 \
  --hierarchy weight --parent 00000004QH72EU01 --depth 2 -f csv > body-detail.csv
```

Every command emits a **long table** because adapter columns are declared statically: pivot in
Excel / pandas to get the wide "one row per car, one column per attribute" view.

## Output contract

- Row per measurement / per (vehicle × system × property); stable column order.
- Numbers are **numbers** (`704.725`, `832`), not formatted strings.
- Missing values are `null`, never `0` or `""` — a node with no teardown data is distinguishable
  from a node whose weight is genuinely zero.
- Units live in their own `unit` column, stripped from the property name
  (`"SAE-L18 - Foot Entrance Clearance – Front [mm]"` → property + `mm`).
- Comparison failures do not silently shrink the result: skipped nodes are reported on stderr,
  and `--strict` turns them into a hard failure.

## Tuning

| Variable | Default | Purpose |
|----------|---------|---------|
| `A2MAC1_CONCURRENCY` | `8` | Parallel node requests. Lower it if A2MAC1 starts returning 429. |
| `A2MAC1_NO_CACHE` | unset | Set to `1` to disable the on-disk metadata cache. |
| `OPENCLI_BROWSER_COMMAND_TIMEOUT` | `60` | opencli kills browser-backed commands after this many seconds. Raise it for `--depth 2/3` runs over wide systems. |

Hierarchy trees and product display names are cached in `~/.opencli/cache/a2mac1/` for 24h.
Delete that directory (or set `A2MAC1_NO_CACHE=1`) if node structure looks stale.

## How it is built

```
*.js              one file per command; thin wrappers that declare args + columns
lib/http.js       cookie reading, auth headers, fetch with retry/backoff, login-redirect detection
lib/engine.js     hierarchy walk (BFS, concurrent), node data, product resolution, request pool
lib/registry.js   domain alias/id table, property-group rules, presets
lib/render.js     property-group flattening, unit splitting, number parsing
lib/cache.js      disk + memory cache for slow-moving metadata
lib/ops.js        the shared tree / props / compare implementations
lib/vop-nodes.js  static VOP nodeId reference data
```

Adding a data domain is a one-line entry in `lib/registry.js` — the commands pick it up through
`--hierarchy`, no new adapter file required.

## Implementation notes

- **Strategy:** `COOKIE` — reads the A2MAC1 session cookies from the bound Chrome profile and
  replays them server-side via Node `fetch`. No tokens are stored on disk by the plugin itself.
- **Endpoints used:**
  - `POST /api/quick-search?api-version=2.0` — search + product name resolution
  - `GET /settings` — login health check, `compare.max-products`, module URLs
  - `POST /api/hierarchies/<hierarchyId>` (optional `{parentNodeId}` body) — node tables
  - `POST /api/products/<pid>/hierarchies/<hid>/nodes/<nid>/data` — properties
  - `GET /api/products/<pid>?productTypeGroupId=…` — display name
- **Stability:** A2MAC1 does not publish these endpoints, so they live in the `internal-unstable`
  tier. If a command starts returning empty rows, run with `--trace on -v` and re-recon with
  `opencli browser <session> network`.
- **Login detection:** only a redirect to `login.a2mac1.com` (or a 401/403) counts as "session
  expired". Other 3xx responses are reported as errors instead of masquerading as auth problems.
- **Network errors** surface the underlying cause (`ENOTFOUND: getaddrinfo …`) plus a hint,
  instead of just `fetch failed`.

## Exit codes (standard opencli sysexits)

- `0` success · `2` argument error · `66` empty result · `75` timeout · `77` auth required · `78` config error

## Changelog

### 0.2.0

- **Generic commands** (`tree` / `props` / `compare`) driven by `--hierarchy`, plus `hierarchies`
  for discovery. The legacy `vop*` / `weight*` names remain as presets with unchanged output.
- **Car names accepted** wherever a productId was required.
- **`--depth` recursion** for comparisons, with a concurrent breadth-first walk.
- **Five data domains** usable instead of two (electronics, xEV, eearch added).
- **Fixes:** `partCode` was always empty in `weight-compare` (property name case mismatch);
  comparisons silently dropped failed nodes; concurrent requests could exceed the stated cap;
  any 3xx was reported as "not logged in"; network failures lost their root cause.
- **Output:** numeric columns are numbers and missing values are `null`.

## Roadmap

See [`docs/ROADMAP.md`](docs/ROADMAP.md) for the audit behind 0.2.0 and what is next
(part-level BOM, file/media listing, planning pipeline, remaining domains).

## License

Apache-2.0
