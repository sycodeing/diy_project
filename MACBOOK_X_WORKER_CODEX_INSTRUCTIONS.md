# DiyProject：Mac 笔记本 X 执行器改造指令

你现在负责改造一个已经存在的 Next.js + Supabase + Python 项目 DiyProject，并在这台 Mac 笔记本上配置 X 自动发送执行器。

你没有之前对话的上下文，因此必须以本指令和当前仓库代码为准。不要假设任何未验证的信息。

如果当前没有打开 DiyProject 仓库，先停止并只询问我：

> 请提供 DiyProject 的 Git 仓库地址，或在 Codex 中打开已经克隆的项目目录。

不要自行猜测仓库地址或创建一个新项目。

## 一、已知项目背景

- 项目名称：DiyProject
- 正式网站：https://www.thebestdiyshop.com
- Vercel 项目名称：`diy-project`
- 生产 Supabase 项目 ID：`bssuzivqlfseovuqjdbf`

现有业务流程：

1. 管理后台收集和筛选公开的 X 宠物候选帖子。
2. 管理员查看候选、原帖、位置证据、图片和评分。
3. 管理员将候选加入自动发送队列。
4. 系统生成预览图、营销链接和个性化回复文案。
5. 管理员逐条审核并批准。
6. 本地 Worker 到计划时间后执行 X 回复。
7. 后台记录 `sent`、`failed` 或 `uncertain`。
8. 每日第一条成功后，默认等待管理员确认再放行后续任务。

当前代码已经实现管理后台、Supabase 队列、每日监督闸门和结果审计。

当前发送执行器使用 BitBrowser，但现在要彻底改成：

```text
正式管理后台
→ Mac 笔记本本地 Worker
→ x-use + Patchright 可见浏览器
→ X
```

测试阶段使用 Mac 系统级 VPN 的出口 IP。以后正式运行时，切换为一个 X 账号绑定一个固定住宅代理。

## 二、绝对安全边界

1. 本次不允许真实发送任何 X 帖子、回复、私信或关注。
2. 完成代码、部署和 `observe` 验证后必须停下。
3. 除非我之后明确批准一条具体任务，否则不能切换到真实发送模式。
4. 不得使用旧的 x-use `run_cycle`。
5. 不得使用轮换代理。
6. 不得绕过 CAPTCHA、登录验证、账号锁定或频率限制。
7. X Cookie 只能保存在这台 Mac 本地。
8. Cookie 不得上传到 Vercel、Supabase、Git 或聊天。
9. 不得要求我把 Cookie、Worker Secret、代理密码或 API Key 粘贴到聊天。
10. 超时或结果不确定时不得自动重试。
11. 不得回滚、覆盖或清理不属于本任务的现有修改。
12. 不得把 draft、queued、模拟测试或本地成功报告为真实发送成功。

## 三、仓库检查要求

进入仓库后先执行只读检查：

1. 阅读根目录 `AGENTS.md`。
2. 检查 `git status`、当前分支和远程仓库。
3. 检查是否存在未提交修改。
4. 保留所有不属于本任务的修改。
5. 检查 `package.json`、`requirements.txt` 和锁文件。
6. 检查是否存在项目级或目录级 `AGENTS.md`。
7. 运行现有相关测试，记录修改前基线。

这个项目使用的 Next.js 版本可能包含训练数据之外的破坏性变化。

修改任何 Next.js 代码之前，必须阅读 `node_modules/next/dist/docs/` 中当前版本与以下内容相关的文档：

- App Router
- Server Actions
- Route Handlers
- 环境变量
- 动态路由参数
- `after()`
- 缓存和 `revalidatePath`

不要依赖旧版 Next.js 经验。

重点检查这些相对路径：

- `x-lead-studio/lead_studio/x_reply_worker.py`
- `x-lead-studio/lead_studio/xuse_client.py`
- `x-lead-studio/lead_studio/bitbrowser_client.py`
- `x-lead-studio/lead_studio/config.py`
- `x-lead-studio/lead_studio/app.py`
- `x-lead-studio/tests/`
- `x-lead-studio/.env.example`
- `x-lead-studio/README.md`
- `src/app/api/x-replies/worker/jobs/claim/route.ts`
- `src/app/api/x-replies/worker/jobs/[id]/complete/route.ts`
- `src/app/api/x-replies/worker/proxies/verify/route.ts`
- `src/app/admin/x-accounts/page.tsx`
- `src/app/admin/x-accounts/actions.ts`
- `src/app/admin/x-auto-posts/page.tsx`
- `src/app/admin/x-auto-posts/actions.ts`
- `src/app/admin/x-leads/actions.ts`
- `src/lib/x-reply.ts`
- `src/lib/x-proxy-crypto.ts`
- `supabase/schema.sql`
- `supabase/migrations/`

## 四、当前实现提示

当前实现大致存在以下结构，但必须以实际代码核实：

1. `x_reply_worker.py` 当前依赖 `BitBrowserClient`。
2. `bitbrowser_client.py` 直接控制比特浏览器窗口。
3. 任务领取 API 要求 Worker 上报 BitBrowser 窗口列表。
4. 账号管理页要求填写比特浏览器窗口 ID。
5. 批准操作要求最近在线的 Worker 报告该窗口。
6. `xuse_client.py` 仍然保留，已经具备：
   - 检查 x-use 安装
   - 检查本地账号 Cookie
   - 创建 x-use pending draft
   - 调用 `approve_draft`
   - 保存 `draft_id` 和 `action_id`
   - 将超时或不明确结果分类为 `uncertain`
   - 固定代理测试
7. 任务完成 API 已经支持：
   - `xUseDraftId`
   - `actionId`
   - `resultUrl`
   - `egressIp`
   - `sent/failed/uncertain`
8. Supabase 中存在：
   - `x_reply_accounts`
   - `x_reply_account_proxies`
   - `x_reply_jobs`
   - `x_reply_workers`
   - `x_reply_daily_gates`

必须核实后再修改。

## 五、目标架构

管理后台负责：

- 候选筛选
- 素材和文案准备
- 逐条人工批准
- 发送时间
- 每日上限
- 每日第一条监督
- 暂停
- 结果审计

Mac 笔记本负责：

- 保存本地 X Cookie
- 运行 x-use
- 运行 Patchright 可见浏览器
- 验证实际浏览器出口 IP
- 通过 HTTPS 主动轮询正式后台
- 领取绑定到本执行器的任务
- 执行一次写操作
- 回报结果

不再需要：

- BitBrowser
- 比特浏览器窗口 ID
- Mac 公网入站端口
- 路由器端口映射
- 将 Cookie 上传到云端

## 六、执行器身份与安全模式

增加稳定的执行器 ID：

```env
X_REPLY_EXECUTOR_ID=macbook-x-01
```

增加执行模式：

```env
X_REPLY_EXECUTION_MODE=observe
```

只允许：

- `observe`
- `send`

规则：

1. 默认必须是 `observe`。
2. 缺少该变量时按 `observe`。
3. 值无效时按 `observe`。
4. `observe` 只能上报状态。
5. `observe` 不得领取任务。
6. `observe` 不得把 `queued` 改成 `claimed`。
7. `observe` 不得打开 X 写入页面。
8. `observe` 不得创建或批准 x-use draft。
9. 只有之后得到我的明确授权，才可以改为 `send`。

Worker 心跳至少上报：

- `executorId`
- `executionMode`
- `workerVersion`
- hostname 或安全设备备注
- `xUseAvailable`
- `configuredAccounts`
- `currentEgressIp`
- `networkProbeStatus`
- `lastError`
- `lastSeenAt`

禁止上报：

- Cookie
- Cookie 文件内容
- 代理密码
- Worker Secret
- x-use 完整配置
- 浏览器本地数据

## 七、网络模式

账号增加 `network_mode`：

- `vpn_direct`
- `fixed_proxy`

第一阶段使用 `vpn_direct`。

### vpn_direct

1. 使用 macOS 系统级 VPN。
2. 不接受普通浏览器扩展 VPN。
3. 不要求代理 URL。
4. 不修改 x-use 账号代理设置。
5. 不调用代理池。
6. 不允许直接线路静默回退。
7. 使用独立、无 Cookie 的 Patchright 浏览器访问 IP 检测服务。
8. 必须验证浏览器真实出口，不能只检测普通 Python/httpx 请求。
9. 管理后台保存 `expected_egress_ip`。
10. 首次检测到 VPN IP 后，由管理员在后台明确确认并锁定。
11. `expected_egress_ip` 未锁定时不能批准或领取任务。
12. 每次领取任务前检查出口。
13. 实际写入 X 前再次检查出口。
14. IP 不一致时阻止发送。
15. VPN 断开或出口无法确认时阻止发送。
16. IP 变化不得自动更新锁定值。
17. 必须由管理员重新确认新 IP。

### fixed_proxy

1. 一个 X 账号绑定一个固定住宅代理。
2. 不允许 `round_robin`。
3. 不允许轮换住宅代理。
4. 代理凭据由后台应用层加密。
5. 只有绑定的执行器在领取任务时获得代理。
6. 使用 x-use `test_proxy` 验证真实出口。
7. 一个出口 IP 不允许绑定多个 X 账号。
8. 代理失败时不得回退直连。
9. 代理更换后必须重新人工验证。

## 八、数据库改造

创建新的非破坏性迁移，不要修改已有历史迁移文件，不要立即删除旧 BitBrowser 字段。

`x_reply_accounts` 增加或调整：

- `executor_id text`
- `network_mode text`
- `expected_egress_ip inet`，或经过严格 IP 验证的 text
- `bitbrowser_window_id` 不再是批准或发送必需条件
- `vpn_direct` 允许没有代理记录
- `fixed_proxy` 必须有代理记录

`network_mode` 必须限制为：

- `vpn_direct`
- `fixed_proxy`

`x_reply_workers` 增加或调整：

- `executor_id`
- `execution_mode`
- hostname 或 `device_label`
- `xuse_available`
- `configured_accounts`
- `current_egress_ip`
- `network_probe_status`
- `last_seen_at`
- `last_error`
- `current_job_id`

迁移要求：

1. 兼容现有数据。
2. 保留历史记录。
3. 保留 RLS。
4. 保持 `service_role` 权限边界。
5. 不把 Cookie 写入数据库。
6. 不把代理明文写入数据库。
7. 为 `executor_id` 和领取查询添加必要索引。
8. 旧 `bitbrowser_*` 字段暂时保留。
9. 新逻辑不再依赖旧字段。

## 九、管理后台改造

X 账号页面移除以下必填要求：

- BitBrowser 窗口 ID
- BitBrowser 窗口名称
- 所有账号都必须填写代理

新增或展示：

- 绑定执行器
- 网络模式
- VPN 锁定出口 IP
- 当前执行器出口 IP
- x-use 本地账号是否存在
- 执行器 `observe/send` 状态
- 最后心跳时间
- 网络检查结果
- 每日批准上限
- 每日首条监督
- 启用/暂停

VPN 模式：

- 不显示代理必填错误。
- 显示 Mac 当前上报的出口 IP。
- 提供明确的“确认并锁定当前出口 IP”操作。
- 锁定前不能批准任务。
- 当前 IP 与锁定 IP 不一致时显示醒目错误。
- 不允许自动替换锁定 IP。

固定代理模式：

- 代理 URL 使用密码输入框。
- 只显示脱敏主机。
- 不回显用户名和密码。
- 显示最近真实出口 IP。
- 显示最近验证时间和错误。

自动发送页移除 BitBrowser 文案，改为显示：

- Mac 执行器在线/离线
- `observe/send`
- x-use 正常/异常
- 本地账号存在/缺失
- 当前出口 IP
- 网络模式
- 出口是否匹配
- 每日第一条闸门
- 任务状态
- x-use draft ID 和 action ID

## 十、批准规则

批准自动任务时必须满足：

1. 任务仍为 `draft`。
2. `preparation_status=ready`。
3. 账号启用。
4. 已绑定 `executor_id`。
5. 对应执行器最近五分钟在线。
6. 执行器上报 `xUseAvailable=true`。
7. `configuredAccounts` 包含该 `account_key`。
8. `network_mode` 配置完整。
9. `vpn_direct` 已锁定出口 IP。
10. `vpn_direct` 当前出口与锁定 IP 一致。
11. `fixed_proxy` 存在有效代理记录。
12. `fixed_proxy` 代理不处于 `error`。
13. 没超过每日上限。

批准只把任务改成 `queued`，批准本身不能执行 X 写操作。

## 十一、领取规则

Worker 领取任务必须满足：

1. `execution_mode=send`。
2. `executor_id` 与账号绑定一致。
3. x-use 本地存在该 `account_key`。
4. `xUseAvailable=true`。
5. Worker 心跳新鲜。
6. 任务已经逐条批准。
7. `scheduled_for` 已到。
8. `attempt_count=0`。
9. 每日闸门允许。
10. 当前出口符合网络策略。

`observe` 模式必须返回 204。

任何账号、执行器或网络不匹配也应返回 204，或返回安全的非敏感诊断；不得领取任务后才发现绑定不匹配。

## 十二、发送执行器改造

重写 `x-lead-studio/lead_studio/x_reply_worker.py`：

1. 删除 `BitBrowserClient` 运行时调用。
2. 使用 `xuse_client.send_approved_action()`。
3. 使用明确的 `account`、`action_type`、`tweet_url` 和 `text`。
4. 不使用 `auto` 文案。
5. 文案必须与后台批准文本完全一致。
6. x-use 必须先返回 pending draft。
7. 只有同一条后台已批准任务才能调用 `approve_draft`。
8. 每个写操作只执行一次。
9. 保存 `draft_id`。
10. 保存 `action_id`。
11. 保存结果 URL。
12. 保存实际出口 IP。
13. 超时或无法确认时返回 `uncertain`。
14. `claimed` 和 `uncertain` 不自动重试。
15. 登录失效、CAPTCHA、验证、锁定或限流时停止。

修改 `xuse_client.py`：

1. 支持 `network_mode`。
2. `vpn_direct` 允许没有代理。
3. `vpn_direct` 不调用 `update_account(proxy)`。
4. `vpn_direct` 不调用代理池。
5. `vpn_direct` 在同类 Patchright 浏览器中验证直连出口。
6. `fixed_proxy` 继续强制代理。
7. `fixed_proxy` 使用 `test_proxy`。
8. 两种模式都不允许网络校验失败后继续发送。
9. Cookie 只从 `X_USE_HOME` 读取。
10. 保留 x-use draft gate。
11. 保留 `uncertain` 防重边界。

任务完成接口继续记录：

- `sent`
- `failed`
- `uncertain`
- `xuse_draft_id`
- `action_id`
- `result_url`
- `error_code`
- `error_message`
- `egress_ip`
- `completed_at`

## 十三、macOS 本地配置

不要假设 Mac 已安装 Python、x-use 或 Patchright。使用当前稳定且与项目兼容的 Python 版本创建项目虚拟环境。

macOS 路径和命令必须使用 POSIX 形式，不要输出 Windows PowerShell 命令。

虚拟环境通常使用：

- `.venv/bin/python`
- `.venv/bin/pip`
- `.venv/bin/x-use`

需要新增 `x-lead-studio/run.sh`。

`run.sh` 要求：

1. 使用脚本所在目录解析项目路径。
2. 不依赖当前 shell 工作目录。
3. 使用 `.venv/bin/python`。
4. 使用 `exec` 启动 uvicorn。
5. 正确处理包含空格的路径。
6. 不打印环境变量和密钥。
7. 设置可执行权限。
8. 继续只绑定 `127.0.0.1:8020`。

不要立即创建开机自启动。只有 `observe` 稳定验证后，才可以准备但不启用 macOS launchd 配置。

建议本地环境变量：

```env
DIY_SITE_URL=https://www.thebestdiyshop.com
X_REPLY_WORKER_ENABLED=true
X_REPLY_WORKER_SECRET=
X_REPLY_EXECUTOR_ID=macbook-x-01
X_REPLY_EXECUTION_MODE=observe
X_REPLY_WORKER_POLL_SECONDS=15
X_USE_HOME=/Users/<实际用户名>/Library/Application Support/x-use
```

要求：

1. 不要使用字面量 `<实际用户名>`。
2. 自动解析当前用户目录后，写入最终绝对路径。
3. 路径包含空格时正确处理。
4. 不把真实密钥写入 `.env.example`。
5. `.env` 必须保持 Git 忽略。
6. 不要在聊天中输出 `X_REPLY_WORKER_SECRET`。
7. 如果本地缺少 Secret，只报告“本地尚未配置”。
8. 让我通过密码管理器、加密文件或其他本地安全方式设置。
9. 不要要求我在聊天中粘贴 Secret。

## 十四、X 账号配置

使用 x-use 的标准安装和设置流程：

1. 安装项目锁定依赖。
2. 安装 Patchright Chromium。
3. 使用独立 `X_USE_HOME`。
4. 运行 `x-use doctor`。
5. Cookie 文件由我在 Mac 本地准备。
6. 不读取或打印 Cookie 内容。
7. 不把 Cookie 路径写进 Git。
8. 使用本地路径导入账号。
9. `account_id` 必须与管理后台 `account_key` 一致。
10. 进行一次有界的只读登录验证。
11. 遇到登录或账号挑战立即停止。

如果缺少账号配置，只能询问：

- 账号短 ID
- Cookie 文件在这台 Mac 上的本地路径

不要要求 Cookie 内容。

## 十五、macOS VPN 要求

测试必须使用 macOS 系统级 VPN。

开始 `observe` 验证前检查：

1. VPN 已连接。
2. 普通系统出口已经变化。
3. Patchright 无 Cookie 浏览器出口与预期 VPN 出口一致。
4. VPN 断开测试能被识别。
5. VPN 断开后 Worker 不会领取任务。
6. VPN 重新连接但 IP 变化时不会自动更新 `expected_egress_ip`。

如果 VPN 只是浏览器扩展，停止并说明它不能覆盖 Worker 的独立浏览器。

## 十六、测试要求

新增或更新测试，至少覆盖：

1. `observe` 不领取任务。
2. `observe` 不修改 queued 任务。
3. `executor_id` 不匹配不领取。
4. x-use 本地账号缺失不领取。
5. `vpn_direct` 未锁定 IP 不批准。
6. `vpn_direct` 未锁定 IP 不领取。
7. 当前 IP 与锁定 IP 不同不发送。
8. 浏览器出口检测失败不发送。
9. VPN 断开不发送。
10. `fixed_proxy` 缺少代理不发送。
11. `fixed_proxy` 测试失败不回退直连。
12. `vpn_direct` 不调用 `update_account(proxy)`。
13. `vpn_direct` 不调用代理池。
14. `fixed_proxy` 调用 `test_proxy`。
15. 批准文本原样传给 x-use。
16. 必须获得 pending draft 才 approve。
17. `failed` 与 `uncertain` 正确分类。
18. `uncertain` 不自动重试。
19. `attempt_count` 防止重复领取。
20. 每日首条成功后暂停后续任务。
21. Cookie、代理密码和 Worker Secret 不出现在日志。
22. 旧 BitBrowser 字段不会影响新流程。
23. `run.sh` 在包含空格的 macOS 路径下仍能启动。

验证命令必须根据仓库实际脚本和工具帮助发现，不要猜测不存在的命令。

至少完成：

- Python 测试
- Node/TypeScript 测试
- lint
- build
- `git diff --check`
- `x-use doctor`
- 数据库迁移检查
- API 只读检查

如果修改多个 TSX 组件，执行仓库要求的 React/Next.js 检查。

## 十七、部署顺序

### 阶段 A：本地实现

- 完成代码。
- 完成迁移文件。
- 更新 README 和 `.env.example`。
- 所有测试通过。
- 不真实发送。

### 阶段 B：后台部署

如果这台 Mac 已经具备 Supabase 和 Vercel 授权：

1. 再次确认目标是：
   - Vercel：`diy-project`
   - Supabase：`bssuzivqlfseovuqjdbf`
2. 应用非破坏性迁移。
3. 部署正式后台。
4. 验证旧数据仍可读取。
5. 验证管理页面正常。
6. 不真实发送。

如果没有相应授权：

1. 不索要访问令牌或密钥。
2. 不绕过授权。
3. 完成本地实现和测试。
4. 明确报告部署被授权状态阻塞。
5. 提供由我在本机执行的安全部署步骤。

### 阶段 C：Mac observe

1. `X_REPLY_EXECUTION_MODE=observe`。
2. 启动系统级 VPN。
3. 启动 Worker。
4. 管理后台显示 `macbook-x-01` 在线。
5. 管理后台显示 x-use 正常。
6. 管理后台显示目标 `account_key` 存在。
7. 管理后台显示 Patchright 实际 VPN 出口 IP。
8. 管理员锁定该出口 IP。
9. `observe` 持续运行时没有任务被领取。
10. 数据库中没有因为本次验证新增 `claimed`、`sent` 或 `uncertain` 写任务。

完成阶段 C 后立即停止，不得进入 `send` 阶段。

## 十八、最终报告格式

完成后报告：

1. 当前仓库和分支。
2. 修改过的文件。
3. 新增的数据库迁移。
4. BitBrowser 依赖是否已从运行时移除。
5. Vercel 部署地址和部署 ID；未部署则说明原因。
6. Supabase 迁移是否已应用；未应用则说明原因。
7. Mac 执行器 ID。
8. Worker 是否处于 `observe`。
9. `x-use doctor` 结果。
10. 本地账号是否配置成功。
11. Patchright 检测到的 VPN 出口是否已在后台锁定。
12. Python 测试结果。
13. Node/TypeScript 测试结果。
14. lint 结果。
15. build 结果。
16. `git diff --check` 结果。
17. 是否发生任何真实 X 写操作；答案必须是“否”。
18. 第一条真实测试还需要我完成什么。
19. 所有尚未解决的风险和阻塞。

## 最终验收标准

- 管理后台不再依赖 BitBrowser。
- Mac Worker 通过 HTTPS 主动连接正式后台。
- Worker 保持 `observe` 模式。
- x-use 本地账号可用。
- X Cookie 只在 Mac 本地。
- Patchright 实际 VPN 出口已验证。
- 管理后台已锁定该出口。
- `observe` 模式没有领取任务。
- 没有发生任何真实 X 写操作。
- 系统已具备在我以后明确授权后执行一条逐条批准任务的条件。
