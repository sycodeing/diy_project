# X 对话来源三组试验：2026-11-21

本轮是只读的原始待筛试验，不是联系名单。运行的 `consumer-engagement-v1` 先找本人宠物分享、相关线程参与者和个人自用作品，再将账号证据、当前帖子交流切入、具体商品关联及未知项分开。严格 `x_leads` 和发送队列未接收本轮帖子；没有公开回复、私信、预览或发送。图片 URL 只是原帖媒体元数据，未验证拍摄内容、归属或定制可用性。

## 执行与来源

- 原任务 `59adf94f-61db-4a85-b1fd-969fd93ce7ba` 于 2026-11-21 14:37（Asia/Shanghai）开始。`pet_share` 搜索返回 20 帖/20 账号并先归档；`product_thread_seed` 请求收到 HTTP 503，服务商正文表示该请求未收费。任务保持失败状态，原始档案未覆盖：[`engagement-recall-20261121T063722Z-a98ecf18.json`](../x-lead-studio/.data/twitterapi/runs/engagement-recall-20261121T063722Z-a98ecf18.json)，SHA-256 `2713a73bc20bbeb6b2719515e3c5fe6a56b72b14e0df5886d2229c4263d43f687`。
- 唯一受控续跑任务 `bda6d746-c31b-41db-a493-f62e7848cd58` 复用原 20 帖，不重新请求或入库；重试种子搜索返回 HTTP 200 但 0 帖，`personal_make` 搜索返回 20 新帖/20 账号。没有合适种子，因此实际回复页为 0，线程参与者路线尚未在真实回复上验证。续跑完成于 14:48（Asia/Shanghai）：[`engagement-recall-20261121T063722Z-3ca48e47.json`](../x-lead-studio/.data/twitterapi/runs/engagement-recall-20261121T063722Z-3ca48e47.json)，SHA-256 `752e79ca32c2d1d306f4e6e2abc75a0ff49462b475fa6f1b5e61503e6eda9ade`。
- 两份成功页共 40 条新原始帖、40 个独立账号；按来源分别入独立原始待筛表，各 20 行。宠物页 20/20 有 photo 元数据、共 27 个图片 URL；作品页 8/20 有 photo 元数据、共 14 个图片 URL。两组图片都未做外部视觉或归属认证。
- 本轮共 4 次 provider 请求尝试：宠物搜索成功、种子搜索 503、种子受控重试成功但空、作品搜索成功。独立联系人快照读取成功；当时已知 post ID 297、handle 295、author ID 0，历史记录缺 author ID 时按 handle 兜底。未增购父帖/profile/timeline；未重试空查询或另增搜索页。

## 效果与证据级别

| 层次 | 宠物分享 | 个人作品 | 合计 |
| --- | ---: | ---: | ---: |
| 原始帖 / 独立账号 | 20 / 20 | 20 / 20 | 40 / 40 |
| 运行时文本初筛 `exploratory` | 12 | 19 | 31 |
| 运行时文本模型 `reviewed` / 证据摘录无效 / 未审 | 2 / 1 / 17 | 3 / 0 / 17 | 5 / 1 / 34 |
| 本地图片模型做过内容类别审阅 | 3 | 2 | 5 |
| 运行时具体商品关联通过 / 待人工审草稿 | 0 / 0 | 0 / 0 | 0 / 0 |

模型额度固定每组最多审 3 帖，线程组无帖；其余 `pending` 不代表模型否定。1 条 `invalid_evidence` 是模型引用摘录不与原文逐字一致，系统保留待核实。已有 5 条图片内容分类都不验证图片属于发帖人，也不产生可用预览。`draft_ready=0` 不等于 40 条均与消费无关，只表示本次未取得可解释的具体商品关联与交流入口组合。

独立 Astra 对两页全部 40 条做了**AI 文字复核**，不是人工审核、生产模型输出或身份认证；逐帖最短依据仅在本机忽略目录 [`x-engagement-ai-audit-2026-11-21.tsv`](../x-lead-studio/.data/purchase-discussion-evaluation/x-engagement-ai-audit-2026-11-21.tsv)，不会随报告部署。文字推断为 personal 28、seller 4、unknown 8。只有 18 条具有相应来源组的个人场景文字证据（宠物 14、个人创作 4）；其中 3 条涉及明确当下哀伤/痛苦，不宜促销，1 条自用 DIY 枕物已做完。剩下 **14 条仅值得补查商品关联**，全部具体本站商品适配仍 unknown，购物意向与图片归属亦未知；不是可联系、已合格买家或可直接用的草稿。作品页固定先审样本里，付费委托设计和“术后回家”被初筛误纳；宠物页的出版社书名也曾误纳。另一部分真实个人宠物短句被初筛排除。没有根据本批结果改动冻结规则或再次付费凑量。

## 费用、入库与发布

- TwitterAPI.io 余额从采集前 25,105 到 2026-11-21 14:53（Asia/Shanghai）复核时 24,490，观测实扣 **615 credits**，低于本轮 1,800 credits 的包含失败尝试保守上限，余额高于 3,000 保底。不能从总差额可靠拆出各页费用。若以独立文字复核的 14 条“值得补商品关联”作分母，约 43.9 credits/条待补证记录；这不是获客成本，已确认商品适配和可联系人数都是 0。
- 原始待筛总表从 360 到 400 行；原任务与续跑任务各 20 行。复用宠物页只有 3 条分类/证据字段按 linked 档案回填；其余字段指纹在回填前后都是 `8537ae8fea879d8f1a55794a4d788fe2`，原任务来源、首次留存与人工 `unreviewed` 状态保留。严格 `x_leads` 仍 841，`x_reply_jobs` 仍 163，活跃搜索任务 0。
- 代码提交 `640190713b13b571e2328daae82b4b4a56874e75` 和受控续跑提交 `bd5665b051df22208fbd7cc7516d91ae5d124f61` 均推送；后者生产部署状态已只读核为 `READY`。发现 worker 版本 `1.18.1`，数据库心跳 `online`。本地聚焦 Python 测试 22/22、TS 相关测试、ESLint 与 Next build 通过；没有登录浏览器逐卡视觉验收。
- `engagement_recall` 由后台手动任务配置触发；生产定时配置仍 `enabled=false`、`next_run_at=null`，当前无排队/运行任务。本次部署未启动持续付费发现。旧 `consumer-life-scenes-v2.2` 行仍在独立原始表，可用后台“旧生活画像优先”或“全部原始帖”查看，不因新默认筛选隐藏而删除。

管理员可直接查看[原任务宠物原始 20 帖](https://www.thebestdiyshop.com/admin/x-leads?mode=raw_review&tier=all&field=archive&query=engagement-recall-20261121T063722Z-a98ecf18.json)、[续跑作品原始 20 帖](https://www.thebestdiyshop.com/admin/x-leads?mode=raw_review&tier=all&field=archive&query=engagement-recall-20261121T063722Z-3ca48e47.json)、[新三组当前待筛池](https://www.thebestdiyshop.com/admin/x-leads?mode=raw_review)及[旧生活画像优先](https://www.thebestdiyshop.com/admin/x-leads?mode=raw_review&tier=valuable)。档案筛选 URL 仅按 `source_archive` 查各 20 行；复用页不会重复显示在续跑来源中。后台需管理员登录。

本批可证明归档、受控续跑、分层留存与人工待核实边界可运行；不能证明线程参与者发现有效，不能证明具体商品兴趣、成交可能性或长期筛选精度。

归档整理说明：逐账号 AI 文字复核 TSV 曾随报告进入提交 `8794e0b`；随后以普通提交 `4073118` 从当前跟踪版本移除，保存在本机被忽略的 `.data/purchase-discussion-evaluation/`。未改写 Git 历史。
