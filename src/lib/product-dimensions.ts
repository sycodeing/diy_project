const CM_PER_INCH = 2.54;

export function buildProductSize(lengthCm: number, widthCm: number) {
  const normalizedLengthCm = round(lengthCm);
  const normalizedWidthCm = round(widthCm);
  const lengthIn = round(normalizedLengthCm / CM_PER_INCH);
  const widthIn = round(normalizedWidthCm / CM_PER_INCH);

  return {
    label: `${format(normalizedLengthCm)} × ${format(normalizedWidthCm)} cm / ${format(lengthIn)} × ${format(widthIn)} in`,
    metadata: {
      lengthCm: normalizedLengthCm,
      widthCm: normalizedWidthCm,
      lengthIn,
      widthIn,
    },
  };
}

function round(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function format(value: number) {
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 2,
    useGrouping: false,
  }).format(value);
}
