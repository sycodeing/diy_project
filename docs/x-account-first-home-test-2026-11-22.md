# Account-first 家居讨论小批复核（2026-11-22）

本次只读采集沿用当天两页已归档的 `advanced_search` 结果，选择两条本人家居布置原帖作为来源。来源作者按自己的原帖评估；另一条来源的一页 V2 回复仅用于发现参与者。没有重新搜索、请求原帖详情、翻回复页、发 X 消息或写入严格候选池。

| 阶段 | 实际结果 |
| --- | ---: |
| 重用的搜索原始页 | 1 页，20 条返回；本轮新增搜索请求 0 |
| 新请求 | V2 回复 1 页、近期账号内容 3 页；4 次均 HTTP 200，无重试 |
| 回复页 | 2 条返回，含来源原帖；外部直接回复作者 1 位 |
| 账号评估 | 2 位来源作者 + 1 位回复作者；第 4 个 timeline 名额未使用 |
| timeline 返回 | 60 条：41 条非引用原创、4 条引用、15 条转发；不能称为 60 条本人原创 |
| `account-first-v1` 原判断 | 3 位均为 `insufficient` |
| 同档 `account-first-v1.1` 回放 | 2 位 `watch/ready`，1 位 `insufficient/no_entry`；三位商品适配与购物意向均为 `unknown` |
| 严格候选、原始帖、发送任务 | 本次未增加，最终分别为 841、400、163 |

两位来源作者的原帖提供本人居家布置证据。一人的 timeline 只增强普通个人账号背景，没有新增独立家居用途；另一人的准备与清理帖补强同一次节日布置，不能计作多次独立消费。外部回复是一般家居建议；账号简介与连续指导内容显示内容品牌迹象，独立 AI 复核倾向将其排除个人顾客目标，但运行时只记录 `suspected_publisher`，因无本人项目证据保持 `insufficient`，并未断定其直接售卖。图片均仅有媒体元数据，没有视觉或归属核验。以上均不是买家、商品匹配或联系许可证明。

实际采集档案为本地忽略文件 `x-lead-studio/.data/twitterapi/runs/home-account-linked-20261122T022518Z-6ceffb1c.json`；原版与新版判断分别保留在该档及 `x-lead-studio/.data/purchase-discussion-evaluation/home-account-linked-v1.1-replay.json`。独立 AI 文字审阅另存同目录 `home-account-astra-review.json`，标明 `reviewed_by_human=false`；不会写成人工批准或覆盖运行时证据。本次修正后没有另一批独立样本，不能据同档回放宣称获客效果已提升。

账号待审已通过现有校验与 RPC 入库，独立记录 `4cefd524-961a-409a-822b-069b287e9cb6` 明示 `execution_kind=linked_archive_replay`、`hosted_worker_executed=false`，不是正常 hosted worker 采集完成的伪装。3 条均为 `unreviewed`；此前 3 条历史账号仍保留。可在[本批账号待审](https://www.thebestdiyshop.com/admin/x-leads?mode=account_review&job=4cefd524-961a-409a-822b-069b287e9cb6)查看全部三条，或[只看两条 watch](https://www.thebestdiyshop.com/admin/x-leads?mode=account_review&job=4cefd524-961a-409a-822b-069b287e9cb6&account=watch)。后台需要管理员登录。

采集前余额 22,180 credits；新请求静态预留 1,245，之后一次只读复核余额 21,250，观察差值 930 credits。此前成功搜索页的费用已在这次采集前余额中反映；此数是余额观察值，不能按来源或账号精确分摊。最终数据库回读：账号总数 6、本批 3 条待审、旧批 3 条保留、运行中发现任务 0；严格候选 841、原始帖 400、发送任务 163 均与入库前相同。

代码修正为本人家居布置与个人图像展示增加保守 `watch` 证据路径，保持商品适配及购物意向未知；个人来源作者可用自己的原帖和有限近期内容进入同一四账号预算，来源主帖绝不成为回复作者的本人证据。新任务需 1.19.2 发现执行器，旧版本不领取；账号模式仍由管理员手动启动，不启用定时付费采集。
