type ProductDescriptionInput = {
  productName?: string | null;
  category?: string | null;
  styleLabel?: string | null;
  sizeLabel?: string | null;
  printSides?: string[];
};

export function generateProductDescription({
  productName,
  category,
  styleLabel,
  sizeLabel,
  printSides = ["front"],
}: ProductDescriptionInput) {
  const name = clean(productName) || clean(category) || "custom product";
  const details = [clean(sizeLabel), clean(styleLabel)].filter(Boolean);
  const sideCopy = printSides.includes("back")
    ? "Add your favorite photos to the front and back"
    : "Add your favorite photo to the front";
  const detailCopy = details.length ? ` Available in ${details.join(" with ")}.` : "";

  return `${sideCopy} of this ${name}.${detailCopy} Review your design in the online preview before ordering.`;
}

function clean(value?: string | null) {
  return value?.trim().replace(/\s+/g, " ") ?? "";
}
