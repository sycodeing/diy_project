# X 账号草稿自动队列 V2（2026-11-22）

V2 使用独立后台入口 `/admin/x-auto-posts-v2`。管理员从账号候选中勾选已有 `draft_ready` 草稿，选择一个发送账号，点击「加入待审队列」。此操作只创建 `queue_version=2`、`status=draft`、无批准时间的任务；页面逐条显示加入成功或失败原因。管理员随后在 V2 列表核对本人原帖、商品、完整公开回复文案和真实 `/g/` 链接，明确勾选任务并点击「批准所选并启动」。批准前会重新检查账号、原帖时效、商品、链接、历史联系、执行器及发送账号安全条件；共享 RPC 按 V1/V2 合计每日额度原子批准。列表回显待审、已排队、已领取、已发送、失败、不确定或已撤回状态及可得的执行结果。

V2 的内容模式是 `account_product_link`：推荐当前在售商品，使用独立的真实商品追踪链接，`source_image_url` 为 `null`，不借用引用帖或他人的图片。V1 `/admin/x-auto-posts` 保留原有任务与状态。V2 只有在 Mac 执行器报告兼容版本、健康状态和 `send` 模式，且每条任务经过人工批准后，才可能进入实际执行。

数据库迁移 `20261122090724_x_account_auto_queue_v2.sql` 和 `20261122091535_x_reply_v2_atomic_approval.sql` 已应用。20 条现有账号草稿及链接用实时数据库只读快照运行实际 `validateV2Evidence`，20/20 通过；这验证的是草稿与当前 V2 校验契约兼容，并不代表已创建 V2 任务。两份 `BEGIN ... ROLLBACK` 数据库 smoke 分别验证 V2 身份字段、作者唯一性、默认未批准、V1 隔离，以及共享 RPC 的版本隔离、权限、待审门槛、重复批准和 V1/V2 共用额度；测试写入均已回滚。北京时间 17:17:41 后置数据库回读为 V1 任务 163、V2 任务 0、可执行任务 0、人工发送记录 171、账号草稿 20。本轮没有实际入队、批准或发送。

证据文件（均在本地忽略目录 `x-lead-studio/.data/purchase-discussion-evaluation/`）：`x_reply_v2_live_snapshot_20261122.json`、`x_reply_v2_live_evidence_audit_20261122.json`、`x_account_queue_v2_rollback_smoke_20261122.sql`、`x_account_queue_v2_rollback_smoke_audit_20261122.json`、`x_reply_v2_atomic_approval_rollback_smoke_20261122.sql`、`x_reply_v2_atomic_approval_rollback_smoke_audit_20261122.json`。纯校验快照观测于北京时间 17:12:21，执行于 17:18:34；后续使用时仍按实时数据复核。

Mac 在线执行器目前报告 `4.10.1`，V2 要求至少 `4.11.0`。本环境没有该 Mac 的远程升级通道；需在 Mac 的**现有 DiyProject clone** 中由操作者升级。确认原先运行 `./run.sh` 的终端，先用 `Ctrl+C` 停止该进程；若实际由本机进程管理器启动，应在同一管理器停止和重启，避免两个实例并行。然后在现有仓库根目录运行：

```sh
git status --short
git pull --ff-only
cd x-lead-studio
./run.sh
```

`run.sh` 会使用当前 `x-lead-studio/.venv/bin/python` 在 `127.0.0.1:8020` 启动服务；本次没有改 Python 依赖，无需重新安装。若 `git status` 显示未处理的本地修改，先在 Mac 上处理后再拉取。升级后查看执行器心跳是否报告当前代码版本 `4.11.0-account-product-link`，并确认现有执行模式和账号/出口配置符合预期。上述步骤不切换 `X_REPLY_EXECUTION_MODE`，不改发送账号或网络出口，也不自动批准任务。

商品审核快照列由追加迁移 `20261122092327_x_reply_v2_product_snapshot.sql` 单独创建，已在线上应用并回读确认。相关 TS 测试 34 项、Python worker 测试 258 项通过；`npx eslint src --quiet` 与 `npm run build` 通过。提交号、网站部署及 Mac 执行器升级状态以各自后续实际证据为准。
