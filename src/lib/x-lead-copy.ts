export type XLeadDraftContext = {
  occasion: string | null;
  occasionConfidence: number | null;
  petType?: "cat" | "dog" | null;
  targetingData: null | {
    matched_terms?: unknown;
    post_excerpt?: unknown;
    source?: unknown;
    [key: string]: unknown;
  };
};

export type XLeadCopyOccasion = "generic";
export const X_FIRST_CONTACT_VARIANT = "first_contact_v1" as const;

export function createXLeadFirstContactDraft(context: XLeadDraftContext) {
  const pet = context.petType === "cat" ? "cat" : context.petType === "dog" ? "dog" : "pet";
  return {
    variantKey: X_FIRST_CONTACT_VARIANT,
    contentMode: "first_contact_text" as const,
    text: `I make custom ${pet}-photo pillow covers. $19.99 shipped to the US, delivery in about 15 days. Cover only, no insert. Would you like to see a sample?`,
  };
}

// Text-only is an explicit job contract, never inferred from a missing image.
export function isValidXFirstContactText(text: string) {
  return text.trim().length > 0 && text.length <= 280
    && !/(?:https?:\/\/|www\.|\{link\})/i.test(text);
}
export type XLeadShortCopyVariant =
  | "short_direct_a_v1"
  | "short_direct_b_v1"
  | "guided_preview_a_v2";

export type XLeadCopyProfile = {
  accountKey: string;
  style: "warm" | "playful" | "concise";
  voice?: string;
  positioning?: string;
  variationNotes?: string;
  variationSeed: string;
};

export function getXLeadCopyOccasion(context: XLeadDraftContext): XLeadCopyOccasion {
  void context;
  return "generic";
}

export function getXLeadShortCopyVariant(seed: string): XLeadShortCopyVariant {
  return stableIndex(`${seed}:guided-preview-experiment-v2`, 2) === 0
    ? "short_direct_b_v1"
    : "guided_preview_a_v2";
}

export function createXLeadDrafts(
  context: XLeadDraftContext,
  link = "{link}",
  profile?: XLeadCopyProfile,
  assignedVariant?: XLeadShortCopyVariant,
) {
  const seed = profile
    ? [profile.accountKey, profile.style, profile.variationSeed, profile.voice, profile.positioning, profile.variationNotes].filter(Boolean).join(":")
    : contextSeed(context);
  const variant = assignedVariant ?? getXLeadShortCopyVariant(seed);
  const pet = context.petType === "cat" ? "cat" : context.petType === "dog" ? "dog" : "pet";
  const message = interpolate(SHORT_DIRECT_COPY[variant], pet);
  const directCopy = appendLinkWithinLimit(message, link, 220);

  return {
    consentCopy: directCopy,
    publicCopy: directCopy,
    directMessageCopy: directCopy,
    variantKey: variant,
  };
}

const SHORT_DIRECT_COPY: Record<XLeadShortCopyVariant, string> = {
  short_direct_a_v1: "That’s a great photo of your {pet}! I made a custom pet-pillow preview from it:",
  short_direct_b_v1: "I turned this {pet} photo into a personalized pillow preview. See how it looks:",
  guided_preview_a_v2: "I made a quick pillow preview from this {pet} photo. Open it to see the design with your photo already added:",
};

function contextSeed(context: XLeadDraftContext) {
  const excerpt = typeof context.targetingData?.post_excerpt === "string" ? context.targetingData.post_excerpt : "";
  const matchedTerms = Array.isArray(context.targetingData?.matched_terms)
    ? context.targetingData.matched_terms.filter((value): value is string => typeof value === "string").join("|")
    : "";
  return [context.petType, context.occasion, context.occasionConfidence, excerpt, matchedTerms].join(":") || "default";
}

function interpolate(template: string, pet: string) {
  return template.replaceAll("{pet}", pet);
}

function stableIndex(value: string, length: number) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) % length;
}

function appendLinkWithinLimit(copy: string, link: string, maxLength: number) {
  const suffix = ` ${link}`;
  return `${copy.slice(0, Math.max(0, maxLength - suffix.length)).trimEnd()}${suffix}`;
}
