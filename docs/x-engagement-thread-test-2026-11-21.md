# X 线程与个人作品召回试验：2026-11-21

本轮只读采集按预注册的三条查询各执行一页。生产代码提交 `6ff98899c8acc1a9818a5f996ac7cb640546b648`，对应 Vercel GitHub 状态为 `success`，发现 worker `1.18.2 online`。任务 `c42f4f48-47f7-425c-b265-c4ef9bba1935` 已完成；[本轮原始归档](../x-lead-studio/.data/twitterapi/runs/engagement-recall-20261121T073614Z-c1b62465.json) 保存在本机忽略目录。

| 组别 | 冻结查询核心 | HTTP / 原始帖 | 种子与回复页 |
| --- | --- | ---: | ---: |
| 晒宠邀请 | `("show me" OR "show us" OR "drop") (pet OR pets OR dog OR dogs OR cat OR cats) min_replies:1` | 200 / 0 | 0 / 0 |
| 宠物图像作品讨论 | `("pet portrait" OR "dog portrait" OR "cat portrait" OR "photo pillow") min_replies:1` | 200 / 0 | 0 / 0 |
| 个人视觉作品 | `("I drew my" OR "I painted my" OR "I made this") (dog OR cat OR pet OR pillow OR portrait)` | 200 / 0 | 不适用 |

三条还都加了 `-filter:replies lang:en`、`Latest`、空游标，以及同一个 2026-11-18 07:36:14 至 11-21 07:36:14 UTC 的时间窗。原始响应均明确有 `tweets: []`、`has_next_page: false`，不是分类器把帖子排空，也不是解析器漏掉 `data.tweets`。旧档案在约一小时前以相同接口、排序、游标和三天窗口取得宠物页 20 帖和较宽作品页 20 帖；旧窄商品种子也曾返回 0。现有只读证据不能区分词组交集、`min_replies` 限制与服务商索引的各自影响。

因此本批 **0 新帖、0 独立作者、0 可选种子、0 实际回复页、0 模型审阅、0 待审候选、0 草稿**。线程参与者路线没有在真实回复上得到验证，不能声称有效或无效。没有换词、翻页、补充查询、父帖/画像 API、发送或生成预览。历史宠物分享批次只作非同期对照，不算本批新数据。

采集前 TwitterAPI.io 余额 24,490 credits；正式三空页结算后为 24,445，即减少 45 credits。预算硬上限 1,800、余额保底 3,000 都未触及。创建任务前后严格 `x_leads` 均 841、`x_reply_jobs` 均 163；原始待筛表均 400，本任务来源行 0，活跃搜索任务 0。默认定时搜索未在本轮启用。

## 独立技术诊断，不计作获客样本

在原任务完成后，经单独授权执行了恰好两个对照搜索页，原样保存于[技术诊断档案](../x-lead-studio/.data/twitterapi/runs/technical-diagnostic-20261121T074000Z-c10be087.json)。这两页不进入待筛表、不选择种子、不取回复，绝不回写原任务：

- D1 只把上轮曾成功返回 20 帖的 `("my dog" OR "my cat") filter:images -filter:replies lang:en` 改为本批相同时间窗，HTTP 200、0 帖。
- D2 只从本批晒宠邀请查询删除 `min_replies:1`，其余字面、`Latest`、空游标与时间窗相同，HTTP 200、20 帖、20 作者，其中 6 帖元数据 `replyCount>0`。带 `min_replies:1` 的原任务 A 页为 HTTP 200、0 帖。

D2 说明无该算子时，上游可返回带回复元数据的帖子；`min_replies:1` 组合或服务商索引行为值得单独调查，但 D1 在本时间窗也由旧 20 变成 0，不能把三组零召回全部归咎该算子。D2 唯一同时符合自动邀晒词形和正回复数的帖子是“用 AI prompt 想象你的猫”挑战，不符合真实本人晒宠种子资格；另有真实邀晒帖却 `replyCount=0`。其余带回复的帖子也不是本轮目标对话。诊断没有提供可用的真实回复者样本。

两页诊断结算为 315 credits；本轮正式采集加诊断总共 360 credits，延迟复核余额为 24,130。余额差额可核算总费用，但不代表获得合格顾客。未再发送任何付费请求。

后台可打开[本任务原始待筛视图](https://www.thebestdiyshop.com/admin/x-leads?mode=raw_review&tier=all&field=archive&query=engagement-recall-20261121T073614Z-c1b62465.json)（正确显示 0 行）、[历史原始帖](https://www.thebestdiyshop.com/admin/x-leads?mode=raw_review&tier=all)及[任务列表](https://www.thebestdiyshop.com/admin/x-lead-search)；需管理员登录。新代码保留两类实际回复页、直接父帖区分和“直接回复邀请且自身带图但归属待核实”的候选路径，模拟测试通过；本次零召回没有触发这些路径。下一次若获授权做诊断，应先以明确预算对照单个查询算子，再决定新的召回表达式，不能把本批零样本用于评价筛选精度。

## 诊断后最小技术修补

经诊断后授权，两个线程种子查询移除远端 `min_replies:1`；本地仍要求原帖 `replyCount>0`、非转发/回复、时间窗内且正文满足种子资格，才会取回复页。A 类“晒自己的宠物”邀请明确排除“想象/AI 生成你的猫狗”挑战；B 类真实个人 AI 宠物图像作品讨论不因提及 AI 而统一排除。这是召回与种子质量的技术修补，不改变本报告中正式任务的 0 条结果，也不导入诊断 20 帖。

修补后的查询标记 `engagement-seed-v2-local-reply-count`，新发现执行器要求 `1.18.3`；旧任务仍保留原查询及指纹。聚焦 Python 测试 17 项通过，目标 ESLint 与 Next 生产构建通过，独立差异审查通过。**修补版尚未执行新的付费搜索或真实回复页，不能据此宣称召回或获客效果改善。**
