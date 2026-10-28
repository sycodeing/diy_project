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

export function createXLeadDrafts(context: XLeadDraftContext, link = "{link}", profile?: XLeadCopyProfile) {
  const occasion = getXLeadCopyOccasion(context);
  const style = profile?.style ?? "warm";
  const seed = profile
    ? [profile.accountKey, profile.variationSeed, profile.voice, profile.positioning, profile.variationNotes].filter(Boolean).join(":")
    : contextSeed(context);
  const openings = OPENINGS[occasion][style];
  const offers = OFFERS[occasion][style];
  const closings = CLOSINGS[style];
  const consentRequests = CONSENT_REQUESTS[style];
  const dmIntroductions = DM_INTRODUCTIONS[style];
  const dmClosings = DM_CLOSINGS[style];
  const openingIndex = stableIndex(`${seed}:opening`, openings.length);
  const offerIndex = stableIndex(`${seed}:offer`, offers.length);
  const closingIndex = stableIndex(`${seed}:closing`, closings.length);
  const consentIndex = stableIndex(`${seed}:consent`, consentRequests.length);
  const dmIntroductionIndex = stableIndex(`${seed}:dm-introduction`, dmIntroductions.length);
  const dmClosingIndex = stableIndex(`${seed}:dm-closing`, dmClosings.length);
  const pet = context.petType === "cat" ? "cat" : context.petType === "dog" ? "dog" : "pet";
  const opening = interpolate(openings[openingIndex], pet);
  const offer = interpolate(offers[offerIndex], pet);
  const closing = closings[closingIndex];

  return {
    consentCopy: `${opening} ${interpolate(consentRequests[consentIndex], pet)}`,
    publicCopy: appendLinkWithinLimit(`${opening} ${offer} ${closing}`, link, 270),
    directMessageCopy: appendLinkWithinLimit(
      `Hi! ${opening} ${interpolate(dmIntroductions[dmIntroductionIndex], pet)} ${dmClosings[dmClosingIndex]}`,
      link,
      1000,
    ),
    variantKey: `${occasion}:${style}:${openingIndex}-${offerIndex}-${closingIndex}-${consentIndex}-${dmIntroductionIndex}-${dmClosingIndex}`,
  };
}

const OPENINGS: Record<XLeadCopyOccasion, Record<XLeadCopyProfile["style"], string[]>> = {
  generic: {
    warm: ["Your {pet} is absolutely adorable—this photo really made me smile!", "This is such a sweet photo of your {pet}!", "Your {pet} has such a wonderful expression in this photo!", "There is so much personality in this lovely {pet} photo!", "This photo captures your {pet} so beautifully!", "What a genuinely heartwarming photo of your {pet}!"],
    playful: ["Your {pet} has some serious camera-star energy!", "That face is far too adorable not to celebrate!", "Your little scene-stealer absolutely nailed this photo!", "Your {pet} clearly knows how to own the camera!", "This tiny superstar has personality for days!", "That expression deserves its own little spotlight!"],
    concise: ["Such an adorable {pet} photo!", "Your {pet} looks wonderful here!", "This photo is genuinely delightful!", "What a great shot of your {pet}!", "This {pet} photo really stands out!", "Such a charming little portrait!"],
  },
};

const OFFERS: Record<XLeadCopyOccasion, Record<XLeadCopyProfile["style"], string[]>> = {
  generic: {
    warm: ["I made a custom pet-pillow preview from this photo as a personal keepsake.", "I prepared a personalized pillow preview using this lovely photo.", "I turned this photo into a made-to-order pet-pillow preview.", "I created a private pillow mockup to show how this photo could look as a keepsake.", "I used this beautiful image to prepare a custom pillow concept for you.", "I put together a personalized preview featuring your {pet}."],
    playful: ["I tried this camera-ready face on a custom pet pillow and made a preview.", "I made a fun pillow preview starring your photogenic {pet}.", "I turned this scene-stealing photo into a custom-pillow preview.", "I gave this little superstar the custom-pillow treatment and made a preview.", "I mocked up a playful keepsake starring this unforgettable face.", "I made a quick pillow concept with your {pet} as the main character."],
    concise: ["I made a custom pet-pillow preview from this photo.", "Here is a personalized pillow preview using this image.", "I prepared a simple custom-pillow preview.", "I created a private keepsake mockup from this photo.", "I turned this image into a custom pillow concept.", "I prepared a personalized preview featuring your {pet}."],
  },
};

const CLOSINGS: Record<XLeadCopyProfile["style"], string[]> = {
  warm: ["You can view it with no pressure:", "Take a look whenever you like:", "Here is the private preview:", "You are welcome to see the result here:", "The preview is ready whenever you want to look:"],
  playful: ["You can see how it turned out here:", "Here is the little reveal:", "Take a peek at the result:", "The tiny star's preview is waiting here:", "See the fun mockup here:"],
  concise: ["View it here:", "Preview it here:", "See the result:", "Open the private preview:", "Take a look here:"],
};

const CONSENT_REQUESTS: Record<XLeadCopyProfile["style"], string[]> = {
  warm: ["Would you be comfortable if I turned this photo into a private custom pet-pillow preview? No reposting or purchase required.", "May I prepare a private custom-pillow preview from this photo for you? There is no obligation to buy.", "Would it be okay if I made a private keepsake preview featuring your {pet}? I will not repost the image."],
  playful: ["Would you mind if I gave this camera-ready face a private custom-pillow preview? No reposting and no pressure to buy.", "May I turn this little superstar into a private pillow mockup for you to see? No obligation at all.", "Can I make a private keepsake preview starring your {pet}? The photo stays private."],
  concise: ["May I make a private custom-pillow preview from this photo? No reposting or purchase required.", "Would a private keepsake preview be okay? There is no obligation to buy.", "Can I prepare a private pillow mockup featuring your {pet}? The image will not be reposted."],
};

const DM_INTRODUCTIONS: Record<XLeadCopyProfile["style"], string[]> = {
  warm: ["I prepared a private custom pet-pillow preview so you can see the keepsake before deciding.", "I made a personalized keepsake mockup from this lovely photo for you to review privately.", "I created a custom pillow concept featuring your {pet}, with no obligation to order."],
  playful: ["I made a fun private pillow preview starring this camera-ready face.", "I turned your little superstar into a playful keepsake mockup for you to see.", "I put together a private custom-pillow reveal featuring your {pet}."],
  concise: ["I made a private custom pet-pillow preview from this photo.", "I prepared a personalized keepsake mockup for you.", "I created a private pillow concept featuring your {pet}."],
};

const DM_CLOSINGS: Record<XLeadCopyProfile["style"], string[]> = {
  warm: ["You can preview, edit, or order whenever it feels right. No pressure—reply stop anytime:", "Take a look whenever you like; changes are welcome and there is no pressure to order:", "Here is the private result. You can ask for edits or simply enjoy the preview:"],
  playful: ["Take a peek, request a tweak, or leave it as a fun little reveal—no pressure:", "The preview is ready for its debut. You can edit or order only if you want:", "Here is the little reveal; reply stop anytime and there is no pressure to buy:"],
  concise: ["Preview or edit it here. No pressure—reply stop anytime:", "View the private result here; ordering is optional:", "Open the preview here and request changes if needed:"],
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
