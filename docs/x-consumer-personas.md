# X 个人生活场景待筛

`consumer_recall` 是独立的只读原始待筛模式，不修改严格 `x_leads`、联系审批或发送队列。当前 `consumer-life-scenes-v2.2` 把本人宠物生活、本人居住空间布置、本人重要关系回忆分开记录。单帖的第一人称宠物自述可成为弱或中等复核信号，具体生活动词不再是硬门槛；`continuity_evidence=not_established_by_single_post` 表示未证明持续行为。不确定语境与敏感照护只保留待核实证据，不生成促销草稿。转发、商家、机构新闻与只有节日问候的帖子排除。

每条保留原文证据、人群适配、场景适配、商品适配、交流切入、购物意向、复核优先级及待核实事项。未说购买时 `shopping_intent=unknown`，这不是排除理由。页面默认“可优先复核”只显示当前版本、未被忽略、无语境暂缓且本人关系不模糊的生活画像；“语境待核”“本人关系待补证”和“全部原始帖”均可独立查看，均非联系许可。原帖图片仅供理解语境；URL 未经视觉核验，不能当作本人宠物或定制预览。只读草稿使用自家作品示例，不会保存或发送。敏感生活处境保留为待审人群证据，但标记 `needs_context_review` 且页面不生成促销草稿；未来婚礼等计划标记 `experience_phase=future_planned`，文案不称其为已发生的共同回忆。

线上产品目录读取 `products.active`；截至本次只读核对，`custom-pillow` 和 `face-towel` 有活动变体。分类器仅对原文明示照片枕套或照片面巾标 `product_fit=verified`；纯生活场景保持 `unknown`，不声称用户已选择商品。目录可能变化，实际商品适配必须人工再次核对。

默认六条短查询分别覆盖三画像，每画像两组、每组最多一页，最近三天。2026-11-20 曾有界试验宠物四组、家居一组、关系一组，其中四组使用服务商 `filter:images`；原始归档保留，但这组查询没有改善待审人群召回，因此不再作默认。图片过滤命中只说明返回帖有原帖 photo 元数据，不证明是可用宠物照片；不做视觉或归属验证。默认查询不要求买、推荐或求购词。执行前取得已联系快照，失败即停止；每页原始响应先归档再分类，按历史 post ID 和本轮 author 分别统计。余额至少 3000 credits，本轮观测支出达到 2500 即停。原始入选与严格资格分开报告，不为凑数字扩大页数。

旧档案通过 `reclassify_consumer_archive.py SOURCE DESTINATION` 离线重审，输出每帖旧新分类快照；只有分类字段可回填，原始档案、source、媒体、首次留存和人工状态保持原样。旧批复核不算新 API 数据，原任务指标仍对应当时使用的分类器。验证：`x-lead-studio/.venv/Scripts/python.exe -m pytest x-lead-studio/tests/test_consumer_recall.py -q`，并运行 TS 测试、lint/build 与上线后 1.17.3 discovery worker、任务及数据库隔离核验。
