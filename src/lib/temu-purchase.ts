import type {
  FulfillmentStatus,
  TemuPurchaseJobStatus,
} from "@/lib/types";

export const TEMU_PURCHASE_STATUS_LABELS: Record<
  TemuPurchaseJobStatus,
  string
> = {
  configuration_required: "需要补充配置",
  ready_for_payment: "待人工下单",
  in_progress: "正在下单",
  login_required: "需要登录买家账号",
  captcha_required: "需要处理验证码",
  payment_challenge: "需要支付验证",
  address_review_required: "需要核对地址",
  submit_uncertain: "提交结果不确定，请勿重试",
  temu_bound: "已绑定 Temu 订单",
  failed: "处理失败",
  canceled: "已取消",
};

export const ATTENTION_TEMU_PURCHASE_STATUSES: TemuPurchaseJobStatus[] = [
  "configuration_required",
  "login_required",
  "captcha_required",
  "payment_challenge",
  "address_review_required",
  "submit_uncertain",
  "failed",
];

export const INTERNAL_FULFILLMENT_LABELS: Record<FulfillmentStatus, string> = {
  awaiting_payment: "等待付款",
  ordered: "待人工下单",
  production: "Temu 已下单",
  packing: "商家备货中",
  shipped: "已发货",
};

const NEXT_FULFILLMENT_STATUS: Partial<
  Record<FulfillmentStatus, FulfillmentStatus>
> = {
  ordered: "production",
  production: "packing",
  packing: "shipped",
};

export function getNextFulfillmentStatus(status: FulfillmentStatus) {
  return NEXT_FULFILLMENT_STATUS[status] ?? null;
}
