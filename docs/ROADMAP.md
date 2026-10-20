# A2MAC1 适配器完善建议 / Roadmap

> 基于 2026-10-20 对仓库源码（9 个命令、1442 行）的完整通读、`opencli a2mac1 me` 实际探测到的
> `/settings` 平台配置，以及 A2MAC1 官方公布的 12 个对标产品清单整理。
> 结论先行：**瓶颈不在"再加几个命令"，而在骨架重复 + 数据域只覆盖了 2/12**。

---

## 实施进展（v0.2.0，2026-10-20）

Step 1、Step 2 与 Step 3 的已知 ID 部分已完成并通过实跑验证：

| 项 | 状态 | 说明 |
|----|------|------|
| 抽 `lib/` 引擎 | ✅ | `http / engine / registry / render / cache / ops`，6 个命令文件从 990 行降到 ~280 行，每域新增成本 ≈ 1 行注册表 |
| 通用命令 | ✅ | 新增 `tree` / `props` / `compare` / `hierarchies`，`vop*` `weight*` 退化为 preset |
| 车型名直接查询 | ✅ | `compare "Xiaomi YU7,BMW iX3"`，歧义时列出候选而不是猜 |
| `--depth` 递归 | ✅ | 改成按层并发的 BFS（原 DFS 串行在 Body 两层下跑不完） |
| P1-1 错误根因 | ✅ | fetch 失败现在带 `ENOTFOUND: …` + hint |
| P1-2 3xx 误判 | ✅ | 只有跳 `login.a2mac1.com` 才算未登录 |
| P1-3 并发池 | ✅ | 真正限流，默认 8，可用 `A2MAC1_CONCURRENCY` 调 |
| P1-4 静默吞错 | ✅ | 失败节点计入 stderr 汇总，`--strict` 直接报错 |
| P1-5 退避 | ✅ | 429/5xx 指数退避 + jitter |
| P1-6 缓存 | ✅ | tree + product name 24h 磁盘缓存 |
| P1-7 中文组名硬编码 | ✅ | 中英双语匹配 + `--lang` 透传 `Accept-Language` |
| P1-8 `25` 硬编码 | ✅ | 改为读 `/settings` 的 `compare.max-products` |
| P1-9 目录结构 | ✅ | helpers 移入 `lib/`，根目录只剩命令文件 |
| 输出契约 | ✅ | 数值为 number、缺失为 null |
| **发现的新 bug** | ✅ | `weight-compare` 的 `partCode` 一直为空（`'Part code'` vs `'Part Code'` 大小写不匹配） |
| 数据域扩展 | 🟡 | vop / weight / electronics / xev / eearch 已验证可用；cell、planning 根节点为空（需 `--parent`）；biw/chassis/ims/ems/hmi/van 仍待 recon |
| Step 4 `bom` / `files` | ⬜ | 仍未开始，需要网络 recon |
| Step 5 README / fixture / CI | 🟡 | README 已重写；fixture 与 CI 未做 |

**实跑验证的回归结果**：`vop` / `weight` / `vop-tree` / `weight-tree` / `vop-compare` 五个命令
在重构前后的输出**逐字节一致**（对比基线已删除，如需复现可重跑原命令）；`weight-compare` 行数一致
（48 → 48），仅数值类型按计划从字符串改为 number、`partCode` 由空修复为真实值。

**新发现的坑**：opencli 对 `browser: true` 的命令有 60 秒硬超时（`OPENCLI_BROWSER_COMMAND_TIMEOUT`）。
`compare --depth 2` 在 Body 上约 120 个请求，实测 44～56 秒，已经贴到上限；再深或再多车需要调大该变量。

---

## 一、现状盘点

已注册 9 个命令，实际只打通了 **2 条数据域**、**4 个端点**：

| 数据域 | hierarchyId | 已有命令 | 覆盖度 |
|--------|-------------|----------|--------|
| Vehicle Occupant Packaging (VOP) | `00000005ZT4GEU01` | `vop` / `vop-compare` / `vop-tree` / `vop-list` | ✅ 完整（SAE J1100 30 个叶子） |
| 3D AutoReverse（拆解称重） | `00000003LSK4EU01` | `weight` / `weight-compare` / `weight-tree` | 🟡 只做了节点级重量聚合 |
| Electronics | `00000003O8LHEU01` | — | ❌ ID 已知但无命令 |
| xEV Powertrain | `0000009X67MIEU02` | — | ❌ |
| Electrical Architecture | `00000000HVNTEU01` | — | ❌ |
| Cell Analysis | `0000002R4ZBVEU01` | — | ❌ |
| Planning / Schedule Content | `0000005AE6M1EU01` | — | ❌ |
| BIW / Chassis / Interior & Exterior Master Sections / HMI / Van Insights / AutoVision | 未知 | — | ❌ ID 都没探到 |

`_helpers.js` 里其实已经躺着 7 个 hierarchyId，但只有 2 个被命令用到——**现成的能力被浪费了**。

---

## 二、最关键的问题：同一套骨架写了六遍

`vop*` 和 `weight*` 是同一套逻辑的两份拷贝。真正的差异只有 3 处：

| 差异点 | vop 系 | weight 系 |
|--------|--------|-----------|
| 默认 hierarchyId | `00000005ZT4GEU01` | `00000003LSK4EU01` |
| 保留的 propertyGroup | 排除 `概览/基本信息/文件` | 只要 `Overview` |
| 输出形状 | `group/property/value/unit/propertyId` | 固定列 `totalWeight_kg/partsCount/...` |

其余（readCookie、authHeaders、401/3xx 判定、worker pool ≤5、limit 截断、productName 回填、
顺序保留）全部逐行重复。代价：

- 6 个文件 990 行，去掉重复后 ≈ 250 行引擎 + 2 个 30 行的 preset
- **每接一个新数据域 = 抄 3 个文件**，抄的同时旧 bug 也被复制（见第五节）
- 两套实现的字段口径已经在漂移：`weight` 保留 3 个 group（含 System and Function / Additional Properties），
  `weight-compare` 只保留 Overview——同一份数据，单查和对比出来的字段不一样，下游 pivot 会缺列

**建议目标形态**（先把骨架抽出来，再谈覆盖面）：

```
lib/http.js       readCookie / authHeaders / fetchJson(带 cause、退避、3xx 语义)
lib/engine.js     fetchNodeData(pid, hid, nid) / walkTree(hid, parent, depth) / pool(jobs, n)
lib/registry.js   HIERARCHY 别名表 + 每个域的字段映射(preset)
lib/render.js     长表 / 宽表 / 数值规整
vop.js  weight.js  electronics.js ...   ← 每个域 20~30 行，只写 preset
```

对应命令也应收敛成一套通用动词，域只作为 `--hierarchy` 别名：

```bash
opencli a2mac1 tree    --hierarchy biw
opencli a2mac1 props   <pid> --node <nid> --hierarchy biw
opencli a2mac1 compare <pids> --node <nid> --hierarchy biw --depth 2
```

`vop` / `weight` 继续保留为 preset 别名，不破坏现有用法。

---

## 三、优先级 P0：让"能问的问题"真正能问

### 1. `hierarchies` —— 数据域发现

现在用户必须从文档里抄 hierarchyId。建议：

```bash
opencli a2mac1 hierarchies          # 账户可访问的全部数据域
opencli a2mac1 hierarchies --resolve biw   # 别名 → ID
```

别名表：`weight`(3D AutoReverse) / `vop` / `electronics` / `xev` / `eearch` / `cell` /
`planning` / `biw` / `chassis` / `ims`(Interior Master Sections) / `ems` / `hmi` / `van`。

> 需要 recon：已知 hierarchyId 可直接用；未知的域建议先 `opencli a2mac1 search "<域关键词>" --scope hierarchies`
> 从 quick-search 的 `hierarchies` 结果里捞 ID（`search.js` 已经解析了这个字段，只是没人用它来发现）。

### 2. `products` —— 车型目录

现在做一次三车对比要手工 `search` 三次再复制三个 productId 进去，这是最高的操作成本。
建议：

```bash
opencli a2mac1 products --oem "Xiaomi" --model-year 2025 --market CN --limit 50
# → productId, name, trim, oem, modelYear, market, productType, hasTeardown
```

更进一步：`props` / `compare` 直接接受模糊车型名，内部用 quick-search 解析成 ID：

```bash
opencli a2mac1 compare "YU7,iX3" --node <nid>   # 名称自动解析
```

### 3. `compare --depth` —— 递归下钻与汇总

`weight-compare` 目前只走一层（`--parent` 的直接子节点）。想看 Body 系统的整包重量，
得先 `tree` 拿 22 个系统、再逐个 `--parent` 调，脚本拼。建议加 `--depth N` 递归，
并对非叶子节点输出 `subtreeWeight_kg` 汇总列——这才是"整车重量对比"真正想要的表。

### 4. `bom` —— 部件级 BOM（最有价值的缺口）

A2MAC1 的核心资产是"每车约 1500 个零件，含 mass / 尺寸 / 材料 / 供应商 / 编码 / 紧固件"。
现在只用了节点级聚合值（`Total Weight`、`Number of Parts`），**零件级明细完全没暴露**，
`partCode` 字段甚至已经在 `weight` 的输出列里了，但从来没被单独查询过。

```bash
opencli a2mac1 bom <pid> --system <nodeId> [--depth 3] [--part <partCode>]
# → partCode, partName, qty, weight_kg, dimW/H/D_mm, material, supplier, process, fasteners
```

建议先 recon 一次 `opencli browser network` 抓零件详情请求，再决定是复用 `nodes/<id>/data`
还是切到 subcomponents 接口（`vop-nodes.js` 的注释里提过 `subcomponents`）。

### 5. 输出契约修正

对照 opencli 的 `output-design` 规范，当前输出有几处偏差：

| 现状 | 建议 |
|------|------|
| `totalWeight_kg: "1234.5"`（字符串） | `number`，规整在适配器里做一次 |
| 缺失值填 `''` | 填 `null`（0 和空串有业务含义，别混） |
| `weight-compare` 输出 `totalWeight_kg` 带单位后缀 | 列名不带单位，单位放 `-f` 说明或单独 `unit` 列 |
| `vop-compare` 有 `unit` 列、`weight-compare` 没有 | 统一 |

---

## 四、P1：稳定性与可维护性（都是实测/读码发现的具体问题）

1. **fetch 错误丢失根因（实测）**
   刚才连跑几次 `me` / `search`，网络抖动时全部返回：
   ```json
   {"ok":false,"error":{"code":"COMMAND_EXEC","message":"...request failed: fetch failed"}}
   ```
   没有 errno、没有 host、没有 hint。undici 的实际原因在 `error.cause.code`（`ENOTFOUND` / `ECONNRESET` / `ECONNREFUSED`）。
   建议统一包一层 `fetchJson()`，把 `cause` 透出，并按 code 给 hint（如 `ENOTFOUND → 检查 VPN / Chrome 是否在线`）。

2. **3xx 一律当 AUTH_REQUIRED 会误判**
   6 个文件里都有 `if (status >= 300 && status < 400) throw new AuthRequiredError()`。
   只应把 **302 跳 `login.a2mac1.com`** 判为登录失效，跳 CDN/网关的不该报"未登录"。

3. **worker pool 实际并发会超 5**
   `if (inFlight.size >= 5) await Promise.race(inFlight)` 是在"已经发起下一个请求之后"才检查，
   且 `results.length < limit` 在 while 条件里参与竞争。建议换成标准的 `p-limit` 写法。

4. **错误被静默吞掉**
   `weight-compare` 里 `fetchWeight` 返回 `{error}` 后，worker 只是不 push，用户看到的是"数据少了几行"或
   一个 `EmptyResultError`，无法区分"这个系统没数据"和"这个请求 500 了"。
   建议收集失败项，`--strict` 时直接 fail，否则在 stderr 给出 `N/M 个节点失败`。

5. **没有退避**
   A2MAC1 是商业 SaaS，批量 compare 会打几十个请求。建议对 429 / 5xx 做指数退避 + jitter。

6. **没有缓存**
   hierarchy tree 和 product name 变化极慢，每次 `compare` 都重拉一遍很浪费。
   建议 `.opencli/cache/a2mac1/<hash>.json`，TTL 24h，`--no-cache` 可关。

7. **META_GROUPS 硬编码中文**
   `vop.js` / `vop-compare.js` 里的 `new Set(['概览','基本信息','文件','Media Gallery'])`
   依赖 UI 语言，一旦服务端返回英文 `Overview` 就静默失效。应改为按 `propertyGroupId` 判断，
   或显式传 `Accept-Language`，并加 `--lang` 参数。

8. **`25` 硬编码**
   `vop-compare.js:53` 和 `weight-compare.js:104` 都写死 `> 25`。
   而 `me` 返回的 `compare.max-products = 25` 正是这个值的来源——应该动态读，避免官方调上限后失准。

9. **目录结构**
   `opencli plugin list` 把根目录的 `_helpers.js` / `vop-nodes.js` 也当成命令枚举了进去
   （`commands` 数组里有 `_helpers`、`vop-nodes`），虽然 `--help` 不显示，但会误导。
   把 helpers 移进 `lib/` 子目录即可。

10. **没有回归测试**
    建议给 5 个主力命令各留一个 fixture，用 `opencli adapter test a2mac1/<cmd> --update-fixture`
    固化一次真实响应；`adapter check` 进 CI。接口是 `internal-unstable` 的，没有 fixture 等于没法做 schema 变更检测。

---

## 五、P2：往站点其余模块延伸（需要 recon，按价值排序）

A2MAC1 官方口径是 12 个对标产品 + Cost / Performance / Market Insights。当前适配器只碰了技术数据里的 2 个。

`me` 的输出里已经暴露了不少线索：

| settings key | 值 | 能做什么 |
|--------------|-----|---------|
| `api.files-url` / `media.url` / `visual.max-downloads` | `files` / `media` / `250` | `files` 命令：列出可下载的 3D 模型 / 报告 / 图片 |
| `credits.download.learn-more-url` | 帮助页 | ⚠️ **下载会扣额度**，下载类命令必须 `--dry-run` 默认开 |
| `planning.hierarchy` | `A000005AE6M1EU01` | `planning` 命令：某车"什么时候拆"、"已拆/在拆"排期 |
| `planning.package-property` | `A0000067RCOMEU01` | 配合上一项取 package 字段 |
| `costing.web-component-url` | `csc.a2mac1.com/widget` | Cost Insights 是独立 web component，端点未知，优先级最低 |
| `cmi.web-component-url` | `cmi.a2mac1.com` | CMI 模块，同上 |

优先级建议：

1. **`planning`** —— 用户最常问的"这车拆了没 / 什么时候拆"，实现成本低（复用现有 tree 引擎，只是换 hierarchy）
2. **`files`** —— 只列不下，`--download` 必须二次确认（消耗 credits）
3. **Electronics / xEV Powertrain / Electrical Architecture** —— ID 已知，接进引擎后基本零成本
4. **BIW / Chassis / Master Sections** —— 需先 recon 拿 hierarchyId
5. **costing / cmi** —— 独立站点，成本高，先不做

---

## 六、建议的落地顺序

| 阶段 | 内容 | 产出 |
|------|------|------|
| Step 1 | 抽 `lib/` 引擎 + `hierarchies` 命令，`vop*` / `weight*` 改为 preset（行为完全不变） | 990 行 → ~350 行，后续每域 +30 行 |
| Step 2 | `products` + `compare --depth` + 输出契约修正（number / null） | 手工复制 ID 的操作消失 |
| Step 3 | 接 electronics / xev / eearch / cell / planning 五个已知 ID 的域 | 覆盖 2/12 → 7/12 |
| Step 4 | `bom`（需 recon）、`files`（只列）、稳定性 P1 全套 | 触及 A2MAC1 真正的核心数据 |
| Step 5 | BIW / Chassis / Master Sections（需 recon）、README 补全、fixture + CI | 发布 v0.2.0 |

> 顺带：README 现在完全没写 `weight*` 三个命令、`vop-list` 也没进去；`opencli-plugin.json`
> 的 description 还是 v0.1.0 时的"search, VOP measurements, multi-vehicle compare"。Step 5 一起补。

---

## 七、下一步（0.2.0 之后）

1. **`bom` 零件级明细** —— 价值最高，需要一次 `opencli browser network` 抓零件详情请求，
   确认是复用 `nodes/<id>/data` 还是走 `subcomponents`。
2. **`files` 只列不下** —— settings 里的 `api.files-url` / `media.url` / `credits.download`
   说明下载会扣额度，任何下载动作必须显式二次确认。
3. **`planning` 排期** —— `planning.hierarchy` 根节点为空，需要用 `--parent` 找到一个有效起点，
   才能回答"这车什么时候拆"。
4. **BIW / Chassis / Master Sections 的 hierarchyId recon** —— 拿到 ID 后每域只需在
   `lib/registry.js` 加一行。
5. **fixture + CI** —— 给 5 个主力命令各固化一份真实响应，接口变了能立刻发现。

