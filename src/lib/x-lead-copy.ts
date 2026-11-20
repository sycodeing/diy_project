import { X_OUTREACH_GROUPS, type XOutreachGroupKey } from "@/lib/x-outreach-groups";

export type XLeadDraftContext = {
  occasion: string | null;
  occasionConfidence: number | null;
  petType?: "cat" | "dog" | null;
  firstOrderOffer?: boolean;
  targetingData: null | {
    matched_terms?: unknown;
    post_excerpt?: unknown;
    source?: unknown;
    [key: string]: unknown;
  };
};

export type XLeadCopyOccasion = "generic";
export const X_FIRST_CONTACT_VARIANT = "first_contact_v3" as const;

export function canAdvertiseFirstOrder25(
  promotion: { priceCents: number; currency: string } | null,
  variants: Array<{ price_cents: number; currency: string }>,
) {
  return !!promotion && promotion.priceCents > 0 && variants.length > 0 && variants.every((variant) =>
    variant.currency.toLowerCase() === promotion.currency.toLowerCase()
    && promotion.priceCents <= Math.floor(variant.price_cents * 0.75));
}

export function createXLeadFirstContactDraft(context: XLeadDraftContext) {
  const pet = context.petType === "cat" ? "cat" : context.petType === "dog" ? "dog" : "pet";
  const offer = context.firstOrderOffer ? " Your first order is 25% off." : "";
  const intent = context.targetingData?.purchase_intent;
  if (intent && typeof intent === "object" && !Array.isArray(intent)) {
    const signal = intent as Record<string, unknown>;
    if (signal.persona === "pet_owner") {
      return { variantKey: "life_pet_owner_v1" as const, contentMode: "first_contact_text" as const,
        text: `I saw your pet story. I make personalized photo pillow covers and can share an example from my own work if that feels relevant.${offer}` };
    }
    if (signal.persona === "home_decorator") {
      return { variantKey: "life_home_v1" as const, contentMode: "first_contact_text" as const,
        text: `I saw your room setup. I make custom photo pillow covers and can share an example from my own work if that fits your space.${offer}` };
    }
    if (signal.persona === "relationship_memory") {
      return { variantKey: "life_memory_v1" as const, contentMode: "first_contact_text" as const,
        text: `I saw the memory you shared. I make personalized photo pillow covers and can share an example from my own work if a keepsake feels relevant.${offer}` };
    }
    if (signal.persona === "gift_giver") {
      return { variantKey: "consumer_gift_v1" as const, contentMode: "first_contact_text" as const,
        text: `I saw you're planning a gift. I make custom photo pillow covers and can share an example from my own work.${offer} Would that fit your idea?` };
    }
    if (signal.persona === "identity_consumer") {
      return { variantKey: "consumer_identity_v1" as const, contentMode: "first_contact_text" as const,
        text: `I make custom photo pillow covers for personal collections and spaces.${offer} I can share an example from my own work if that sounds relevant.` };
    }
    if (signal.persona === "group_organizer") {
      return { variantKey: "consumer_group_v1" as const, contentMode: "first_contact_text" as const,
        text: `I saw you're planning a group occasion. I make custom photo pillow covers and can share an example from my own work.${offer} Would you like to see one?` };
    }
    if (signal.tier === "exploratory" && signal.scene === "gift") {
      return {
        variantKey: "first_contact_gift_v3" as const,
        contentMode: "first_contact_text" as const,
        text: `If you're choosing a gift for a pet lover, I make pillow covers from their pet's photo.${offer} Would you like to see an example?`,
      };
    }
    if (signal.tier === "explicit_request" && typeof signal.parent_post_id === "string") {
      return {
        variantKey: "first_contact_discussion_v3" as const,
        contentMode: "first_contact_text" as const,
        text: `I'm another maker, not the seller in this thread. I make custom pet-photo pillow covers.${offer} If that fits what you're looking for, would you like an example?`,
      };
    }
    if (signal.tier === "exploratory" && signal.scene === "decor") {
      return {
        variantKey: "first_contact_decor_v3" as const,
        contentMode: "first_contact_text" as const,
        text: `If you'd like to display a ${pet} photo at home, I make custom photo pillow covers.${offer} Would you like to see an example?`,
      };
    }
    if (signal.tier === "exploratory" && signal.scene === "custom") {
      return {
        variantKey: "first_contact_decor_v3" as const,
        contentMode: "first_contact_text" as const,
        text: `If you're considering something personal with a ${pet} photo, I make custom photo pillow covers.${offer} Would you like to see an example?`,
      };
    }
  }
  return {
    variantKey: X_FIRST_CONTACT_VARIANT,
    contentMode: "first_contact_text" as const,
    text: `I make custom ${pet}-photo pillow covers. Cover only, no insert.${offer} Would you like to see a sample?`,
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
  | "guided_preview_a_v2"
  | "short_direct_b_v3"
  | "guided_preview_a_v3";

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
    ? "short_direct_b_v3"
    : "guided_preview_a_v3";
}

export function createXLeadDrafts(
  context: XLeadDraftContext,
  link = "{link}",
  profile?: XLeadCopyProfile,
  assignedVariant?: XLeadShortCopyVariant,
  group: XOutreachGroupKey = "general",
) {
  const seed = profile
    ? [profile.accountKey, profile.style, profile.variationSeed, profile.voice, profile.positioning, profile.variationNotes].filter(Boolean).join(":")
    : contextSeed(context);
  const variant = assignedVariant ?? getXLeadShortCopyVariant(seed);
  const pet = context.petType === "cat" ? "cat" : context.petType === "dog" ? "dog" : "pet";
  const baseVariant = variant === "short_direct_b_v3" ? "short_direct_b_v1"
    : variant === "guided_preview_a_v3" ? "guided_preview_a_v2" : variant;
  const template = baseVariant === "short_direct_a_v1"
    ? SHORT_DIRECT_COPY[baseVariant]
    : X_OUTREACH_GROUPS[group].copy[baseVariant];
  const offer = context.firstOrderOffer ? "25% off your first order. " : "";
  const message = offer + interpolate(template, pet);
  const directCopy = appendLinkWithinLimit(message, link, 220);

  return {
    consentCopy: directCopy,
    publicCopy: directCopy,
    directMessageCopy: directCopy,
    variantKey: variant,
  };
}

const SHORT_DIRECT_COPY = {
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
