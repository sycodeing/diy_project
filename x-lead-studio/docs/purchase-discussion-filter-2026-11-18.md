# 购买讨论筛选验证 — 2026-11-18

## 目标和证据口径

筛选当前正在求推荐、比较、选购或询价的宠物照片定制实物、家饰及送给宠物爱好者的礼物需求。普通晒宠、生日、新领养，以及系统查询标签本身，不构成购买需求。

本轮仅实现与测试筛选：不发送回复、私信或关注，不更改发送队列，不以测试通过代替获客或付款结果。

两种资格分开：

- **商业需求待审线索**：保留作者自己的当前请求、商品或收礼对象证据、原帖及父帖来源。无照片或地区未核实不能被算成严格合格候选。
- **专属预览候选**：继续要求地区、账号、本人宠物照片及图像质量等原有验证。两类都不等于人工批准联系。

## 历史基线

数据来自本机已经保存的 TwitterAPI.io 响应，不是本轮实时搜索。扫描 `.data/twitterapi/runs/` 中具有 `queries` 的 53 个档案，共 1,668 条唯一搜索原帖；独立的原始父帖响应不计为搜索档案。

使用 Git 基线 `58f876c` 中 `pet-demand-v7` 分类器回放，得到 1 条文本命中。人工检查发现其内容是卖家发布的个性化礼物指南：以 “New pet, full camera roll already?” 开头，并引导读者查看 “Our guide”。这条不是买家求购。另以商品／礼物词加询问／购买表达抽出 35 条长度不超过 1,500 字符的帖子作定性复核，主要为广告、普通分享、已发生购买及不匹配商品，没有发现明确匹配的当前买家请求。该抽样不是完整人工标注数据集，不能据此计算准确率或召回率。

基线明细保存于本地忽略目录 `.data/purchase-discussion-evaluation/baseline-v7.json`，不提交用户原始账户数据。

## 验证层次

1. 针对性单元测试和独立对抗样本：验证规则能区分需求、卖家设问、跨句交期／已购／数字交付，以及父帖上下文。
2. 采集和 worker 模拟集成：验证真实调用路径保留无图待审线索，时间与账号去重生效，严格候选门槛不被旁路。
3. 历史档案回放：观察新规则在已有原帖上的结果，按档案采集时间判断当时是否过期。历史未过期不等于今天可联系。
4. 实时需求供给、地区／图像最终验证、真实进站与付款分别记录；前三项通过不能证明第四项。

## 执行结果

- GPT-6 Sol high 实施，GPT-6 Astra high 独立复核；已关闭本轮发现的代码阻塞。
- 完整 Python 测试：`193 passed`；20 条独立对抗样本全部符合预期。针对性测试还覆盖本地侧车、无照片／地区待核实的隔离、父帖解析和真实 API 时间格式。
- Astra 另以模拟 HTTP 运行 collector／worker：确认无照片留存、同作者只查一次照片、视觉失败时保留线索而不提交候选、地区不足不查图、过期／无效时间排除，以及后续非美国证据不会被侧车重新恢复成待审。
- 同一批 53 个历史档案的 1,668 条唯一原帖全部被正确解析并处于各自档案查询时间窗内。新版文本通过 **0**，文本拒绝 **1,668**；旧版唯一卖家误报已被排除。没有位置或图片验证通过的新增候选，也没有人工批准的触达对象。
- 回放前后检查 54 个原始 JSON 文件及正式 `watermarks.json` 的 SHA-256，55 个文件全部未变。原始档案没有被回放覆盖。

### 实时 API 小测

数据源为 TwitterAPI.io `/twitter/tweet/advanced_search`，不是 X 官方 API。显式选择新表达式 `v11-shopping-custom`，`Latest`、最近 3 天、最多一页、`resultLimit=20`。不进行账号补充、图片验证、云端入池或触达。

档案 ID：`purchase-intent-demand_custom-20261118T072031Z-ce0db7a5`。

```text
("pet photo" OR "dog photo" OR "cat photo" OR "custom dog" OR "custom cat")
("where can I" OR recommend OR "who makes" OR "looking for")
-filter:replies -filter:retweets lang:en
```

| 指标 | 结果 |
| --- | ---: |
| 查询 / 响应页 | 1 / 1 |
| 原始帖子 / 唯一帖子 / 作者 | 0 / 0 / 0 |
| 文本需求 / 严格候选 | 0 / 0 |
| 账号补充 / 父帖查询 / 图片验证 | 0 / 0 / 0 |
| 云端候选导入 / 公开回复 / 私信 | 0 / 0 / 0 |

`source_exhausted=true` 只表示这条表达式、这个时间窗的返回结束，不能代表整个 X 没有买家。探测前后 bonus credits 都为 31,840，结算仍待确认；余额暂未变化不能解释为免费。

本轮停止继续付费探测。零结果发生在原始召回阶段，不能归因于美国、照片或产品适配的后续门槛。实现验收通过，真实需求供给与成交效果没有通过验证。

## 使用与状态

分类器版本：`pet-demand-v8-shopping`；发现 worker 版本：`1.13.0`。

- Collector 将文本通过记录保存在原始档案的 `review_leads` 中，保留最终拒绝状态。
- 完整 worker 将未提交严格候选的文本记录导出至 `.data/twitterapi/runs/review_leads/<archive-id>.json`，每账号一条；这是本地审阅文件，不是后台 `x_leads` 新状态。
- `location_pending`、`same_account_photo_missing`、`vision_unavailable` 分别表示尚缺相应证据；开放礼物或其他相邻实物进入 `product_fit_review`，不为其自动查照片或算作枕套合格候选。
- 原有美国、本人宠物、图片质量、历史去重和人工审核要求继续适用。没有原图不妨碍记录需求，也不赋予使用对方图片或联系对方的资格。
- 三个新查询 `v11-shopping-custom`、`v11-shopping-gift`、`v11-shopping-reply` 都需要显式选择，未加入默认查询组合。此次在线测试只执行 custom，gift/reply 的新表达式没有实时验证。

在 `D:\Coding\DiyProject\x-lead-studio` 中可离线回放指定档案：

```powershell
.\.venv\Scripts\python.exe audit_purchase_intent.py <archive.json>
```

以下是本轮已经执行过的一页付费探测命令，记录用于复现，不应因零结果自动反复运行：

```powershell
.\.venv\Scripts\python.exe probe_purchase_intent.py --segment demand_custom --revision v11-shopping-custom --lookback-days 3 --result-limit 20 --execute-paid
```

本地验证明细：`.data/purchase-discussion-evaluation/replay-v8.json`、`independent-results.json`、`source-integrity-after.json`。这些文件及原始账户数据保持在 Git 忽略目录。
