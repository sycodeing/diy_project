import type { DesignPayload } from "@/lib/types";

export function OrderProductSummary({
  design,
  fallbackName,
}: {
  design: DesignPayload;
  fallbackName: string;
}) {
  const snapshot = design.productSnapshot;
  const options = snapshot?.options ?? Object.fromEntries(
    Object.entries(design.selection).filter(([key]) => key !== "productSlug"),
  );

  return (
    <div>
      <h2 className="text-xl font-black text-foreground">
        {snapshot?.name ?? fallbackName}
      </h2>
      {snapshot?.category ? (
        <p className="mt-1 text-sm text-muted">{humanize(snapshot.category)}</p>
      ) : null}
      <div className="mt-3 flex flex-wrap gap-2">
        {Object.entries(options).map(([label, value]) => (
          <span
            className="rounded-full border border-line bg-surface px-3 py-1 text-xs font-semibold text-muted"
            key={label}
          >
            {humanize(label)}: {humanize(value)}
          </span>
        ))}
        {snapshot?.quantity ? (
          <span className="rounded-full border border-line bg-surface px-3 py-1 text-xs font-semibold text-muted">
            Qty: {snapshot.quantity}
          </span>
        ) : null}
      </div>
    </div>
  );
}

function humanize(value: string) {
  return value
    .replaceAll("_", " ")
    .replaceAll("-", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}
