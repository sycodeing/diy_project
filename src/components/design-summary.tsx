import type { DesignPayload, ProductSide } from "@/lib/types";
import { cn } from "@/lib/utils";

export function DesignSummary({
  chinese = false,
  design,
  imageUrls = {},
}: {
  chinese?: boolean;
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
          chinese={chinese}
          key={side}
          side={side}
          sideDesign={design.sides[side]}
        />
      ))}
    </div>
  );
}

function SideSummary({
  chinese,
  imageUrl,
  side,
  sideDesign,
}: {
  chinese: boolean;
  imageUrl?: string;
  side: ProductSide;
  sideDesign: DesignPayload["sides"][ProductSide];
}) {
  const previewUrl = imageUrl ?? sideDesign.imagePreviewUrl;

  return (
    <div className="rounded-lg border border-line bg-panel p-4">
      <p className="mb-3 font-black capitalize">{chinese ? (side === "front" ? "正面" : "背面") : side}</p>
      <div
        className={cn(
          "grid aspect-square w-full max-w-64 place-items-center overflow-hidden border border-line bg-surface p-3 text-center font-black uppercase text-foreground",
          sideDesign.shape === "circle" ? "aspect-square rounded-full" : "rounded-lg",
        )}
      >
        {sideDesign.kind === "none" ? (
          <span>{chinese ? "无图案" : "Blank"}</span>
        ) : sideDesign.kind === "image" ? (
          previewUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              alt={chinese ? `${side === "front" ? "正面" : "背面"}定制图` : `${side} custom artwork`}
              className="h-full w-full object-contain"
              src={previewUrl}
            />
          ) : (
            <span>{chinese ? "图片" : "Image"}</span>
          )
        ) : (
          <span>{sideDesign.text}</span>
        )}
      </div>
      <p className="mt-3 text-xs text-muted">
        {chinese ? designDetailLabel(sideDesign.kind, sideDesign.shape, sideDesign.position) : `${sideDesign.kind}, ${sideDesign.shape}, ${sideDesign.position.replaceAll("_", " ")}`}
      </p>
    </div>
  );
}

function designDetailLabel(kind: string, shape: string, position: string) {
  const kindLabel = { none: "无图案", image: "图片", text: "文字" }[kind] ?? kind;
  const shapeLabel = { rectangle: "矩形", circle: "圆形" }[shape] ?? shape;
  const positionLabel = { center: "居中", full_panel: "铺满画布" }[position] ?? position;
  return `${kindLabel}，${shapeLabel}，${positionLabel}`;
}
