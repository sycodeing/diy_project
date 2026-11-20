# X 个人生活场景待筛

`consumer_recall` 是独立的只读原始待筛模式，不修改严格 `x_leads`、联系审批或发送队列。当前 `consumer-life-scenes-v2` 把本人宠物生活、本人居住空间布置、本人重要关系回忆分开记录。单帖的第一人称故事可成为弱或中等复核信号；`continuity_evidence=not_established_by_single_post` 表示未证明持续行为。转发、商家、机构新闻与只有节日问候的帖子排除。

每条保留原文证据、人群适配、场景适配、商品适配、交流切入、购物意向、复核优先级及待核实事项。未说购买时 `shopping_intent=unknown`，这不是排除理由。原帖图片仅供理解语境；URL 未经视觉核验，不能当作本人宠物或定制预览。只读草稿使用自家作品示例，不会保存或发送。

线上产品目录读取 `products.active`；截至本次只读核对，`custom-pillow` 和 `face-towel` 有活动变体。分类器仅对原文明示照片枕套或照片面巾标 `product_fit=verified`；纯生活场景保持 `unknown`，不声称用户已选择商品。目录可能变化，实际商品适配必须人工再次核对。

六条短查询分别覆盖三画像，每画像两组、每组最多一页，最近三天。查询不要求买、推荐或求购词。执行前取得已联系快照，失败即停止；每页原始响应先归档再分类，按历史 post ID 和本轮 author 分别统计。余额至少 3000 credits，本轮观测支出达到 2500 即停。原始入选与严格资格分开报告，不为凑数字扩大页数。

旧 `consumer-personas-v1.1` 档案通过 `reclassify_consumer_archive.py SOURCE DESTINATION` 离线重审，输出每帖旧新分类快照；只有分类字段可回填，原始档案、source、媒体、首次留存和人工状态保持原样。旧批复核不算新 API 数据。验证：`x-lead-studio/.venv/Scripts/python.exe -m pytest x-lead-studio/tests/test_consumer_recall.py -q`，并运行 TS 测试、lint/build 与上线后 1.17.0 worker、任务及数据库隔离核验。
