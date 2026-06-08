# opencli-plugin-a2mac1

[A2MAC1](https://www.a2mac1.com/) IBP (Integrated Benchmarking Platform) adapters for [opencli](https://github.com/jackwener/opencli).
Search the catalog, browse the Vehicle Occupant Packaging hierarchy, pull SAE J1100 measurements,
and compare them across multiple vehicles — all from your terminal, using your existing logged-in
Chrome session.

## Requirements

- Node.js ≥ 20
- `@jackwener/opencli` ≥ 1.8.3 globally installed
- The opencli Browser Bridge extension installed in Chrome
- An active A2MAC1 IBP login in that Chrome profile (the plugin reuses your cookies)

## Install

```bash
# From this local directory
opencli plugin install file:///C/Users/CQ/code/opencli-plugin-a2mac1

# Or, after pushing to GitHub:
opencli plugin install github:<user>/opencli-plugin-a2mac1

# Confirm installation
opencli plugin list
opencli list | grep a2mac1
```

To uninstall: `opencli plugin uninstall a2mac1`.

## Commands

| Command | Description |
|---------|-------------|
| `opencli a2mac1 me` | Platform settings + key URLs for the logged-in account (also doubles as a login health check). |
| `opencli a2mac1 search <query>` | Quick-search products / parts / hierarchies. |
| `opencli a2mac1 vop-tree` | Browse the Vehicle Occupant Packaging hierarchy node tree. |
| `opencli a2mac1 vop <productId> --node <nodeId>` | All VOP measurements for one product at one node (long table). |
| `opencli a2mac1 vop-compare <pid1,pid2,…> --node <nodeId>` | Multi-vehicle comparison at one node; pivot the long output to get the wide compare view. |

All commands support opencli's standard `-f / --format` (table / plain / json / yaml / md / csv).

### Typical workflow

```bash
# 1. Find the productId for the car you care about
opencli a2mac1 search "Xiaomi YU7" --scope products

# 2. Find the nodeId for the measurement category
opencli a2mac1 vop-tree --parent 000000AFH8LREU02 --depth 2

# 3. Pull data for one car
opencli a2mac1 vop A0000077HXAOEU01 --node 00000004OU52EU01

# 4. Or compare several cars at the same node
opencli a2mac1 vop-compare \
  A0000077HXAOEU01,A000006XCOGGEU01,A000000HSDOGEU02 \
  --node 00000004OU52EU01 \
  -f csv > interior-length.csv
```

`vop-compare` emits a long table (one row per `product × property`) so the output stays consistent
no matter how many cars you pass. Pivot in Excel / pandas to get the "1 row per car, 1 column per
attribute" wide form.

### Common VOP nodeIds

Look these up from the platform with `opencli a2mac1 vop-tree --depth 3` and pin the ones you use most.

| Group | Node | nodeId |
|-------|------|--------|
| Interior Dimensions | Length | `00000004OU52EU01` |
| | Height | `000000028DB4EU01` |
| | Width | `0000000ARUFBEU01` |
| | Angle | `00000009JMFLEU01` |
| | Seats | `000000005L1YEU01` |
| | Trunk Compartment | `00000006XA4TEU01` |
| Exterior Dimensions | Length | `00000008HPU9EU01` |
| | Height | `00000004YO7QEU01` |
| | Width | `00000001VN0NEU01` |

## Implementation notes

- **Strategy:** `COOKIE` — the plugin reads your A2MAC1 session cookies from the bound Chrome
  profile and replays them server-side via Node's `fetch`. No tokens are stored on disk by this
  plugin itself.
- **Endpoints used:**
  - `POST /api/quick-search?api-version=2.0`
  - `GET /settings`
  - `POST /api/hierarchies/<hierarchyId>` (with optional `{parentNodeId}` in body)
  - `POST /api/products/<productId>/hierarchies/<hierarchyId>/nodes/<nodeId>/data`
  - `GET /api/products/<productId>?productTypeGroupId=…` (just for resolving display name)
- **Stability:** A2MAC1 doesn't publish these endpoints, so they live in the
  `internal-unstable` tier — schema changes are possible. If a command starts returning empty rows
  or HTTP errors, run with `--trace on -v` and re-recon with `opencli browser <session> network`.

## Exit codes (standard opencli sysexits)

- `0` success · `2` argument error · `66` empty result · `75` timeout · `77` auth required · `78` config error

## License

Apache-2.0
