import type {
  DesignPayload,
  DesignPosition,
  DesignShape,
  ProductSelection,
} from "@/lib/types";

export const PRODUCT_SLUG = "custom-pillow" as const;
export const PRODUCT_PRICE_CENTS = 1999;
export const PRODUCT_CURRENCY = "usd";

export const COLOR_OPTIONS = [
  { value: "soft-mint", label: "Soft mint", hex: "#dbeec6" },
  { value: "warm-cream", label: "Warm cream", hex: "#f7f1de" },
  { value: "baby-blue", label: "Baby blue", hex: "#d8ecff" },
  { value: "blush-pink", label: "Blush pink", hex: "#f8d7dc" },
];

export const STYLE_OPTIONS = [
  { value: "soft-plush", label: "Soft plush cover" },
  { value: "smooth-peach", label: "Smooth peach skin" },
  { value: "linen-texture", label: "Linen texture cover" },
];

export const SIZE_OPTIONS = ["18in/45cm", "16in/40cm", "20in/50cm"];

export const SHAPE_OPTIONS: Array<{ value: DesignShape; label: string }> = [
  { value: "rectangle", label: "Rectangle" },
  { value: "circle", label: "Circle" },
];

export const POSITION_OPTIONS: Array<{
  value: DesignPosition;
  label: string;
  sides: Array<"front" | "back">;
}> = [
  { value: "center_panel", label: "Center panel", sides: ["front"] },
  { value: "top_banner", label: "Top banner", sides: ["front"] },
  { value: "bottom_caption", label: "Bottom caption", sides: ["front"] },
  { value: "full_panel", label: "Full panel", sides: ["front"] },
  { value: "reverse_center", label: "Reverse center", sides: ["back"] },
];

export const DEFAULT_SELECTION: ProductSelection = {
  productSlug: PRODUCT_SLUG,
  color: COLOR_OPTIONS[0].value,
  style: STYLE_OPTIONS[0].value,
  size: "18in/45cm",
};

export const DEFAULT_DESIGN: DesignPayload = {
  selection: DEFAULT_SELECTION,
  sides: {
    front: {
      kind: "text",
      text: "Dodo",
      shape: "rectangle",
      position: "top_banner",
    },
    back: {
      kind: "none",
      shape: "rectangle",
      position: "reverse_center",
    },
  },
};

export function getColorHex(color: string) {
  return COLOR_OPTIONS.find((option) => option.value === color)?.hex ?? "#dbeec6";
}

export function getOptionLabel(
  options: Array<{ value: string; label: string }>,
  value: string,
) {
  return options.find((option) => option.value === value)?.label ?? value;
}
