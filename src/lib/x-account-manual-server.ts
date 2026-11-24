import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { MANUAL_SENDER_ID, manualSenderMatches } from "./x-account-manual";
import { manualRouteRevision } from "./x-account-manual-route";

export function manualDb() {
  const db = getSupabaseServiceClient();
  if (!db) throw new Error("数据库连接不可用。");
  return db;
}

/** Always load the fixed sender from trusted storage; never accept a browser-supplied route. */
export async function loadManualRoute() {
  const { data: sender, error } = await manualDb().from("x_reply_accounts")
    .select("id,account_key,display_name,active,network_mode,expected_x_handle,x_reply_account_proxies(encrypted_url,egress_ip,status)")
    .eq("id", MANUAL_SENDER_ID).maybeSingle();
  if (error || !sender || !manualSenderMatches(sender)
    || String(sender.expected_x_handle ?? "").replace(/^@/, "").toLowerCase() !== sender.account_key.toLowerCase())
    throw new Error("固定手动账号不可用；不会回退到 Latte 或其他账号。");
  const proxy = Array.isArray(sender.x_reply_account_proxies) ? sender.x_reply_account_proxies[0] : sender.x_reply_account_proxies;
  if (!proxy?.encrypted_url || !proxy.egress_ip || proxy.status !== "healthy") throw new Error("固定手动账号的绑定代理尚未就绪。");
  const expectedIp = String(proxy.egress_ip).replace(/\/\d+$/, "");
  return { sender, encryptedProxy: proxy.encrypted_url as string, expectedIp,
    revision: manualRouteRevision(sender.id, proxy.encrypted_url, expectedIp) };
}
