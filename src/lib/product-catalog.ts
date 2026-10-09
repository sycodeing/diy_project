import { PRODUCT_PRICE_CENTS, PRODUCT_SLUG } from "@/lib/product-config";

/** Customer-facing catalog: only products marked available can enter checkout. */
export const PRODUCT_CATALOG = [
  {
    slug: PRODUCT_SLUG,
    name: "Custom pillow cover set",
    description: "Add your photo, preview the design, and order a set of two.",
    image: "/showcase/wood-chair.webp",
    priceCents: PRODUCT_PRICE_CENTS,
    available: true,
    href: "/design",
  },
] as const;
