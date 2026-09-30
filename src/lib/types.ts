export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type ProductSide = "front" | "back";
export type DesignKind = "none" | "text" | "image";
export type DesignShape = "circle" | "rectangle";
export type DesignPosition =
  | "center_panel"
  | "top_banner"
  | "bottom_caption"
  | "full_panel"
  | "reverse_center";

export type DesignSide = {
  kind: DesignKind;
  text?: string;
  imagePath?: string;
  imagePreviewUrl?: string;
  shape: DesignShape;
  position: DesignPosition;
};

export type ProductSelection = {
  productSlug: "custom-pillow";
  color: string;
  style: string;
  size: string;
};

export type DesignPayload = {
  selection: ProductSelection;
  sides: Record<ProductSide, DesignSide>;
};

export type ShippingAddress = {
  fullName: string;
  line1: string;
  line2?: string;
  city: string;
  region: string;
  postalCode: string;
  country: string;
  phone?: string;
};

export type PaymentStatus =
  | "pending_payment"
  | "paid"
  | "failed"
  | "canceled";

export type FulfillmentStatus =
  | "awaiting_payment"
  | "ordered"
  | "production"
  | "packing"
  | "shipped";

export type TemuOrderStatus =
  | "NOT_SUBMITTED"
  | "UN_SHIPPING"
  | "CANCELED"
  | "SHIPPED"
  | "UNKNOWN";

export type TemuPurchaseJobStatus =
  | "configuration_required"
  | "ready_for_payment"
  | "in_progress"
  | "login_required"
  | "captcha_required"
  | "payment_challenge"
  | "address_review_required"
  | "submit_uncertain"
  | "temu_bound"
  | "failed"
  | "canceled";

export type TemuPurchaseJob = {
  id: string;
  order_id: string;
  status: TemuPurchaseJobStatus;
  product_url: string | null;
  goods_id: string | null;
  sku_id: string | null;
  quantity: number;
  expected_amount_cents: number | null;
  currency: string;
  address_snapshot: ShippingAddress;
  address_fingerprint: string;
  idempotency_key: string;
  worker_id: string | null;
  attempt_count: number;
  claimed_at: string | null;
  submitted_at: string | null;
  verified_at: string | null;
  temu_parent_order_sn: string | null;
  temu_order_sn: string | null;
  last_error_code: string | null;
  last_error_message: string | null;
  created_at: string;
  updated_at: string;
};

export type OrderSummary = {
  id: string;
  order_number: string;
  amount_cents: number;
  currency: string;
  customer_email: string | null;
  payment_status: PaymentStatus;
  fulfillment_status: FulfillmentStatus;
  sales_channel: "direct" | "temu";
  temu_parent_order_sn: string | null;
  temu_order_sn: string | null;
  temu_status: TemuOrderStatus;
  temu_status_label: string | null;
  temu_last_synced_at: string | null;
  temu_raw: Json | null;
  design_snapshot: DesignPayload;
  shipping: Json | null;
  paid_at?: string | null;
  created_at: string;
  updated_at: string;
};
