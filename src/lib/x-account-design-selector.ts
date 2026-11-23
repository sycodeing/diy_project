import type { DraftSelection } from "@/lib/x-lead-account-draft";

export type DesignChoice =
  | { kind: "seed"; designId: "gingerbread-v1" | "neutral-olive-v1" | "winter-cabin-v1"; evidencePostIds: string[]; visibleMotifs: string; designReason: string; generationMethod: "seed_imagegen" }
  | { kind: "procedural"; designId: string; recipeId: string; colors: string[]; evidencePostIds: string[]; visibleMotifs: string; designReason: string; generationMethod: "procedural"; matchType: "stated_style" | "proposed_option" | "fallback_option" }
  | { kind: "no_design_match"; reason: string };

export function accountDesignBrief(choice: Exclude<DesignChoice, { kind: "no_design_match" }>, renderRevision: string) {
  return { visibleMotifs: choice.visibleMotifs, designReason: choice.designReason,
    designId: choice.designId, generationMethod: choice.generationMethod, evidencePostIds: choice.evidencePostIds,
    renderRevision, matchType: choice.kind === "procedural" ? choice.matchType : "stated_style",
    ...(choice.kind === "procedural" ? { recipeId: choice.recipeId, colors: choice.colors, recipeVersion: 1 } : {}),
    ...(choice.kind === "procedural" && choice.matchType === "fallback_option"
      ? { fallbackReason: "missing_explicit_palette_or_theme", paletteSource: "brand_default" } : {}),
  };
}

export function isFallbackAccountDesignBrief(value: string | null | undefined) {
  try {
    const brief: unknown = JSON.parse(value ?? "");
    return Boolean(brief && typeof brief === "object" && !Array.isArray(brief)
      && (brief as Record<string, unknown>).matchType === "fallback_option");
  } catch { return false; }
}

const ownRoom = /\b(?:my|our)\s+(?:(?:new|own|real)\s+)?(living room|bedroom|room|apartment)\b/i;
const virtual = /\b(?:in (?:gta|minecraft|the sims)|virtual room|(?:tv|television|screen) color)\b/i;
const explicitDirection = /\b(?:neutral|olive|black|white|green|blue|pink|red|brown|beige|cream|sage|navy|purple|yellow|orange|grey|gray|gold|teal|turquoise|aqua|cyan|magenta|lavender|lilac|burgundy|maroon|coral|peach|mint|silver|ivory|taupe|charcoal|cabin\s*core|cottage\s*core|coastal|boho|vintage|rustic|minimalist|modern|traditional|industrial|scandinavian|art deco|nouveau|gingerbread|floral|botanical|striped|stripes|plaid|checkered|geometric|woodland|nature|holiday|christmas|winter|autumn)\b/i;
const roomProject = /\b(?:colou?rs?|themes?|styles?|patterns?|aesthetics?|look|decor\w*|paint\w*)\b/i;
const projectChoice = /\b(?:choos\w*|pick\w*|decid\w*|consider\w*|explor\w*|trying|figure|figuring|chang\w*|switch\w*|redecorat\w*|paint\w*|want|planning)\b/i;
const genericDirectionWords = new Set(["a", "an", "the", "my", "our", "your", "new", "different", "another", "any", "some", "this", "that", "same", "room", "living", "bedroom", "apartment", "own", "real", "what", "which", "color", "colour", "colors", "colours", "theme", "style", "palette", "choose", "choosing", "pick", "picking", "decide", "deciding", "change", "changing", "switch", "switching", "want", "consider", "considering", "explore", "exploring", "undecided", "unsure", "not", "no", "still", "yet", "to", "of", "for", "in", "paint", "wall", "walls", "on", "out"]);
function hasExplicitDirection(text: string) {
  if (explicitDirection.test(text) || /#[a-f\d]{3}(?:[a-f\d]{3})?\b/i.test(text)) return true;
  // Unknown named directions still count as stated preferences; they must not become a brand-default palette.
  const descriptor = /\b([a-z][a-z-]*)\s+(?:style|theme|aesthetic|palette|colou?rs?)\b/gi;
  const assignment = /\b(?:style|theme|aesthetic|palette|colou?rs?)\s*(?::|(?:is|will be|would be|to be)\b)\s*(?:a\s+|an\s+|the\s+)?([a-z][a-z-]*)\b/gi;
  return [...text.matchAll(descriptor), ...text.matchAll(assignment)]
    .some((match) => !genericDirectionWords.has(match[1].toLowerCase()));
}
const roomsIn = (text: string) => new Set([...text.matchAll(new RegExp(ownRoom.source, "gi"))].map((match) => match[1].toLowerCase()));
const supportText = (selection: DraftSelection) => {
  const primary = selection.selectedPost;
  if (!primary) return [];
  const rooms = roomsIn(primary.text);
  if (rooms.size !== 1) return [primary];
  const targetRoom = [...rooms][0];
  return [primary, ...(selection.supportingPosts ?? []).filter((post) => {
    const supportRooms = roomsIn(post.text);
    return supportRooms.size === 1 && supportRooms.has(targetRoom) && !virtual.test(post.text);
  })];
};

/** This selects an original brand sample, never artwork or colors from a quoted post or media URL. */
export function selectAccountDesign(selection: DraftSelection): DesignChoice {
  if (selection.status !== "draft_ready" || selection.productSlug !== "custom-pillow" || !selection.selectedPost)
    return { kind: "no_design_match", reason: "当前商品或本人帖子不适合自动设计" };
  const posts = supportText(selection);
  const text = posts.map((post) => post.text).join("\n");
  const primary = selection.selectedPost.text;
  if (!posts.some((post) => ownRoom.test(post.text) && !virtual.test(post.text)))
    return { kind: "no_design_match", reason: "没有本人实体居住空间的明确设计依据" };
  if (/\b(?:my|our) apartment\b.{0,80}\b(?:as|into)\s+a?\s*gingerbread\s+house\b/i.test(primary))
    return { kind: "seed", designId: "gingerbread-v1", evidencePostIds: [selection.selectedPost.post_id],
      visibleMotifs: "iced houses and candy canes", designReason: "gingerbread shapes echo your apartment theme", generationMethod: "seed_imagegen" };
  if (/\bneutral\b.{0,70}\bolive\b|\bolive\b.{0,70}\bneutral\b/i.test(primary))
    return { kind: "seed", designId: "neutral-olive-v1", evidencePostIds: [selection.selectedPost.post_id],
      visibleMotifs: "olive foliage and pale berries", designReason: "olive greenery echoes the accent you mentioned", generationMethod: "seed_imagegen" };
  if (/\bcabin\s*core\b/i.test(primary) && /\bwinter\b/i.test(primary))
    return { kind: "seed", designId: "winter-cabin-v1", evidencePostIds: [selection.selectedPost.post_id],
      visibleMotifs: "snowy cabins pines and woodland animals", designReason: "a fuller snowy proposal for your cabin-core direction", generationMethod: "seed_imagegen" };

  const evidencePostIds = posts.map((post) => post.post_id);
  const proposal = (recipeId: string, colors: string[], reason: string, matchType: "stated_style" | "proposed_option" | "fallback_option" = "stated_style"): Extract<DesignChoice, { kind: "procedural" }> => ({
    kind: "procedural", designId: `${recipeId}-v1`, recipeId, colors, evidencePostIds,
    visibleMotifs: ["sage", "warm-neutral", "neutral-starter"].includes(recipeId)
      ? "original wide and narrow vertical stripes" : ["burnt-orange", "gold-ivory"].includes(recipeId)
        ? "original staggered arch shapes" : ["neutral-white", "black-white-gold"].includes(recipeId)
      ? "original rounded geometric tiles" : ["black-nouveau", "dark-tonal"].includes(recipeId)
        ? "original sweeping curves and fine lines" : "original flowing bands and circles",
    designReason: reason,
    generationMethod: "procedural", matchType,
  });
  // Treat an explicitly abandoned old palette as context, not the proposed design.
  if (/\bfour different colored walls\b/i.test(primary) && /\bwhite room\b/i.test(primary))
    return proposal("neutral-white", ["#f1eee6", "#d5cbb9", "#9d8f7d"], "a light neutral option for the white direction");
  if (ownRoom.test(primary) && /\b(?:switch\w*|chang\w*|replac\w*|move away|want)\b.{0,45}\bwhite\b/i.test(primary)
    && /\b(?:old|previous|currently|now|from)\b/i.test(primary))
    return proposal("neutral-white", ["#f1eee6", "#d5cbb9", "#9d8f7d"], "a light neutral option for the white direction");
  if (/\bgreen out my living room\b/i.test(primary) && /\bburnt orange\b/i.test(primary))
    return proposal("burnt-orange", ["#b95e32", "#dd9b62", "#f5e4cf"], "a burnt-orange option for the change you described");
  if (/\bbeige\b/i.test(primary) && /\bwarmth\b/i.test(primary) && ownRoom.test(primary))
    return proposal("warm-neutral", ["#b98958", "#e6c9a4", "#eee1ce"], "one warmer-looking option for your beige room", "proposed_option");
  if (/\bpink\b.{0,80}\bblue\b.{0,80}\bpink\b.{0,30}\bblack\b/i.test(primary))
    return proposal("pink-blue", ["#db91ad", "#7c99bb", "#f4dce5"], "one pink-and-blue option, not a chosen final palette", "proposed_option");
  if (/\bpurple or pink\b/i.test(primary) && ownRoom.test(primary))
    return proposal("purple-option", ["#a77aab", "#d8cbd9", "#f2e5eb"], "one purple option while you decide between purple and pink", "proposed_option");
  if (/\b(?:red|green)\b/i.test(primary) && /\ball gold\b/i.test(primary) && /\bholiday\b/i.test(primary))
    return proposal("gold-ivory", ["#bb9853", "#e5d5ae", "#f8f4e8"], "one gold-and-ivory proposal without choosing your holiday palette", "proposed_option");
  if (/\bblack nouvea\b/i.test(primary) && /\bbedroom\b/i.test(primary))
    return proposal("black-nouveau", ["#27262a", "#8c798a", "#d5c9c5"], "a dark curved-line sample, not an exact reproduction of your style");
  if (/\bblack\b/i.test(primary) && /\bwhite\b/i.test(primary) && /\bgold\b/i.test(primary))
    return proposal("black-white-gold", ["#222126", "#e8e4dc", "#ba995a"], "an original black white and gold option");
  if (/\bdark and moody\b/i.test(primary))
    return proposal("dark-tonal", ["#292e39", "#535666", "#87818a"], "a low-contrast proposal for the dark direction");
  if (/\blight green\b/i.test(primary) && /\bbedroom door\b/i.test(primary))
    return proposal("sage", ["#9cad90", "#d9dfc9", "#f3f0df"], "a sage-toned option echoing the planned accent door");
  if (/\bpink curtains\b/i.test(text) && posts.length > 1 && posts.some((post) => /\bliving room\b/i.test(post.text)))
    return proposal("pink", ["#d98faa", "#f0c8d5", "#faf0e9"], "a pink option inspired by the curtain plan");
  if (/\bbeige\b/i.test(primary) && /\blight pink\b/i.test(primary) && /\bgold\b/i.test(primary))
    return proposal("beige-pink-gold", ["#c8b492", "#e7c0c9", "#b39659"], "a beige light-pink and gold proposal");
  if (/\b(?:light pink|pink everywhere|paint my bedroom pink|pink bedroom)\b/i.test(primary))
    return proposal("pink", ["#d98faa", "#f0c8d5", "#faf0e9"], "an original pink sample for the room you described");
  if (roomsIn(primary).size !== 1)
    return { kind: "no_design_match", reason: "同一帖涉及多个空间，尚不能明确所选空间的设计方向" };
  if (hasExplicitDirection(text))
    return { kind: "no_design_match", reason: "本人已提供颜色或主题，但当前暂无对应原创设计" };
  if (!ownRoom.test(primary) || virtual.test(primary) || !roomProject.test(primary) || !projectChoice.test(primary))
    return { kind: "no_design_match", reason: "没有本人实体居住空间选择配色或改变风格的明确需求" };
  return { ...proposal("neutral-starter", ["#F4F0E8", "#D8CFC1", "#A89B89"],
    "a neutral starting point while you choose your colors", "fallback_option"),
    visibleMotifs: "original wide and narrow neutral stripes", evidencePostIds: [selection.selectedPost.post_id] };
}
