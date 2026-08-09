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

export type PaymentStatus =
  | "pending_payment"
  | "paid"
  | "failed"
  | "canceled";

export type FulfillmentStatus =
  | "awaiting_payment"
  | "production"
  | "packing"
  | "shipped";

export type TemuOrderStatus =
  | "NOT_SUBMITTED"
  | "UN_SHIPPING"
  | "CANCELED"
  | "SHIPPED"
  | "UNKNOWN";

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
  created_at: string;
  updated_at: string;
};
