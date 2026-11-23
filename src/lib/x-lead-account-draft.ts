export const ACCOUNT_DRAFT_VERSION = "account-draft-v1.3";
export type DraftStatus = "draft_ready" | "no_match" | "evidence_pending" | "blocked";
export type OwnPost = { post_id: string; created_at: string; text: string; source: string; direct_parent_status?: string; is_quote?: boolean };
export type AccountDraftInput = {
  author_id: string;
  account_status: string;
  entry_status: string;
  review_status: string;
  account_evidence: Record<string, unknown>;
  entry_evidence: Record<string, unknown>;
};
export type ActiveDraftProduct = { slug: "custom-pillow" | "face-towel"; name: string };
export type DraftSelection = {
  status: DraftStatus;
  reason: string;
  evidenceCoverage: "full" | "partial";
  selectedPost: OwnPost | null;
  productSlug: ActiveDraftProduct["slug"] | null;
  productMatchReason: string | null;
  conversationAngle: string | null;
  matchStrength: number;
  supportingPostIds?: string[];
  supportingPosts?: OwnPost[];
};

const ID = /^\d{5,30}$/;
const PERSONAL = /\b(?:my|our|i|we|i'm|we're)\b/i;
const PERSONAL_IMAGE = /\b(?:photo|picture|portrait|collage|artwork|drawing|print)\b/i;
const IMAGE_PLACEMENT = /\b(?:photo|picture|portrait|collage|artwork|drawing|print)\b.{0,75}\b(?:for|to display (?:on|in)|to put (?:on|in)|to use (?:on|in))\b.{0,45}\b(?:pillow|cushion|sofa|couch|seat|reading corner)\b|\b(?:pillow|cushion|sofa|couch|seat|reading corner)\b.{0,60}\b(?:with|using|displaying|adding|putting)\b.{0,40}\b(?:photo|picture|portrait|collage|artwork|drawing|print)\b/i;
const SEATING_STYLE = /\b(?:decorat\w*|redecorat\w*|arrang\w*|design\w*|choos\w*|pick\w*|planning)\b.{0,65}\b(?:pillow|cushion|sofa|couch|seat|reading corner)\b.{0,60}\b(?:color|colour|pattern|fabric|cover)\b|\b(?:pillow|cushion|sofa|couch|seat|reading corner)\b.{0,65}\b(?:color|colour|pattern|fabric|cover)\b/i;
const PERSONAL_ROOM_STYLE = /\b(?:my|our)\s+(?:(?:real|own|new)\s+)?(?:living room|bedroom|room)\b.{0,90}\b(?:color|colour|theme|style|pattern)\b|\b(?:color|colour|theme|style|pattern)\b.{0,90}\b(?:my|our)\s+(?:(?:real|own|new)\s+)?(?:living room|bedroom|room)\b/i;
const VIRTUAL_OR_UNRELATED_ROOM = /\b(?:in (?:gta|minecraft|the sims)|virtual room|(?:tv|television|screen) color)\b/i;
const SAFE_PALETTE_COLOR = /\b(?:neutral|olive|black|white|green|blue|pink|red|brown|beige|cream|sage|navy|purple|yellow|orange|grey|gray|gold)\b/gi;
const OWN_ROOM = /\b(?:my|our)\s+(?:(?:real|own|new)\s+)?(?:living room|bedroom|room|apartment)\b/i;
const ROOM_PROJECT_ACTION = /\b(?:paint\w*|redecorat\w*|decorat\w*|match\w*|consider\w*|decid\w*|choos\w*|pick\w*|planning|switch\w*|chang\w*|take|go with|coming together)\b/i;
const ROOM_STYLE_DESCRIPTOR = /\b(?:(?:cabin|cottage|coastal|boho|vintage|rustic|minimalist|modern|winter|autumn)\s*(?:core|style|look|aesthetic)|gingerbread\s+house)\b/i;
const SENSITIVE = /\b(?:died|death|passed away|hospital|surgery|suicide|grief|mourning|terminal|cancer|injur\w*|abuse)\b/i;
const SAME_PRODUCT_DONE = /\b(?:pillow|cushion|towel)s?\b.{0,45}\b(?:arrived|received|finished|done|already bought|already ordered)\b|\b(?:arrived|received|finished|done|already bought|already ordered)\b.{0,45}\b(?:pillow|cushion|towel)s?\b/i;
const REFUSAL = /\b(?:not looking for (?:recommendations|suggestions|products)|no (?:ads|sales|promotions|recommendations)|don't (?:suggest|recommend|sell)|not (?:a|for a|interested in(?: a)?) (?:pillow|cushion|towel)s?)\b/i;
const GENERAL_REFUSAL = /\b(?:not looking for (?:recommendations|suggestions|products)|no (?:ads|sales|promotions|recommendations)|don't (?:suggest|recommend|sell))\b/i;

function validPost(value: unknown, ownIds: Set<string>, authorId: string, nowMs: number): OwnPost | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const postId = String(row.post_id ?? "");
  const createdAt = String(row.created_at ?? "");
  const text = String(row.text ?? "").trim();
  if (row.author_id != null && String(row.author_id) !== authorId) return null;
  if (row.is_repost === true || row.isRetweet === true || row.retweeted_tweet || row.retweetedTweet) return null;
  const time = Date.parse(createdAt);
  if (!ID.test(postId) || !ownIds.has(postId) || !text || !Number.isFinite(time)
    || time > nowMs + 5 * 60_000 || nowMs - time > 14 * 24 * 60 * 60_000) return null;
  const parent = String(row.direct_parent_status ?? "");
  if (row.source === "reply" && parent !== "seed_is_direct_parent") return null;
  return { post_id: postId, created_at: createdAt, text,
    source: String(row.source ?? "recent"), direct_parent_status: parent || undefined,
    is_quote: row.is_quote === true || Boolean(row.quoted_tweet || row.quotedTweet) };
}

function ownPosts(input: AccountDraftInput, nowMs: number) {
  const evidence = input.account_evidence;
  const ownIds = new Set(Array.isArray(evidence.own_post_ids)
    ? evidence.own_post_ids.filter((id): id is string => typeof id === "string" && ID.test(id)) : []);
  const snapshots = Array.isArray(evidence.own_posts) ? evidence.own_posts : null;
  const legacy = [evidence.person_evidence, evidence.project_evidence]
    .flatMap((rows) => Array.isArray(rows) ? rows : []);
  if (input.entry_evidence.post_id) legacy.push(input.entry_evidence);
  const posts = new Map<string, OwnPost>();
  for (const raw of [...(snapshots ?? []), ...legacy]) {
    const post = validPost(raw, ownIds, input.author_id, nowMs);
    if (post) posts.set(post.post_id, post);
  }
  return { posts: [...posts.values()].sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at)),
    coverage: snapshots && snapshots.length >= ownIds.size ? "full" as const : "partial" as const };
}

function roomStyleAngle(text: string): string {
  const roomMatch = /\b(?:my|our)\s+(?:(?:real|own|new)\s+)?(living room|bedroom|room|apartment)\b/i.exec(text);
  const room = roomMatch?.[1] === "bedroom" ? "bedroom" : roomMatch?.[1] === "living room" ? "living room" : roomMatch?.[1] === "apartment" ? "apartment" : "room";
  if (/\b(?:trying|deciding|figuring|figure out|what)\b.{0,35}\b(?:color|colour)\b.{0,40}\b(?:my|our)\s+living room\b/i.test(text)) {
    return "the living-room color you're deciding on";
  }
  const position = roomMatch?.index ?? 0;
  const vicinity = text.slice(Math.max(0, position - 95), position + (roomMatch?.[0].length ?? 0) + 95);
  const style = ROOM_STYLE_DESCRIPTOR.exec(vicinity)?.[0]?.toLowerCase();
  if (style) return `the ${style} direction you're considering for your ${room}`;
  if (roomAestheticChange(text)) return `the new look you're considering for your ${room}`;
  const colors = [...new Set((vicinity.match(SAFE_PALETTE_COLOR) ?? []).map((color) => color.toLowerCase()))].slice(0, 2);
  if (colors.includes("gold") && /\bmatch\w*\s+(?:my|our)\s+living room\b/i.test(vicinity)) {
    return "the gold accents in your living room";
  }
  if (/\b(?:switch\w*|take|different colored walls|yearning for|decid\w*)\b/i.test(text)) {
    return `the ${room} palette you're changing or considering`;
  }
  if (colors.length && room === "living room" && /\bmatch\w*\b/i.test(vicinity)) {
    return `the ${colors.join(" and ")} accents you're matching to your living room`;
  }
  if (colors.length) return `the ${colors.join(" and ")} ${room} palette you mentioned`;
  return `the ${room} color or theme you're exploring`;
}

function roomAestheticChange(text: string): boolean {
  if (VIRTUAL_OR_UNRELATED_ROOM.test(text)) return false;
  const clauses = text.split(/[.!?\n]+/);
  const roomPalette = /\b(?:my|our)\s+(?:living room|bedroom|room|apartment)\s+(?:is|looks?|feels?|seems?)\s+(?:(?:so|too|very|quite|really)\s+)?(?:beige|grey|gray|white|black|cream|neutral|blue|green|pink|purple|yellow|orange|brown)\b/i;
  return clauses.some((clause, index) => roomPalette.test(clause)
    && clauses.slice(index + 1, index + 3).some((next) => /\bI\b.{0,35}\b(?:want|would like|wish|hoping for)\b.{0,25}\b(?:warmer|warmth|cooler|brighter|darker)\b.{0,25}\b(?:look|feel|aesthetic|vibe|like this)\b/i.test(next)));
}

function namedRoomProject(text: string): boolean {
  if (VIRTUAL_OR_UNRELATED_ROOM.test(text)) return false;
  const clauses = text.split(/[.!?\n]+/);
  const palette = new RegExp(SAFE_PALETTE_COLOR.source, "i");
  return clauses.some((clause, index) => {
    if (!OWN_ROOM.test(clause) || !ROOM_PROJECT_ACTION.test(clause)) return false;
    if (/\bgingerbread\s+house\b/i.test(clause)
      && !/\b(?:my|our)\s+apartment\b.{0,55}\b(?:as|into)\s+a?\s*gingerbread\s+house\b/i.test(clause)) return false;
    if (palette.test(clause) || ROOM_STYLE_DESCRIPTOR.test(clause)) return true;
    if (/\b(?:can.t wait|cannot wait)\s+to\s+decorat\w*\b/i.test(clause)) {
      return clauses.slice(index + 1, index + 3).some((next) => /\bI\s+want\b.{0,65}\bdecor\b/i.test(next) && palette.test(next));
    }
    return /\b(?:switch\w*|chang\w*|decid\w*)\b/i.test(clause)
      && clauses.slice(index + 1, index + 3).some((next) => /\b(?:i|we)\s+(?:want|would like|might choose|will choose)\b/i.test(next)
        && palette.test(next));
  });
}

function matchProduct(text: string, products: ActiveDraftProduct[]) {
  if (!PERSONAL.test(text)) return null;
  const pillow = products.find((product) => product.slug === "custom-pillow");
  const imagePlacement = IMAGE_PLACEMENT.test(text);
  const seatingStyle = SEATING_STYLE.test(text);
  const roomStyle = (PERSONAL_ROOM_STYLE.test(text) && !VIRTUAL_OR_UNRELATED_ROOM.test(text))
    || namedRoomProject(text) || roomAestheticChange(text);
  if (pillow && (imagePlacement || seatingStyle || roomStyle)) {
    const image = imagePlacement;
    return { slug: pillow.slug, reason: image
      ? "本人帖子同时涉及照片或作品与座位、沙发或靠垫；枕套是可供审阅的用途假设"
      : seatingStyle ? "本人正在布置座位、沙发或靠垫的配色/图案；枕套仅为条件式用途建议"
        : "本人描述了居住空间的具体配色或主题；枕套仅为条件式软装用途建议，未表明求购",
      angle: image ? "using a personal image in your seating area"
        : seatingStyle ? /\b(?:cushion|pillow)s?\b/i.test(text) ? "the cushion colors and patterns in your room"
          : "the sofa colors and patterns you are arranging"
          : roomStyleAngle(text), strength: image ? 2 : 1 };
  }
  const towel = products.find((product) => product.slug === "face-towel");
  if (towel && /\b(?:face towel|hand towel|washcloth)\b/i.test(text)
    && !/\b(?:beach towel|golf towel|bath sheet|bath towel)\b/i.test(text)
    && !/\bembroider\w*\b/i.test(text)
    && (PERSONAL_IMAGE.test(text) || /\b(?:custom|personaliz\w*|design\w*)\b/i.test(text))) {
    return { slug: towel.slug, reason: "本人帖子同时提到毛巾与照片、设计或定制用途；具体材料仍待人工核对",
      angle: /\bface towel\b/i.test(text) ? "your idea for a personalized face towel"
        : "your idea for a personalized hand towel", strength: 2 };
  }
  return null;
}

function sameRoomProjectMatch(posts: OwnPost[], products: ActiveDraftProduct[]) {
  const pillow = products.find((product) => product.slug === "custom-pillow");
  if (!pillow) return null;
  const room = (text: string) => /\b(?:my|our)\s+(?:living room|bedroom|room|apartment)\b/i.exec(text)?.[0].replace(/^my |^our /i, "").toLowerCase();
  const color = new RegExp(SAFE_PALETTE_COLOR.source, "i");
  for (const current of posts) {
    const currentRoom = room(current.text);
    if (!currentRoom || !/\b(?:redecorat\w*|decorat\w*|not even done|not done|still working|in progress)\b/i.test(current.text)
      || VIRTUAL_OR_UNRELATED_ROOM.test(current.text) || current.direct_parent_status === "thread_context_known_direct_parent_unknown"
      || SENSITIVE.test(current.text) || REFUSAL.test(current.text) || SAME_PRODUCT_DONE.test(current.text)) continue;
    for (const support of posts) {
      if (support.post_id === current.post_id || room(support.text) !== currentRoom
        || Date.parse(support.created_at) >= Date.parse(current.created_at)
        || VIRTUAL_OR_UNRELATED_ROOM.test(support.text) || support.direct_parent_status === "thread_context_known_direct_parent_unknown"
        || SENSITIVE.test(support.text) || REFUSAL.test(support.text) || SAME_PRODUCT_DONE.test(support.text)
        || !color.test(support.text) || !/\b(?:curtain|cushion|pillow|decor|pattern)\w*\b/i.test(support.text)) continue;
      const shade = color.exec(support.text)?.[0]?.toLowerCase();
      return { post: current, support,
        match: { slug: pillow.slug, reason: `同一账号近期两条本人帖子分别说明${currentRoom}仍在布置及${shade ?? "具体"}软装方向（证据 ${current.post_id}、${support.post_id}）；枕套仅为条件式用途建议`,
          angle: `the ${currentRoom} palette and redecoration you're working on`, strength: 1 } };
    }
  }
  return null;
}

export function selectAccountDraft(input: AccountDraftInput, products: ActiveDraftProduct[], now = new Date()): DraftSelection {
  const { posts, coverage } = ownPosts(input, now.getTime());
  const base = { evidenceCoverage: coverage, selectedPost: null, productSlug: null,
    productMatchReason: null, conversationAngle: null, matchStrength: 0 } as DraftSelection;
  if (input.review_status === "dismissed" || input.account_status === "excluded"
    || input.account_evidence.exclusion_reason) return { ...base, status: "blocked", reason: "账号已忽略或排除" };
  if (input.entry_status === "hold") return { ...base, status: "blocked", reason: "当前交流入口涉及需暂缓的生活语境" };
  if (!posts.length) return { ...base, status: "evidence_pending", reason: "缺少有原文、时间及作者归属的近期本人帖子" };
  if (!products.length) return { ...base, status: "no_match", reason: "当前无已核实可售的定制商品" };
  let blocked = false;
  const matches: Array<{ post: OwnPost; match: NonNullable<ReturnType<typeof matchProduct>> }> = [];
  const stopPosts = posts.filter((post) => REFUSAL.test(post.text) || SAME_PRODUCT_DONE.test(post.text));
  for (const post of posts) {
    if (post.direct_parent_status === "thread_context_known_direct_parent_unknown") continue;
    if (SENSITIVE.test(post.text) || REFUSAL.test(post.text) || SAME_PRODUCT_DONE.test(post.text)) {
      blocked = true;
      continue;
    }
    const match = matchProduct(post.text, products);
    if (!match) continue;
    if (stopPosts.some((stop) => Date.parse(stop.created_at) >= Date.parse(post.created_at)
      && (GENERAL_REFUSAL.test(stop.text)
        || match.slug === "custom-pillow" && /\b(?:pillow|cushion)s?\b/i.test(stop.text)
        || match.slug === "face-towel" && /\b(?:towel|washcloth)s?\b/i.test(stop.text)))) {
      blocked = true;
      continue;
    }
    if (post.post_id === String(input.entry_evidence.post_id ?? "") && input.entry_status === "hold") {
      blocked = true;
      continue;
    }
    matches.push({ post, match });
  }
  matches.sort((a, b) => b.match.strength - a.match.strength
    || Date.parse(b.post.created_at) - Date.parse(a.post.created_at));
  const accountProject = sameRoomProjectMatch(posts, products);
  if (accountProject && !stopPosts.some((stop) => Date.parse(stop.created_at) >= Date.parse(accountProject.support.created_at)
    && (GENERAL_REFUSAL.test(stop.text) || /\b(?:pillow|cushion)s?\b/i.test(stop.text)))) {
    matches.push({ post: accountProject.post, match: accountProject.match });
  }
  matches.sort((a, b) => b.match.strength - a.match.strength
    || Date.parse(b.post.created_at) - Date.parse(a.post.created_at));
  const best = matches[0];
  if (best) return { status: "draft_ready", reason: "有可解释的本人帖子交流入口及条件式商品用途，仍需人工审阅",
    evidenceCoverage: coverage, selectedPost: best.post, productSlug: best.match.slug,
    productMatchReason: best.match.reason, conversationAngle: best.match.angle,
    matchStrength: best.match.strength,
    supportingPostIds: accountProject && best.match === accountProject.match ? [accountProject.support.post_id] : [],
    supportingPosts: accountProject && best.match === accountProject.match ? [accountProject.support] : [] };
  return { ...base, status: blocked ? "blocked" : "no_match", reason: blocked
    ? "相关帖子涉及敏感、已完成同类需求或明确拒绝推荐；不生成草稿"
    : "已存本人帖子未呈现与当前可售商品相连的具体用途" };
}

export type AccountPreviewBrief = { visibleMotifs: string; designReason: string };
export function validAccountPreviewBrief(brief: AccountPreviewBrief) {
  return /^[\p{L}\p{N} ,&'-]{5,90}$/u.test(brief.visibleMotifs)
    && /^[\p{L}\p{N} ,&'-]{5,90}$/u.test(brief.designReason);
}

/** Rule-authored, evidence-grounded public reply. A preview brief describes actual reviewed artwork. */
export function createAccountReply(selection: DraftSelection, marketingUrl: string, firstOrder25: boolean,
  options: { preview?: AccountPreviewBrief } = {}): string {
  if (selection.status !== "draft_ready" || !selection.productSlug || !selection.selectedPost || !selection.conversationAngle)
    throw new Error("No reviewable draft");
  const original = selection.selectedPost.text;
  const advice = options.preview ? accountPreviewResponse(original, selection) : accountAdvice(original, selection);
  const product = selection.productSlug === "custom-pillow" ? "custom-printed pillow cover" : "customizable face towel";
  const preview = options.preview;
  if (preview && !validAccountPreviewBrief(preview)) throw new Error("Preview brief is invalid");
  const suggestion = preview
    ? `Original ${product} sample: ${preview.designReason}. Preview/edit: ${marketingUrl}`
    : marketingUrl;
  const offer = firstOrder25 ? " First orders: 25% off." : "";
  let text = `${advice} ${suggestion}${offer}`;
  if (text.length > 280 && offer) text = `${advice} ${suggestion}`;
  if (text.length > 280) throw new Error("Public reply draft exceeds 280 characters");
  return text;
}

function accountPreviewResponse(text: string, selection: DraftSelection): string {
  const t = text.toLowerCase();
  if (/gingerbread house/.test(t)) return "A gingerbread-house theme for the apartment sounds playful.";
  if (/neutral/.test(t) && /olive/.test(t)) return "Your neutral tree's olive accent could carry into a smaller room detail.";
  if (/cabin\s*core/.test(t)) return "You pictured cabin-core with a little winter; this sample leans snowy.";
  return accountAdvice(text, selection).split(/(?<=[.!?])\s+/)[0].replace(/:\s*$/, ".");
}

function accountAdvice(text: string, selection: DraftSelection): string {
  const t = text.toLowerCase().replaceAll("&amp;", "&");
  const room = /\b(?:my|our) apartment\b/i.test(t) ? "apartment" : /\b(?:my|our) bedroom\b/i.test(t) ? "bedroom"
    : /\b(?:my|our) living room\b/i.test(t) ? "living room" : "space";
  if (selection.productSlug === "face-towel") return "For a small face towel, one clear repeated element may read better than a busy layout. You can upload your own design for a custom face towel:";
  if (selection.matchStrength === 2 && /\b(?:photo|portrait|image)\b/.test(t)
    && /\b(?:reading corner|sofa|couch|seat|pillow|cushion)\b/.test(t)) {
    const location = /reading corner/.test(t) ? "reading corner" : /\b(?:sofa|couch)\b/.test(t) ? "sofa" : "seating area";
    return `For the photo-and-pillow idea in your ${location}, try a crop that keeps the subject clear. You could upload an image you have rights to for a custom-printed pillow cover:`;
  }
  if (selection.supportingPosts?.some((post) => /pink curtains/i.test(post.text)))
    return "Pink curtains could give the unfinished living room a color to echo. If you have a print in mind, a custom pillow cover could carry it into the seating area:";
  if (/gingerbread house/.test(t)) return "A gingerbread-house apartment is a whole theme. Repeating one original candy motif on a custom-printed pillow cover could tie a corner into it:";
  if (/cabin\s*core/.test(t)) return "Cabin-core with a little winter could start with a restrained woodland print. A custom-printed pillow cover is one removable place to try it:";
  if (/neutral/.test(t) && /olive/.test(t)) return "Your neutral tree already has that olive accent. Echoing it in an original print on a pillow cover could connect the living room without adding another dominant color:";
  if (/four different colored walls/.test(t) && /white room/.test(t)) return "Going from four wall colors toward white is a big shift. A printed pillow cover could let you keep one chosen accent while you test the walls:";
  if (/inside of my bedroom door/.test(t) && /light green/.test(t)) return "A light-green accent door could be echoed in one bedroom textile. If you have a matching design, it could go on a printed pillow cover:";
  if (/green out my living room/.test(t) && /burnt orange/.test(t)) return "Burnt orange is a clear move away from green. Try it in a removable print first; a custom pillow cover is one place for your own design:";
  if (/nature vibes anymore/.test(t) && /pink/.test(t)) return "Pink/blue and pink/black would set different moods. Before changing the whole room, try your chosen pairing on a printed pillow cover:";
  if (/purple or pink/.test(t) && /couch/.test(t)) return "Purple or pink walls and a new couch are two big choices. Try paint swatches beside the sofa fabric first; a pillow cover could echo the shade you pick:";
  if (/gold/.test(t) && /holiday/.test(t) && /red/.test(t)) return "Gold already links your living room to the holiday options. Whichever palette you choose, an original print on a pillow cover could repeat it:";
  if (/gold/.test(t) && /living room/.test(t) && /black/.test(t) && /white/.test(t)) return "Black, white and gold give your living room a clear direction. A printed pillow cover using your own design could repeat the gold without changing the larger pieces:";
  if (/pink/.test(t) && /apartment/.test(t) && /coming together/.test(t)) return "The pink apartment is coming together. A printed pillow cover could carry a print you choose into one soft furnishing without changing the whole scheme:";
  if (/beige/.test(t) && /warmth/.test(t)) return "For a warmer-looking beige living room, try a richer visual accent. A printed pillow cover could show your chosen pattern without changing the walls:";
  if (/dark and moody/.test(t)) return "A dark, moody room doesn't need a bright contrast. A low-contrast print on a custom pillow cover could extend the direction you're building:";
  if (/black nouvea/.test(t)) return "That black nouveau bedroom idea has a strong direction. A printed pillow cover could carry one detail from a design you choose while keeping the dark look:";
  if (/pink/.test(t) && /blue/.test(t) && /room/.test(t)) return "Pink and blue could give your room a playful look. An original print in those tones on a pillow cover might help test the pairing:";
  if (/light pink/.test(t) && /beige/.test(t) && /gold/.test(t)) return "Beige, light pink and gold form a gentle apartment palette. A print you choose on a pillow cover could repeat one of those tones:";
  if (/paint my bedroom pink/.test(t)) return "Before painting your bedroom pink, compare the swatch with your bedding in daylight. A printed pillow cover could echo the shade you settle on:";
  if (/\bpaint.*(?:bedroom|living room)/.test(t)) return `If you're still choosing a ${room} wall color, try swatches in day and evening light. Once you decide, a custom pillow cover could carry a related print:`;
  if (/\b(?:trying|picking|decide|figuring)\b/.test(t) && /color/.test(t)) return `Choosing a ${room} color can take a few swatches. A printed pillow cover could carry your final palette into one soft furnishing:`;
  if (/\bcurtains?\b/.test(t)) return "Once the curtains are chosen, a print using one of their accents could connect the soft furnishings on a custom pillow cover:";
  if (/\b(?:sofa|couch)\b/.test(t)) return "A removable printed pillow cover could let you try a sofa color or pattern before committing to larger pieces:";
  return `If you settle on a ${room} palette, your own print on a custom pillow cover could add one coordinated soft accent:`;
}
