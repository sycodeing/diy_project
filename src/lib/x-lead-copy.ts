export type XLeadDraftContext = {
  occasion: string | null;
  occasionConfidence: number | null;
  targetingData: null | {
    matched_terms?: unknown;
    post_excerpt?: unknown;
    source?: unknown;
    [key: string]: unknown;
  };
};

export type XLeadCopyOccasion = "birthday" | "adoption" | "generic";

const BIRTHDAY_EVIDENCE = /\b(?:birthday|barkday|birth day|turns?\s+\d+|turned\s+\d+)\b/i;
const ADOPTION_EVIDENCE = /\b(?:gotcha day|adoption anniversary|adopted|welcome home|foster fail|new family member)\b/i;

export function getXLeadCopyOccasion(context: XLeadDraftContext): XLeadCopyOccasion {
  if ((context.occasionConfidence ?? 0) < 70) return "generic";
  const evidence = getDraftEvidence(context.targetingData);
  if (context.occasion === "pet_birthday" && BIRTHDAY_EVIDENCE.test(evidence)) return "birthday";
  if (context.occasion === "new_adoption" && ADOPTION_EVIDENCE.test(evidence)) return "adoption";
  return "generic";
}

export function createXLeadDrafts(context: XLeadDraftContext, link = "{link}") {
  const occasion = getXLeadCopyOccasion(context);
  const copy = occasion === "birthday"
    ? {
        opening: "Happy birthday to your little star!",
        keepsake: "birthday keepsake",
        offer: "I made a custom pet pillow preview from this photo—a birthday keepsake with their own face. View it, change the photo, or order yours:",
      }
    : occasion === "adoption"
      ? {
          opening: "Your new family member already looks right at home!",
          keepsake: "new-home keepsake",
          offer: "I made a custom pet pillow preview from this photo—a made-to-order keepsake with their own face. View it, change the photo, or order yours:",
        }
      : {
          opening: "Your pet is absolutely adorable—this photo really made me smile!",
          keepsake: "custom keepsake",
          offer: "I made a custom pet pillow preview from this photo—a made-to-order keepsake with their own face. View it, change the photo, or order yours:",
        };

  return {
    consentCopy: `${copy.opening} Would you be comfortable if I turned this photo into a private custom pet-pillow preview? No reposting or purchase required.`,
    publicCopy: appendLinkWithinLimit(`${copy.opening} ${copy.offer}`, link, 270),
    directMessageCopy: `Hi! ${copy.opening} I made a custom pet pillow preview so you can see the ${copy.keepsake} before deciding. Preview, edit, or order yours here: ${link}. No pressure—reply stop anytime.`,
  };
}

function getDraftEvidence(targetingData: XLeadDraftContext["targetingData"]) {
  if (!targetingData) return "";
  const matchedTerms = Array.isArray(targetingData.matched_terms)
    ? targetingData.matched_terms.filter((value): value is string => typeof value === "string")
    : [];
  const excerpt = typeof targetingData.post_excerpt === "string" ? targetingData.post_excerpt : "";
  const source = targetingData.source;
  const sourceText = source && typeof source === "object" && "post_text" in source && typeof source.post_text === "string"
    ? source.post_text
    : "";
  return [...matchedTerms, excerpt, sourceText].join(" ");
}

function appendLinkWithinLimit(copy: string, link: string, maxLength: number) {
  const suffix = ` ${link}`;
  return `${copy.slice(0, Math.max(0, maxLength - suffix.length)).trimEnd()}${suffix}`;
}
