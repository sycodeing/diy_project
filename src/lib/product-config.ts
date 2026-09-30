import type {
  DesignPayload,
  DesignPosition,
  DesignShape,
  ProductSelection,
} from "@/lib/types";

export const PRODUCT_SLUG = "custom-pillow" as const;
export const PRODUCT_PRICE_CENTS = 1999;
export const PRODUCT_CURRENCY = "usd";

type ProductArtworkFrame = {
  aspectRatio: number;
  label: string;
  outputHeight: number;
  outputWidth: number;
  shape: "circle" | "rectangle" | "square";
};

export const PRODUCT_ARTWORK_FRAME: ProductArtworkFrame = {
  shape: "square",
  aspectRatio: 1,
  outputWidth: 1200,
  outputHeight: 1200,
  label: "Square pillow artwork",
};

export const COLOR_OPTIONS = [
  { value: "standard-white", label: "Standard white", hex: "#f5f2ea" },
];

export const STYLE_OPTIONS = [
  { value: "polyester-cover", label: "Polyester pillow cover" },
];

export const SIZE_OPTIONS = ["18in/45cm"];

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
      kind: "image",
      imagePreviewUrl: "/debug/pillow-sample.png",
      shape: "rectangle",
      position: "full_panel",
    },
    back: {
      kind: "none",
      shape: "rectangle",
      position: "reverse_center",
    },
  },
};

export function getColorHex(color: string) {
  return COLOR_OPTIONS.find((option) => option.value === color)?.hex ?? "#f5f2ea";
}

export function getOptionLabel(
  options: Array<{ value: string; label: string }>,
  value: string,
) {
  return options.find((option) => option.value === value)?.label ?? value;
}
