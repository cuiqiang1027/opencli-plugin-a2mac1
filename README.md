# opencli-plugin-a2mac1

[A2MAC1](https://www.a2mac1.com/) IBP (Integrated Benchmarking Platform) adapters for
[opencli](https://github.com/jackwener/opencli). Browse a data domain's hierarchy, pull the
properties of one vehicle at one node, compare many vehicles across nodes, and pull the
part-level bill of materials (mass, material, supplier) — from the terminal, reusing the A2MAC1
session you already have open in Chrome.

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
| `hierarchies` | List the data domains (aliases) you can pass to `--hierarchy`. Static table; `--live` diffs it against the platform. |
| `tree` | Browse any domain's node tree. `--depth` expands children automatically. |
| `props` | Every property of one vehicle at one node, as a long table. |
| `compare` | Many vehicles × (one node, or a subtree via `--parent --depth`), as a long table. |
| `bom` | Part-level bill of materials: one row per teardown part with its mass, part count, material type/code, supplier and dimensions. |
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
opencli a2mac1 hierarchies --all    # include whatever the table knows but you cannot see
opencli a2mac1 hierarchies --live   # ask the platform and diff against the table
```

| Alias | Domain |
|-------|--------|
| `weight` | 3D AutoReverse — teardown mass, part counts, fasteners (the BOM source) |
| `vop` | Vehicle Occupant Packaging — SAE J1100 dimensions |
| `electronics` | Electronics — ECU studies |
| `xev` | xEV Powertrain — pack, e-machine, inverter, thermal |
| `eearch` | Electrical Architecture — harness, distribution |
| `cell` | Cell Analysis — cell teardown and chemistry |
| `planning` | Schedule & Content — teardown pipeline |
| `biw` | Body-in-White |
| `chassis` | Chassis |
| `ims` / `ems` | Interior / Exterior Master Sections (one shared hierarchy) |
| `hmi` | HMI Experience |
| `energy` | Energy Management Strategy |
| `lighting` | Exterior Lighting |

All thirteen resolve to a live hierarchy with root nodes. `van` (Van Insights) is not exposed for
this account and reports `needs-recon`.

`--live` is the authority, not the table: it calls `get-part-hierarchies` — the same endpoint the
IBP filter panel uses — and reports `unaliased` (platform has it, plugin has no short name) or
`unavailable` (plugin knows it, account cannot see it). Run it when ids look stale.

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

## Part-level BOM

`weight-compare` gives system totals; `bom` gives the rows underneath them — the actual parts, each
with its own mass, part count, material and supplier. This is the layer that supports material-mix,
supplier-share and cost analysis.

```bash
# everything in one car, filtered to doors
opencli a2mac1 bom "Xiaomi YU7" --filter door

# two cars side by side, restricted to the Body subtree
opencli a2mac1 bom A0000077HXAOEU01,A000009JDDOREU01 --node 00000004QH72EU01 --depth 2

# material mix for one car, straight into a spreadsheet
opencli a2mac1 bom A0000077HXAOEU01 -f csv > yuy7-bom.csv
```

Columns: `productId, productName, system, node, nodeId, totalWeight_kg, partsCount,
fastenerWeight_kg, detailWeight_kg, partWeight_kg, materialType, materialCode, oemTiers,
dimensions_mm`.

- `system` is the top-level vehicle system, `node` the part name, and the full path
  (`Body > Closures > Driver Door > Door Panel`) is available as `path` in JSON output.
- Parent rows are aggregates of their children (`Driver Door` = 106 parts / 41.3 kg); leaf rows are
  single parts with `partWeight_kg`, `materialType` and `oemTiers` filled in.
- `materialType` is hierarchical (`Metal > Steel`), `materialCode` is the raw grade list
  (`Steel`, `PC;PET`, `PC-EPDM-TD10;EPP`).
- Rows with no measurement at all (structural placeholders such as *Schedule*) are dropped.
- `--filter` matches across node path, material, supplier and node name.

Performance: the platform returns the whole table in **one** response — ~2.8k rows / 8 MB for one
car, ~5.4k rows / 16 MB for two — so expect 15–35 s depending on how many vehicles are in the
request. Pass `--node` to narrow the result client-side, and `--limit` to cap the output.

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
| `OPENCLI_BROWSER_COMMAND_TIMEOUT` | `60` | opencli kills browser-backed commands after this many seconds. Raise it for `--depth 2/3` runs over wide systems and for `bom` with three or more vehicles. |

Hierarchy trees and product display names are cached in `~/.opencli/cache/a2mac1/` for 24h.
Delete that directory (or set `A2MAC1_NO_CACHE=1`) if node structure looks stale.

## How it is built

```
*.js              one file per command; thin wrappers that declare args + columns
lib/http.js       cookie reading, auth headers, fetch with retry/backoff, login-redirect detection
lib/engine.js     hierarchy walk (BFS, concurrent), node data, BOM, domain list, product resolution, request pool
lib/registry.js   domain alias/id table, property-group rules, presets
lib/render.js     property-group flattening, unit splitting, number parsing
lib/cache.js      disk + memory cache for slow-moving metadata
lib/ops.js        the shared tree / props / compare / bom implementations
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
  - `POST /api/filters/hierarchies/get-part-hierarchies?api-version=2.0` — authoritative domain list
  - `POST /api/products/bom/BillOfMaterial_Columns` — part-level BOM (column ids are A2MAC1
    property ids, not the `head` array order)
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

### 0.3.0

- **`bom`** — part-level bill of materials across vehicles (mass, part count, material type/code,
  supplier, dimensions), in a single API call.
- **All thirteen data domains wired up.** The missing ids were recovered from the platform's own
  filter endpoint rather than guessed: `biw`, `chassis`, `ims`/`ems`, `hmi`, `energy`, `lighting`
  are new, and `cell` / `planning` were wrong by a single leading character (`A`) — the
  "empty-root" diagnosis in 0.2.0 was an artefact of those bad ids, both work now.
- **`hierarchies --live`** diffs the alias table against the account's real domain list
  (`unaliased` / `unavailable` statuses).
- **Docs:** the recon method that found the endpoints (crawling the SPA's ES-module chunks) is
  written down in `docs/ROADMAP.md`.

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

See [`docs/ROADMAP.md`](docs/ROADMAP.md) for the audit behind 0.2.0, the endpoint recon behind
0.3.0, and what is next (file/media listing, planning pipeline, fixtures + CI).

## License

Apache-2.0
