import { z } from "zod";
import {
  COLOR_OPTIONS,
  POSITION_OPTIONS,
  PRODUCT_SLUG,
  SHAPE_OPTIONS,
  SIZE_OPTIONS,
  STYLE_OPTIONS,
} from "@/lib/product-config";
import { TEMU_STATUS_OPTIONS } from "@/lib/temu";

const colors: string[] = COLOR_OPTIONS.map((item) => item.value);
const styles: string[] = STYLE_OPTIONS.map((item) => item.value);
const sizes: string[] = [...SIZE_OPTIONS];
const shapes: string[] = SHAPE_OPTIONS.map((item) => item.value);
const positions: string[] = POSITION_OPTIONS.map((item) => item.value);
const temuStatuses: string[] = TEMU_STATUS_OPTIONS.map((item) => item.value);

export const designSideSchema = z.object({
  kind: z.enum(["none", "text", "image"]),
  text: z.string().max(32).optional(),
  imagePath: z.string().max(500).optional(),
  shape: z.string().refine((value) => shapes.includes(value)),
  position: z.string().refine((value) => positions.includes(value)),
});

export const checkoutSchema = z.object({
  selection: z.object({
    productSlug: z.literal(PRODUCT_SLUG),
    color: z.string().refine((value) => colors.includes(value)),
    style: z.string().refine((value) => styles.includes(value)),
    size: z.string().refine((value) => sizes.includes(value)),
  }),
  sides: z.object({
    front: designSideSchema,
    back: designSideSchema,
  }),
});

export const shippingAddressSchema = z.object({
  fullName: z.string().trim().min(2).max(120),
  line1: z.string().trim().min(3).max(180),
  line2: z.string().trim().max(180).optional(),
  city: z.string().trim().min(1).max(120),
  region: z.string().trim().min(1).max(120),
  postalCode: z.string().trim().min(2).max(32),
  country: z.string().trim().length(2).transform((value) => value.toUpperCase()),
  phone: z.string().trim().min(6).max(40),
});

export const checkoutRequestSchema = z.object({
  design: checkoutSchema,
  shipping: shippingAddressSchema,
});

export const adminStatusSchema = z.enum([
  "ordered",
  "production",
  "packing",
  "shipped",
]);

export const temuStatusSchema = z
  .string()
  .refine((value) => temuStatuses.includes(value));

export const temuOrderImportSchema = z.object({
  parentOrderSn: z.string().min(1).max(120),
  orderSn: z.string().max(120).optional(),
  status: z.union([z.string(), z.number()]).optional(),
  customerEmail: z.string().email().optional(),
  localOrderId: z.string().uuid().optional(),
  shipping: z.record(z.string(), z.unknown()).optional(),
  raw: z.record(z.string(), z.unknown()).optional(),
});

export const temuOrderImportListSchema = z.object({
  orders: z.array(temuOrderImportSchema).min(1).max(100),
});
