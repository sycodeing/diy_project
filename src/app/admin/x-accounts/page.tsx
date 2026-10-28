import { AlertTriangle, CheckCircle2, KeyRound, Monitor, Network, Pencil, Plus } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { FormSubmitButton } from "@/components/form-submit-button";
import { SetupWarning } from "@/components/setup-warning";
import { requireAdmin } from "@/lib/auth";
import { getXReplyWorkerSecret } from "@/lib/env";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { cn, formatDate } from "@/lib/utils";
import { decryptProxyUrl, maskProxyUrl } from "@/lib/x-proxy-crypto";
import type { XReplyAccount, XReplyAccountProxy } from "@/lib/x-reply";
import { createXAccount, deleteXAccount, updateXAccount } from "./actions";

export const dynamic = "force-dynamic";

const notices: Record<string, string> = {
  created: "账号与独立代理已保存；首次发送前本机 Worker 会验证真实出口 IP。",
  updated: "账号配置已更新；如更换代理，状态已重置为待验证。",
  deleted: "未产生发送历史的账号已删除。",
  "in-use": "该账号已有发送历史，为保留审计记录不能删除；可以将它停用。",
};

export default async function XAccountsPage({ searchParams }: { searchParams: Promise<{ notice?: string }> }) {
  await requireAdmin("/admin/x-accounts");
  const supabase = getSupabaseServiceClient();
  if (!supabase) return <AppShell admin><main className="mx-auto w-full max-w-3xl px-4 py-10"><SetupWarning /></main></AppShell>;
  const filters = await searchParams;
  const [{ data: accountRows, error: accountsError }, { data: proxyRows, error: proxiesError }] = await Promise.all([
    supabase.from("x_reply_accounts").select("*").order("created_at", { ascending: true }),
    supabase.from("x_reply_account_proxies").select("account_id,encrypted_url,display_host,expected_country,expected_region,status,egress_ip,last_tested_at,last_error,updated_at"),
  ]);
  const accounts = (accountRows ?? []) as XReplyAccount[];
  const proxies = new Map(((proxyRows ?? []) as XReplyAccountProxy[]).map((proxy) => [proxy.account_id, proxy]));
  const secret = getXReplyWorkerSecret();
  const notice = filters.notice ? notices[filters.notice] : null;

  return (
    <AppShell admin>
      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-8 sm:px-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div><p className="text-xs font-black uppercase tracking-[0.18em] text-accent-strong">Account routing</p><h1 className="mt-1 text-4xl font-black">X 账号、比特窗口与独立 IP</h1><p className="mt-2 max-w-3xl text-sm leading-6 text-muted">每个账号绑定一个比特浏览器窗口和一个固定代理。代理密码经应用层加密保存，不会回显到浏览器。</p></div>
          <div className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm font-bold text-blue-950"><KeyRound className="mr-2 inline" size={17} />一账号一代理 · 失败禁止直连</div>
        </div>
        {notice ? <p className="mt-5 rounded-lg border border-line bg-panel p-3 text-sm font-bold">{notice}</p> : null}
        {accountsError || proxiesError ? <p className="mt-5 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">{accountsError?.message ?? proxiesError?.message}</p> : null}
        {!secret ? <p className="mt-5 rounded-lg border border-red-200 bg-red-50 p-4 text-sm font-bold text-red-900"><AlertTriangle className="mr-2 inline" size={17} />缺少 X_REPLY_WORKER_SECRET，代理不能加密、解密或下发。</p> : null}

        <section className="mt-6 rounded-xl border border-line bg-panel/90 p-5">
          <div className="flex items-center gap-3"><span className="rounded-lg bg-accent-soft p-2 text-accent-strong"><Plus size={20} /></span><div><h2 className="text-xl font-black">新增账号</h2><p className="text-xs text-muted">先在比特浏览器创建并登录 X 窗口，再把窗口 ID 绑定到账号。</p></div></div>
          <AccountForm action={createXAccount} submitLabel="新增账号并保存代理" />
        </section>

        <section className="mt-8">
          <h2 className="text-2xl font-black">现有账号</h2>
          <div className="mt-4 grid gap-5 xl:grid-cols-2">
            {accounts.map((account) => {
              const proxy = proxies.get(account.id);
              let maskedProxy = proxy ? `${proxy.display_host}（密文无法读取）` : "未配置";
              if (proxy && secret) {
                try { maskedProxy = maskProxyUrl(decryptProxyUrl(proxy.encrypted_url, secret)); } catch { /* Render a safe diagnostic only. */ }
              }
              return <article className="rounded-xl border border-line bg-panel/90 p-5" key={account.id}>
                <div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="text-xl font-black">{account.display_name}</h3><p className="font-mono text-xs text-muted">{account.account_key}</p></div><ProxyBadge proxy={proxy} /></div>
                <div className="mt-4 rounded-lg border border-line bg-white p-3 text-xs leading-6 text-muted"><p><Network className="mr-1 inline" size={14} /><strong className="text-foreground">{maskedProxy}</strong></p><p>期望地区：{proxy ? `${proxy.expected_country}${proxy.expected_region ? ` · ${proxy.expected_region}` : ""}` : "—"}</p><p>最近出口：{proxy?.egress_ip ?? "尚未验证"}{proxy?.last_tested_at ? ` · ${formatDate(proxy.last_tested_at)}` : ""}</p>{proxy?.last_error ? <p className="text-red-700">{proxy.last_error}</p> : null}</div>
                <div className="mt-3 rounded-lg border border-line bg-white p-3 text-xs leading-6 text-muted"><p><Monitor className="mr-1 inline" size={14} /><strong className="text-foreground">{account.bitbrowser_window_name || "未命名窗口"}</strong></p><p className="break-all">窗口 ID：{account.bitbrowser_window_id ?? "未绑定"}</p><p>{account.require_daily_first_confirmation ? "每日首条成功后等待后台确认" : "每日首条后自动继续"}</p></div>
                <details className="mt-4"><summary className="focus-ring cursor-pointer rounded-lg border border-line px-4 py-3 text-sm font-black"><Pencil className="mr-2 inline" size={15} />编辑账号与代理</summary><AccountForm account={account} action={updateXAccount} proxy={proxy} submitLabel="保存修改" /></details>
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

function ProxyBadge({ proxy }: { proxy?: XReplyAccountProxy }) {
  const status = proxy?.status ?? "unconfigured";
  const healthy = status === "healthy";
  const label = status === "healthy" ? "代理健康" : status === "pending" ? "待本机验证" : status === "error" ? "代理异常" : "未配置代理";
  return <span className={cn("rounded-md border px-2.5 py-1 text-xs font-black", healthy ? "border-emerald-200 bg-emerald-50 text-emerald-800" : status === "error" ? "border-red-200 bg-red-50 text-red-800" : "border-amber-200 bg-amber-50 text-amber-900")}>{healthy ? <CheckCircle2 className="mr-1 inline" size={13} /> : <AlertTriangle className="mr-1 inline" size={13} />}{label}</span>;
}

function AccountForm({ account, proxy, action, submitLabel }: { account?: XReplyAccount; proxy?: XReplyAccountProxy; action: (formData: FormData) => Promise<void>; submitLabel: string }) {
  return <form action={action} className="mt-4">{account ? <input name="accountId" type="hidden" value={account.id} /> : null}
    <div className="grid gap-x-4 sm:grid-cols-2">
      <Field defaultValue={account?.account_key} label="x-use 账号标识" name="accountKey" placeholder="pet_new_home" required />
      <Field defaultValue={account?.display_name} label="后台显示名" name="displayName" placeholder="新宠到家号" required />
      <Area defaultValue={account?.positioning} label="账号定位" name="positioning" placeholder="专注记录新领养宠物与到家纪念" required />
      <Area defaultValue={account?.audience} label="目标受众" name="audience" placeholder="美国新领养狗或猫的主人" required />
      <Area defaultValue={account?.voice} label="表达语气" name="voice" placeholder="温暖、具体、不强推销" required />
      <Area defaultValue={account?.prohibited_topics} label="禁止话题" name="prohibitedTopics" placeholder="医疗建议、争议事件、未成年人" />
      <Field defaultValue={account?.topics.join(", ")} label="常用话题（逗号分隔）" name="topics" placeholder="new adoption, gotcha day" />
      <Field defaultValue={account?.daily_limit ?? 5} label="每日批准上限" max="20" min="1" name="dailyLimit" required type="number" />
      <label className="mt-3 block text-sm font-bold">文案风格<select className="focus-ring mt-2 h-11 w-full rounded-lg border border-line bg-white px-3" defaultValue={account?.copy_style ?? "warm"} name="copyStyle"><option value="warm">温暖细腻</option><option value="playful">活泼俏皮</option><option value="concise">简洁直接</option></select></label>
      <label className="mt-3 block text-sm font-bold">账号状态<select className="focus-ring mt-2 h-11 w-full rounded-lg border border-line bg-white px-3" defaultValue={String(account?.active ?? true)} name="active"><option value="true">启用</option><option value="false">停用</option></select></label>
      <Area defaultValue={account?.copy_variation_notes} label="文案差异备注" name="copyVariationNotes" placeholder="例如：少用感叹号，强调纪念意义。用于稳定选择该账号的文案变体。" />
      <Field defaultValue={account?.bitbrowser_window_id ?? ""} label="比特浏览器窗口 ID" maxLength={120} name="bitbrowserWindowId" placeholder="从比特浏览器窗口详情复制 ID" required />
      <Field defaultValue={account?.bitbrowser_window_name ?? ""} label="比特窗口备注名" maxLength={120} name="bitbrowserWindowName" placeholder="例如：X-新宠到家-US-01" />
      <label className="mt-3 block text-sm font-bold">每日首条监督<select className="focus-ring mt-2 h-11 w-full rounded-lg border border-line bg-white px-3" defaultValue={String(account?.require_daily_first_confirmation ?? true)} name="requireDailyFirstConfirmation"><option value="true">首条成功后等待我确认</option><option value="false">不设每日确认闸门</option></select></label>
      <Field label={account ? "替换固定代理（留空保持原值）" : "固定代理 URL"} maxLength={2048} name="proxyUrl" placeholder="http://user:password@host:port" required={!account || !proxy} type="password" />
      <div className="grid grid-cols-[100px_1fr] gap-3"><Field defaultValue={proxy?.expected_country ?? "US"} label="国家" maxLength={2} name="expectedCountry" required /><Field defaultValue={proxy?.expected_region ?? ""} label="州/地区" maxLength={100} name="expectedRegion" placeholder="California" /></div>
    </div>
    <FormSubmitButton className="focus-ring mt-4 h-11 rounded-lg bg-accent px-5 font-black text-accent-ink disabled:opacity-50" disabled={!getXReplyWorkerSecret()} idleLabel={submitLabel} />
  </form>;
}

function Field({ label, name, ...props }: { label: string; name: string } & React.InputHTMLAttributes<HTMLInputElement>) { return <label className="mt-3 block text-sm font-bold">{label}<input className="focus-ring mt-2 h-11 w-full rounded-lg border border-line bg-white px-3" name={name} {...props} /></label>; }
function Area({ label, name, ...props }: { label: string; name: string } & React.TextareaHTMLAttributes<HTMLTextAreaElement>) { return <label className="mt-3 block text-sm font-bold">{label}<textarea className="focus-ring mt-2 min-h-24 w-full rounded-lg border border-line bg-white p-3" maxLength={500} name={name} {...props} /></label>; }
