export const ACCOUNT_DRAFT_VERSION = "account-draft-v1";
export type DraftStatus = "draft_ready" | "no_match" | "evidence_pending" | "blocked";
export type OwnPost = { post_id: string; created_at: string; text: string; source: string; direct_parent_status?: string };
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
};

const ID = /^\d{5,30}$/;
const PERSONAL = /\b(?:my|our|i|we|i'm|we're)\b/i;
const PERSONAL_IMAGE = /\b(?:photo|picture|portrait|collage|artwork|drawing|print)\b/i;
const IMAGE_PLACEMENT = /\b(?:photo|picture|portrait|collage|artwork|drawing|print)\b.{0,75}\b(?:for|to display (?:on|in)|to put (?:on|in)|to use (?:on|in))\b.{0,45}\b(?:pillow|cushion|sofa|couch|seat|reading corner)\b|\b(?:pillow|cushion|sofa|couch|seat|reading corner)\b.{0,60}\b(?:with|using|displaying|adding|putting)\b.{0,40}\b(?:photo|picture|portrait|collage|artwork|drawing|print)\b/i;
const SEATING_STYLE = /\b(?:decorat\w*|redecorat\w*|arrang\w*|design\w*|choos\w*|pick\w*|planning)\b.{0,65}\b(?:pillow|cushion|sofa|couch|seat|reading corner)\b.{0,60}\b(?:color|colour|pattern|fabric|cover)\b|\b(?:pillow|cushion|sofa|couch|seat|reading corner)\b.{0,65}\b(?:color|colour|pattern|fabric|cover)\b/i;
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
  if (row.quoted_tweet || row.quotedTweet || row.is_repost === true || row.isRetweet === true) return null;
  const time = Date.parse(createdAt);
  if (!ID.test(postId) || !ownIds.has(postId) || !text || !Number.isFinite(time)
    || time > nowMs + 5 * 60_000 || nowMs - time > 14 * 24 * 60 * 60_000) return null;
  const parent = String(row.direct_parent_status ?? "");
  if (row.source === "reply" && parent !== "seed_is_direct_parent") return null;
  return { post_id: postId, created_at: createdAt, text,
    source: String(row.source ?? "recent"), direct_parent_status: parent || undefined };
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

function matchProduct(text: string, products: ActiveDraftProduct[]) {
  if (!PERSONAL.test(text)) return null;
  const pillow = products.find((product) => product.slug === "custom-pillow");
  const imagePlacement = IMAGE_PLACEMENT.test(text);
  const seatingStyle = SEATING_STYLE.test(text);
  if (pillow && (imagePlacement || seatingStyle)) {
    const image = imagePlacement;
    return { slug: pillow.slug, reason: image
      ? "本人帖子同时涉及照片或作品与座位、沙发或靠垫；枕套是可供审阅的用途假设"
      : "本人正在布置座位、沙发或靠垫的配色/图案；枕套仅为条件式用途建议",
      angle: image ? "using a personal image in your seating area"
        : /\b(?:cushion|pillow)s?\b/i.test(text) ? "the cushion colors and patterns in your room"
          : "the sofa colors and patterns you are arranging", strength: image ? 2 : 1 };
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
  const best = matches[0];
  if (best) return { status: "draft_ready", reason: "有可解释的本人帖子交流入口及条件式商品用途，仍需人工审阅",
    evidenceCoverage: coverage, selectedPost: best.post, productSlug: best.match.slug,
    productMatchReason: best.match.reason, conversationAngle: best.match.angle,
    matchStrength: best.match.strength };
  return { ...base, status: blocked ? "blocked" : "no_match", reason: blocked
    ? "相关帖子涉及敏感、已完成同类需求或明确拒绝推荐；不生成草稿"
    : "已存本人帖子未呈现与当前可售商品相连的具体用途" };
}

export function createAccountReply(selection: DraftSelection, marketingUrl: string, firstOrder25: boolean): string {
  if (selection.status !== "draft_ready" || !selection.productSlug || !selection.conversationAngle) throw new Error("No reviewable draft");
  const product = selection.productSlug === "custom-pillow" ? "custom photo pillow covers" : "customizable face towels";
  const offer = firstOrder25 ? " First orders currently get 25% off." : "";
  const text = `For ${selection.conversationAngle}, ${product} could be one option if useful. See the design page: ${marketingUrl}${offer}`;
  if (text.length > 280) throw new Error("Public reply draft exceeds 280 characters");
  return text;
}
