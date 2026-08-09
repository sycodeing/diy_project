import {
  COLOR_OPTIONS,
  STYLE_OPTIONS,
  getOptionLabel,
} from "@/lib/product-config";
import type { DesignPayload, ProductSide } from "@/lib/types";
import { cn } from "@/lib/utils";

export function DesignSummary({
  design,
  imageUrls = {},
}: {
  design: DesignPayload;
  imageUrls?: Partial<Record<ProductSide, string>>;
}) {
  return (
    <div className="grid gap-3 text-sm sm:grid-cols-2">
      <div className="rounded-lg border border-line bg-black p-4">
        <p className="mb-3 font-black">Pillow blank</p>
        <dl className="space-y-2 text-muted">
          <div className="flex justify-between gap-4">
            <dt>Color</dt>
            <dd className="text-right text-foreground">
              {getOptionLabel(COLOR_OPTIONS, design.selection.color)}
            </dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt>Cover style</dt>
            <dd className="text-right text-foreground">
              {getOptionLabel(STYLE_OPTIONS, design.selection.style)}
            </dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt>Size</dt>
            <dd className="text-right text-foreground">{design.selection.size}</dd>
          </div>
        </dl>
      </div>
      {(["front", "back"] as const).map((side) => (
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
  return (
    <div className="rounded-lg border border-line bg-black p-4">
      <p className="mb-3 font-black capitalize">{side}</p>
      <div
        className={cn(
          "grid min-h-28 place-items-center overflow-hidden border border-line bg-foreground p-3 text-center font-black uppercase text-background",
          sideDesign.shape === "circle" ? "aspect-square rounded-full" : "rounded-lg",
        )}
      >
        {sideDesign.kind === "none" ? (
          <span>Blank</span>
        ) : sideDesign.kind === "image" ? (
          imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              alt={`${side} custom artwork`}
              className="h-full w-full object-cover"
              src={imageUrl}
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
