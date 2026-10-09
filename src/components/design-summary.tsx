import type { DesignPayload, ProductSide } from "@/lib/types";
import { cn } from "@/lib/utils";

export function DesignSummary({
  design,
  imageUrls = {},
}: {
  design: DesignPayload;
  imageUrls?: Partial<Record<ProductSide, string>>;
}) {
  const sides: ProductSide[] =
    design.selection.productSlug === "custom-pillow"
      ? ["front"]
      : ["front", "back"];

  return (
    <div className="grid gap-3 text-sm sm:grid-cols-2">
      {sides.map((side) => (
        <SideSummary
          imageUrl={imageUrls[side]}
          key={side}
          side={side}
          sideDesign={design.sides[side]}
        />
      ))}
    </div>
  );
}

function SideSummary({
  imageUrl,
  side,
  sideDesign,
}: {
  imageUrl?: string;
  side: ProductSide;
  sideDesign: DesignPayload["sides"][ProductSide];
}) {
  const previewUrl = imageUrl ?? sideDesign.imagePreviewUrl;

  return (
    <div className="rounded-lg border border-line bg-panel p-4">
      <p className="mb-3 font-black capitalize">{side}</p>
      <div
        className={cn(
          "grid aspect-square w-full max-w-64 place-items-center overflow-hidden border border-line bg-surface p-3 text-center font-black uppercase text-foreground",
          sideDesign.shape === "circle" ? "aspect-square rounded-full" : "rounded-lg",
        )}
      >
        {sideDesign.kind === "none" ? (
          <span>Blank</span>
        ) : sideDesign.kind === "image" ? (
          previewUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              alt={`${side} custom artwork`}
              className="h-full w-full object-contain"
              src={previewUrl}
            />
          ) : (
            <span>Image</span>
          )
        ) : (
          <span>{sideDesign.text}</span>
        )}
      </div>
      <p className="mt-3 text-xs text-muted">
        {sideDesign.kind}, {sideDesign.shape},{" "}
        {sideDesign.position.replaceAll("_", " ")}
      </p>
    </div>
  );
}
