import { AppShell } from "@/components/app-shell";
import { requireAdmin } from "@/lib/auth";
import { FIRST_ORDER_PROMOTION_KEY } from "@/lib/first-order-promotion";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { formatMoney } from "@/lib/utils";
import { setFirstOrderPromotionActive } from "./actions";

export const dynamic = "force-dynamic";

export default async function PromotionsPage() {
  await requireAdmin("/admin/promotions");
  const supabase = getSupabaseServiceClient();
  if (!supabase) throw new Error("Supabase 服务端配置缺失。");
  const { data: promotion, error } = await supabase
    .from("sales_promotions")
    .select("key,price_cents,currency,active,updated_at")
    .eq("key", FIRST_ORDER_PROMOTION_KEY)
    .maybeSingle();
  if (error || !promotion) throw new Error(error?.message ?? "首单活动不存在。");

  return (
    <AppShell admin>
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8 sm:px-6 sm:py-12">
        <h1 className="text-3xl font-black">首单活动</h1>
        <p className="mt-3 text-sm leading-6 text-muted">每个登录账号的首笔已付款订单可享活动价。结账时自动计算，无需优惠码。活动关闭后，新创建的订单恢复商品原价。</p>
        <section className="mt-8 rounded-2xl border border-line bg-panel p-5 shadow-sm sm:p-7">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-xs font-bold uppercase tracking-wide text-muted">全店首单活动</p>
              <h2 className="mt-2 text-xl font-black">首单价 {formatMoney(promotion.price_cents, promotion.currency)}</h2>
              <p className="mt-2 text-sm text-muted">当前状态：{promotion.active ? "执行中" : "已暂停"}</p>
            </div>
            <form action={setFirstOrderPromotionActive}>
              <input name="active" type="hidden" value={promotion.active ? "false" : "true"} />
              <button className="focus-ring min-h-11 rounded-lg bg-accent px-5 font-bold text-accent-ink hover:bg-accent-strong" type="submit">
                {promotion.active ? "暂停活动" : "启动活动"}
              </button>
            </form>
          </div>
          <p className="mt-5 border-t border-line pt-4 text-xs text-muted">资格按登录账号的已付款订单判断。订单创建时确认金额；已创建的付款页面不会因暂停活动而改价。</p>
        </section>
      </main>
    </AppShell>
  );
}
