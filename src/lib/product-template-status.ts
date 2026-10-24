export function isProductTemplateReady(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const customization = value as Record<string, unknown>;

  if (customization.templateStatus === "pending") return false;
  if (customization.templateStatus === "ready") return true;

  // Products created before the two-step PSD workflow are already configured.
  return typeof customization.previewMode === "string";
}

export function isProductCustomerCopyReady(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const customization = value as Record<string, unknown>;

  if (customization.customerCopyStatus === "pending") return false;
  if (customization.customerCopyStatus === "ready") return true;

  // Products created before multilingual intake already have live storefront copy.
  return customization.templateStatus !== "pending";
}

export function containsChineseText(value: string | null | undefined) {
  return Boolean(value && /\p{Script=Han}/u.test(value));
}
