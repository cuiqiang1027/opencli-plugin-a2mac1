# A2MAC1 适配器完善建议 / Roadmap

> 基于 2026-10-20 对仓库源码（9 个命令、1442 行）的完整通读、`opencli a2mac1 me` 实际探测到的
> `/settings` 平台配置，以及 A2MAC1 官方公布的 12 个对标产品清单整理。
> 结论先行：**瓶颈不在"再加几个命令"，而在骨架重复 + 数据域只覆盖了 2/12**。

---

## 实施进展（v0.3.0，2026-10-20 下午）

Step 4 的 `bom` 与"剩余数据域"两项已完成。关键转折是**换了 recon 方法**：不再依赖
`opencli browser network` 抓包（扩展捕获在这台机器上拿不到请求），改成**爬 SPA 的 ES-module
分块**。

### recon 方法（可复用）

前端是 Angular 的 ESM 构建，`main-*.js` 只是个 re-export 桩，真正的代码在 `chunk-*.js` 里，
彼此用 `import` 互相引用。做法：

1. `curl https://ibp.a2mac1.com/` 拿到入口 HTML，取出 `main-*.js` / `scripts-*.js` / `polyfills-*.js`
2. 从这几个种子开始 BFS，跟着 `"./chunk-*.js"` 形式的 import 递归下载（24 个分块，15 MB）
3. 在全部源码里正则抓 `"api/..."` 字面量 → **453 个端点**，再用业务关键字过滤

比抓包好在：不需要登录、不需要浏览器、结果可版本化、能一次性看到整站 API 面。确认出来的端点
再写一个临时 `zz-recon` 命令（`browser: true` + `readCookie`）用真实 cookie 打一次，看状态码与
响应结构。两轮下来比翻文档快得多。

### 这一轮找到的

| 发现 | 影响 |
|---|---|
| `POST api/filters/hierarchies/get-part-hierarchies?api-version=2.0`（body `[]`）返回账号真实可见的全部数据域 | **权威 ID 来源**，取代了此前靠猜的注册表 |
| `POST api/products/bom/BillOfMaterial_Columns`（body `{productIds, hierarchyId}`） | 部件级 BOM，一次返回整车 2851 行 / 8 MB |
| 同上 + `filters: ["is-compare eq 1"]` | 多车合并返回，两车 5413 行 / 16 MB / 25 秒 |
| `POST api/products/{pid}/hierarchy/{hid}/node/{nid}/bom` | 节点级 BOM（Body 子树 915 行），但值不区分产品，多车场景不用 |
| `POST api/products/compare/bom` | 依赖服务端对比篮状态，故意不用 |
| `GET api/visual/hierarchies` | 对本账号 401，visual/3D 相关接口可能另有权限门槛 |
| `GET api/products/{pid}/available-data`、`api/analyze/*`、`api/costing/*` | 已记录，未接 |

### 数据域：2/12 → 13/13

真实 id 与注册表一比，此前两个"空根节点"的域其实是**id 少写了一个前导 `A`**：

| 域 | 0.2.0 注册的 id | 真实 id |
|---|---|---|
| cell | `0000002R4ZBVEU01` | `A000002R4ZBVEU01` |
| planning | `0000005AE6M1EU01` | `A000005AE6M1EU01` |

所以 0.2.0 里"cell / planning 根节点为空、需要 `--parent`"的结论是**错的**，改成正确 id 后根层
正常返回 `Overview / Performance / Half-Cell Performance` 之类节点。同时补齐了 biw、chassis、
ims/ems（共用一个 hierarchy）、hmi，另外发现两个此前完全没列到的域：energy（Energy Management
Strategy）、lighting（Exterior Lighting）。`van` 本账号不可见，如实标 `needs-recon`。

13 个域全部 `tree` 实跑有根节点。`hierarchies --live` 现在会拿平台列表和注册表对账，给出
`unaliased` / `unavailable` 两种不一致状态，避免以后再次静默漂移。

### bom 命令

| 项 | 结果 |
|---|---|
| 单位 | 一次请求取整车，不做按节点 fan-out（2851 行 / 8 MB） |
| 层级还原 | 行内 `hierarchynode` 已是完整路径 `Body > Closures > Driver Door > Door Panel`，无需走树 |
| 列 | 总重 / 零件数 / 紧固件重 / 明细重 / 单件重 / 材料类型 / 材料牌号 / 供应商 / 尺寸 |
| 过滤 | `--filter` 命中路径+材料+供应商；`--node --depth` 客户端裁剪子树 |
| 跳过 | 无任何测量的结构占位行（如 `Schedule`）不输出 |
| 实测 | 单车 `--filter door` 455 行 / 20 s；双车 Body 两层 95 行 / 31 s |

**新坑**：BOM 端点偶发直接 401（同一会话 `me` 仍 200，隔几秒重试即恢复），推测是重查询触发网关
限流而非真的掉登录。目前靠手动重试，未在代码里做 401 重试——自动重试会把真正过期的会话也盖掉。

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
| Step 5 | BIW / Chassis / Master Sections（需 recon）、README 补全、fixture + CI | 发布 v0.3.0 |

> 0.3.0 实际执行结果：Step 1～4 已全部完成（`files` 除外，因 `api/visual/*` 权限待确认），
> Step 5 的数据域部分也一并做掉了；只剩 fixture + CI。

> 顺带：README 现在完全没写 `weight*` 三个命令、`vop-list` 也没进去；`opencli-plugin.json`
> 的 description 还是 v0.1.0 时的"search, VOP measurements, multi-vehicle compare"。Step 5 一起补。

---

## 七、下一步（0.3.0 之后）

0.3.0 已经消化了原来 1～4 项，剩下的是：

1. **`files` 只列不下** —— settings 里的 `api.files-url` / `visual.max-downloads=250` /
   `credits.download` 说明下载会扣额度。端点已知：`api/visual/files/get-files?api-version=2.0`
   （body `{productIds, hierarchyId, isBookmark}`）、`api/visual/files/hierarchy-node/…`。注意
   `api/visual/*` 对本账号目前返回 401，接入前要先确认权限。
2. **`planning` 排期** —— id 已修正（`A000005AE6M1EU01`），根层能返回节点；下一步是把
   "这车什么时候拆 / 拆到哪一步"做成一行摘要，而不是让用户自己翻树。
3. **`bom` 的增量能力** —— 现在一次拉整车。可考虑：`--group-by material`（材料占比汇总）、
   `--suppliers`（供应商份额）、与 `weight-compare` 的节点汇总对账（两者差额 = 未拆解部分）。
4. **`--live` 的自动校验** —— `hierarchies --live` 已经能对账，下一步可以把它做成 `bom`/`tree`
   启动时的软校验（发现 id 漂移就警告，不阻断）。
5. **fixture + CI** —— 给 6 个主力命令各固化一份真实响应（BOM 建议只留 Body 子树，否则单文件
   8 MB），接口变了能立刻发现。
6. **BOM 401 重试策略** —— 目前偶发 401 靠手动重试；如果要自动化，需要区分"网关限流型 401"
   与"会话过期型 401"（可对比 `/settings` 同时刻的状态）。

