import { AlertTriangle, CheckCircle2, KeyRound, Laptop, Network, Pencil, Plus } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { FormSubmitButton } from "@/components/form-submit-button";
import { SetupWarning } from "@/components/setup-warning";
import { requireAdmin } from "@/lib/auth";
import { getXReplyWorkerSecret } from "@/lib/env";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { cn, formatDate, getServerNowMillis } from "@/lib/utils";
import type { XReplyAccount, XReplyAccountProxy, XReplyWorker } from "@/lib/x-reply";
import { createXAccount, deleteXAccount, lockCurrentVpnEgress, requestXAccountMappingVerification, updateXAccount } from "./actions";
import { QueueAutoRefresh } from "@/components/queue-auto-refresh";

export const dynamic = "force-dynamic";

const notices: Record<string, string> = {
  created: "账号与执行器网络策略已保存；出口未通过校验前不能批准或领取任务。",
  updated: "账号配置已更新；VPN 锁定 IP 不会被执行器自动替换。",
  "vpn-locked": "已由管理员明确锁定当前 Patchright 浏览器出口 IP。",
  "verification-requested": "打开任务已提交；Mac 将通过该账号绑定的代理打开 X 主页，并核对登录身份与出口 IP。",
  deleted: "未产生发送历史的账号已删除。",
  "in-use": "该账号已有发送历史，为保留审计记录不能删除；可以将它停用。",
};

export default async function XAccountsPage({ searchParams }: { searchParams: Promise<{ notice?: string }> }) {
  await requireAdmin("/admin/x-accounts");
  const supabase = getSupabaseServiceClient();
  if (!supabase) return <AppShell admin><main className="mx-auto w-full max-w-3xl px-4 py-10"><SetupWarning /></main></AppShell>;
  const filters = await searchParams;
  const [{ data: accountRows, error: accountsError }, { data: proxyRows, error: proxiesError }, { data: workerRows, error: workersError }] = await Promise.all([
    supabase.from("x_reply_accounts").select("*").order("created_at", { ascending: true }),
    supabase.from("x_reply_account_proxies").select("account_id,encrypted_url,display_host,expected_country,expected_region,status,egress_ip,last_tested_at,last_error,updated_at"),
    supabase.from("x_reply_workers").select("*").order("last_seen_at", { ascending: false }),
  ]);
  const accounts = (accountRows ?? []) as XReplyAccount[];
  const proxies = new Map(((proxyRows ?? []) as XReplyAccountProxy[]).map((proxy) => [proxy.account_id, proxy]));
  const renderedAt = getServerNowMillis();
  const workers = new Map(((workerRows ?? []) as XReplyWorker[]).filter((worker) => worker.executor_id)
    .map((worker) => [worker.executor_id as string, worker]));
  const secret = getXReplyWorkerSecret();
  const notice = filters.notice ? notices[filters.notice] : null;
  const verificationActive = accounts.some((account) => ["pending", "running"].includes(account.verification_status));

  return (
    <AppShell admin>
      <QueueAutoRefresh active={verificationActive} />
      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-8 sm:px-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div><p className="text-xs font-black uppercase tracking-[0.18em] text-accent-strong">Mac executor routing</p><h1 className="mt-1 text-4xl font-black">X 账号、执行器与出口 IP</h1><p className="mt-2 max-w-3xl text-sm leading-6 text-muted">Cookie 只留在绑定的 Mac。VPN 模式锁定系统级 VPN 出口；固定代理模式仍是一账号一住宅代理。</p></div>
          <div className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm font-bold text-blue-950"><KeyRound className="mr-2 inline" size={17} />observe 默认 · 网络失败禁止发送</div>
        </div>
        {notice ? <p className="mt-5 rounded-lg border border-line bg-panel p-3 text-sm font-bold">{notice}</p> : null}
        {accountsError || proxiesError || workersError ? <p className="mt-5 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">{accountsError?.message ?? proxiesError?.message ?? workersError?.message}</p> : null}
        {!secret ? <p className="mt-5 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm font-bold text-amber-900"><AlertTriangle className="mr-2 inline" size={17} />缺少 X_REPLY_WORKER_SECRET：VPN 账号可编辑，但固定代理不能安全加密保存。</p> : null}

        <section className="mt-6 rounded-xl border border-line bg-panel/90 p-5">
          <div className="flex items-center gap-3"><span className="rounded-lg bg-accent-soft p-2 text-accent-strong"><Plus size={20} /></span><div><h2 className="text-xl font-black">新增账号</h2><p className="text-xs text-muted">x-use 本地 account_id 必须与账号标识一致，并绑定到稳定执行器 ID。</p></div></div>
          <AccountForm action={createXAccount} submitLabel="新增账号并保存网络策略" />
        </section>

        <section className="mt-8">
          <h2 className="text-2xl font-black">现有账号</h2>
          <div className="mt-4 grid gap-5 xl:grid-cols-2">
            {accounts.map((account) => {
              const proxy = proxies.get(account.id);
              const worker = account.executor_id ? workers.get(account.executor_id) : undefined;
              const workerOnline = Boolean(worker && renderedAt - new Date(worker.last_seen_at).getTime() < 5 * 60_000);
              const accountConfigured = Boolean(worker?.configured_accounts.includes(account.account_key));
              const vpnMatches = account.network_mode !== "vpn_direct" || Boolean(account.expected_egress_ip && worker?.current_egress_ip === account.expected_egress_ip && worker.network_probe_status === "healthy");
              return <article className="rounded-xl border border-line bg-panel/90 p-5" key={account.id}>
                <div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="text-xl font-black">{account.display_name}</h3><p className="font-mono text-xs text-muted">{account.account_key}</p></div><div className="flex flex-wrap items-center justify-end gap-2"><form action={requestXAccountMappingVerification}><input name="accountId" type="hidden" value={account.id} /><FormSubmitButton className="focus-ring h-9 rounded-md border border-accent bg-white px-3 text-xs font-black text-accent disabled:opacity-50" disabled={!workerOnline || ["pending", "running"].includes(account.verification_status)} idleLabel="使用绑定代理打开 X 主页" pendingLabel="正在通知 Mac…" /></form><NetworkBadge account={account} proxy={proxy} workerOnline={workerOnline} vpnMatches={vpnMatches} /></div></div>
                <div className="mt-4 rounded-lg border border-line bg-white p-3 text-xs leading-6 text-muted"><p><Laptop className="mr-1 inline" size={14} /><strong className="text-foreground">{account.executor_id ?? "未绑定执行器"}</strong></p><p>{workerOnline ? `在线 · ${worker?.execution_mode}` : "离线（超过五分钟无心跳）"}</p><p>x-use：{worker?.xuse_available ? "正常" : "异常或未上报"} · 本地账号：{accountConfigured ? "存在" : "缺失"}</p>{worker?.last_seen_at ? <p>最后心跳：{formatDate(worker.last_seen_at)}</p> : null}{worker?.last_error ? <p className="text-red-700">{worker.last_error}</p> : null}</div>
                {account.network_mode === "vpn_direct" ? <div className={cn("mt-3 rounded-lg border p-3 text-xs leading-6", vpnMatches ? "border-emerald-200 bg-emerald-50 text-emerald-950" : "border-red-200 bg-red-50 text-red-900")}><p><Network className="mr-1 inline" size={14} /><strong>macOS 系统 VPN 直连</strong></p><p>当前 Patchright 出口：{worker?.current_egress_ip ?? "尚未确认"}</p><p>管理员锁定出口：{account.expected_egress_ip ?? "尚未锁定，禁止批准"}</p><p>网络检查：{worker?.network_probe_status ?? "unknown"}</p>{workerOnline && worker?.network_probe_status === "healthy" && worker.current_egress_ip ? <form action={lockCurrentVpnEgress} className="mt-2"><input name="accountId" type="hidden" value={account.id} /><FormSubmitButton className="focus-ring h-9 rounded-md bg-accent px-3 text-xs font-black text-accent-ink" idleLabel={account.expected_egress_ip ? "确认并重新锁定当前出口 IP" : "确认并锁定当前出口 IP"} pendingLabel="正在锁定…" /></form> : null}</div> : <div className="mt-3 rounded-lg border border-line bg-white p-3 text-xs leading-6 text-muted"><p><Network className="mr-1 inline" size={14} /><strong className="text-foreground">{proxy?.display_host ?? "未配置固定代理"}</strong></p><p>期望地区：{proxy ? `${proxy.expected_country}${proxy.expected_region ? ` · ${proxy.expected_region}` : ""}` : "—"}</p><p>最近真实出口：{proxy?.egress_ip ?? "尚未验证"}{proxy?.last_tested_at ? ` · ${formatDate(proxy.last_tested_at)}` : ""}</p>{proxy?.last_error ? <p className="text-red-700">{proxy.last_error}</p> : null}</div>}
                <div className={cn("mt-3 rounded-lg border p-3 text-xs leading-6", account.verification_status === "passed" ? "border-emerald-200 bg-emerald-50 text-emerald-950" : account.verification_status === "failed" ? "border-red-200 bg-red-50 text-red-900" : "border-line bg-white text-muted")}>
                  <p className="font-black text-foreground">账号 × IP 真实映射验证</p>
                  <p>期望 X 账号：@{account.expected_x_handle ?? "未配置"}</p>
                  <p>状态：{verificationLabel(account.verification_status)}</p>
                  {account.verified_x_handle ? <p>实际登录账号：@{account.verified_x_handle}</p> : null}
                  {account.verified_egress_ip ? <p>该账号浏览器出口：{account.verified_egress_ip}</p> : null}
                  {account.verification_completed_at ? <p>完成时间：{formatDate(account.verification_completed_at)}</p> : null}
                  {account.verification_error ? <p className="text-red-700">{account.verification_error}</p> : null}
                  <p className="mt-1">只读打开对应账号主页，不会发布、回复或点赞；窗口会保留约 10 分钟，也可以手动关闭。</p>
                </div>
                <p className="mt-3 text-xs text-muted">{account.require_daily_first_confirmation ? "每日首条成功后等待后台确认" : "每日首条后自动继续"}</p>
                <details className="mt-4"><summary className="focus-ring cursor-pointer rounded-lg border border-line px-4 py-3 text-sm font-black"><Pencil className="mr-2 inline" size={15} />编辑账号与网络</summary><AccountForm account={account} action={updateXAccount} proxy={proxy} submitLabel="保存修改" /></details>
                <form action={deleteXAccount} className="mt-3"><input name="accountId" type="hidden" value={account.id} /><FormSubmitButton className="focus-ring h-10 rounded-lg border border-red-200 px-4 text-sm font-bold text-red-700 disabled:opacity-50" idleLabel="删除未使用账号" pendingLabel="正在检查发送历史…" /></form>
              </article>;
            })}
            {!accounts.length ? <p className="rounded-xl border border-dashed border-line p-10 text-center text-muted">尚未配置 X 账号。</p> : null}
          </div>
        </section>
      </main>
    </AppShell>
  );
}

function NetworkBadge({ account, proxy, workerOnline, vpnMatches }: { account: XReplyAccount; proxy?: XReplyAccountProxy; workerOnline: boolean; vpnMatches: boolean }) {
  const healthy = workerOnline && (account.network_mode === "vpn_direct" ? vpnMatches : proxy?.status === "healthy");
  const label = account.network_mode === "vpn_direct" ? (healthy ? "VPN 出口匹配" : "VPN 未就绪") : healthy ? "固定代理健康" : proxy?.status === "error" ? "固定代理异常" : "固定代理待验证";
  return <span className={cn("rounded-md border px-2.5 py-1 text-xs font-black", healthy ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-red-200 bg-red-50 text-red-800")}>{healthy ? <CheckCircle2 className="mr-1 inline" size={13} /> : <AlertTriangle className="mr-1 inline" size={13} />}{label}</span>;
}

function AccountForm({ account, proxy, action, submitLabel }: { account?: XReplyAccount; proxy?: XReplyAccountProxy; action: (formData: FormData) => Promise<void>; submitLabel: string }) {
  return <form action={action} className="mt-4">{account ? <input name="accountId" type="hidden" value={account.id} /> : null}
    <div className="grid gap-x-4 sm:grid-cols-2">
      <Field defaultValue={account?.account_key} label="x-use 账号标识" name="accountKey" placeholder="pet_new_home" required />
      <Field defaultValue={account?.expected_x_handle ?? account?.account_key} label="期望 X 用户名（不含 @）" maxLength={15} name="expectedXHandle" placeholder="Latte192837465" required />
      <Field defaultValue={account?.display_name} label="后台显示名" name="displayName" placeholder="新宠到家号" required />
      <Area defaultValue={account?.positioning} label="账号定位" name="positioning" placeholder="专注记录新领养宠物与到家纪念" required />
      <Area defaultValue={account?.audience} label="目标受众" name="audience" placeholder="美国新领养狗或猫的主人" required />
      <Area defaultValue={account?.voice} label="表达语气" name="voice" placeholder="温暖、具体、不强推销" required />
      <Area defaultValue={account?.prohibited_topics} label="禁止话题" name="prohibitedTopics" placeholder="医疗建议、争议事件、未成年人" />
      <Field defaultValue={account?.topics.join(", ")} label="常用话题（逗号分隔）" name="topics" placeholder="new adoption, gotcha day" />
      <Field defaultValue={account?.daily_limit ?? 200} label="每日批准上限" max="200" min="1" name="dailyLimit" required type="number" />
      <label className="mt-3 block text-sm font-bold">文案风格<select className="focus-ring mt-2 h-11 w-full rounded-lg border border-line bg-white px-3" defaultValue={account?.copy_style ?? "warm"} name="copyStyle"><option value="warm">温暖细腻</option><option value="playful">活泼俏皮</option><option value="concise">简洁直接</option></select></label>
      <label className="mt-3 block text-sm font-bold">账号状态<select className="focus-ring mt-2 h-11 w-full rounded-lg border border-line bg-white px-3" defaultValue={String(account?.active ?? true)} name="active"><option value="true">启用</option><option value="false">停用</option></select></label>
      <Area defaultValue={account?.copy_variation_notes} label="文案差异备注" name="copyVariationNotes" placeholder="例如：少用感叹号，强调纪念意义。用于稳定选择该账号的文案变体。" />
      <Field defaultValue={account?.executor_id ?? "macbook-x-01"} label="绑定执行器 ID" maxLength={120} name="executorId" placeholder="macbook-x-01" required />
      <label className="mt-3 block text-sm font-bold">网络模式<select className="focus-ring mt-2 h-11 w-full rounded-lg border border-line bg-white px-3" defaultValue={account?.network_mode ?? "vpn_direct"} name="networkMode"><option value="vpn_direct">macOS 系统 VPN 直连</option><option value="fixed_proxy">一账号一固定住宅代理</option></select></label>
      <label className="mt-3 block text-sm font-bold">每日首条监督<select className="focus-ring mt-2 h-11 w-full rounded-lg border border-line bg-white px-3" defaultValue={String(account?.require_daily_first_confirmation ?? true)} name="requireDailyFirstConfirmation"><option value="true">首条成功后等待我确认</option><option value="false">不设每日确认闸门</option></select></label>
      <Field label={account ? "固定代理 URL（仅 fixed_proxy；留空保持原值）" : "固定代理 URL（仅 fixed_proxy）"} maxLength={2048} name="proxyUrl" placeholder="http://user:password@host:port" type="password" />
      <div className="grid grid-cols-[100px_1fr] gap-3"><Field defaultValue={proxy?.expected_country ?? "US"} label="国家" maxLength={2} name="expectedCountry" required /><Field defaultValue={proxy?.expected_region ?? ""} label="州/地区" maxLength={100} name="expectedRegion" placeholder="California" /></div>
    </div>
    <FormSubmitButton className="focus-ring mt-4 h-11 rounded-lg bg-accent px-5 font-black text-accent-ink disabled:opacity-50" idleLabel={submitLabel} />
  </form>;
}

function Field({ label, name, ...props }: { label: string; name: string } & React.InputHTMLAttributes<HTMLInputElement>) { return <label className="mt-3 block text-sm font-bold">{label}<input className="focus-ring mt-2 h-11 w-full rounded-lg border border-line bg-white px-3" name={name} {...props} /></label>; }
function Area({ label, name, ...props }: { label: string; name: string } & React.TextareaHTMLAttributes<HTMLTextAreaElement>) { return <label className="mt-3 block text-sm font-bold">{label}<textarea className="focus-ring mt-2 min-h-24 w-full rounded-lg border border-line bg-white p-3" maxLength={500} name={name} {...props} /></label>; }

function verificationLabel(status: XReplyAccount["verification_status"]) {
  return { unverified: "尚未验证", pending: "等待 Mac 打开", running: "正在通过绑定代理打开 X", passed: "账号与 IP 匹配", failed: "打开或验证失败" }[status];
}
