import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import sharp from "sharp";
import { compositionFamilyForRecipe, renderProceduralArtwork } from "./x-account-design-recipes";
import { accountDesignBrief, isFallbackAccountDesignBrief, selectAccountDesign, type DesignChoice } from "./x-account-design-selector";
import { createAccountReply, selectAccountDraft, type AccountDraftInput, type DraftSelection, type OwnPost } from "./x-lead-account-draft";

const NOW = new Date("2026-11-23T08:00:00Z");
const ownPost = (id: string, text: string): OwnPost => ({
  post_id: id, created_at: "2026-11-22T08:00:00Z", text,
  source: "recent", direct_parent_status: "own_recent_post",
});
const ready = (text: string, supportingPosts: OwnPost[] = []): DraftSelection => ({
  status: "draft_ready", reason: "test fixture", evidenceCoverage: "full",
  selectedPost: ownPost("111111", text), productSlug: "custom-pillow",
  productMatchReason: "test fixture", conversationAngle: null, matchStrength: 1,
  supportingPosts, supportingPostIds: supportingPosts.map((post) => post.post_id),
});
const procedural = (choice: DesignChoice) => {
  assert.equal(choice.kind, "procedural");
  return choice as Extract<DesignChoice, { kind: "procedural" }>;
};

test("an abandoned light-pink bedroom palette does not override the new white direction", () => {
  const choice = procedural(selectAccountDesign(ready("My bedroom was light pink. Now I want to switch my room to white.")));
  assert.equal(choice.recipeId, "neutral-white");
  assert.equal(compositionFamilyForRecipe(choice.recipeId), "geometric");
  assert.doesNotMatch(choice.designReason, /pink/i);
});

test("a green bedroom does not supply a color for an undecided living room", () => {
  const choice = procedural(selectAccountDesign(ready(
    "I can't decide what color my living room should be.",
    [ownPost("222222", "My bedroom is green.")],
  )));
  assert.equal(choice.recipeId, "neutral-starter");
  assert.equal(choice.matchType, "fallback_option");
  assert.deepEqual(choice.evidencePostIds, ["111111"]);
  assert.doesNotMatch(choice.designReason, /green|bedroom/i);
});

test("an undecided actual living room gets a reproducible original neutral starting point", async () => {
  const selection = ready("picking a color to paint our living room might be my most difficult task");
  selection.conversationAngle = "the living room color you are choosing";
  const choice = procedural(selectAccountDesign(selection));
  assert.equal(choice.recipeId, "neutral-starter");
  assert.deepEqual(choice.colors, ["#F4F0E8", "#D8CFC1", "#A89B89"]);
  assert.equal(choice.visibleMotifs, "original wide and narrow neutral stripes");
  assert.equal(choice.designReason, "a neutral starting point while you choose your colors");
  const first = await renderProceduralArtwork(choice);
  const second = await renderProceduralArtwork(choice);
  assert.equal(createHash("sha256").update(first).digest("hex"), createHash("sha256").update(second).digest("hex"));
  const meta = await sharp(first).metadata();
  assert.equal(meta.format, "png");
  assert.equal(meta.width, 1200);
  assert.equal(meta.height, 1200);
  const brief = accountDesignBrief(choice, "render-test-v1");
  assert.equal(brief.matchType, "fallback_option");
  assert.equal(brief.fallbackReason, "missing_explicit_palette_or_theme");
  assert.equal(brief.paletteSource, "brand_default");
  assert.equal(brief.recipeId, "neutral-starter");
  assert.equal(brief.recipeVersion, 1);
  assert.deepEqual(brief.colors, choice.colors);
  assert.equal(isFallbackAccountDesignBrief(JSON.stringify(brief)), true);
  assert.equal(isFallbackAccountDesignBrief("old plain text"), false);
  for (const offer of [false, true]) {
    const reply = createAccountReply(selection, "https://www.thebestdiyshop.com/g/abcdefghij", offer, { preview: brief });
    assert.match(reply, /neutral starting point while you choose your colors/);
    assert.doesNotMatch(reply, /matches|matching|echoes|your neutral|your palette/i);
    assert.ok(reply.length <= 280, `reply length ${reply.length}`);
  }
});

test("fallback does not replace explicit unsupported directions or ambiguous multiple rooms", () => {
  for (const direction of ["blue", "teal", "modern", "boho", "Japandi", "eclectic", "maximalist", "cyberpunk"]) {
    const choice = selectAccountDesign(ready(`I'm choosing a ${direction} style for my living room.`));
    assert.equal(choice.kind, "no_design_match", direction);
    if (choice.kind === "no_design_match") assert.equal(choice.reason, "本人已提供颜色或主题，但当前暂无对应原创设计");
  }
  for (const text of ["I'm choosing #123abc for my living room color.", "I'm changing my living room style. The theme is Japandi."]) {
    const choice = selectAccountDesign(ready(text));
    assert.equal(choice.kind, "no_design_match", text);
    if (choice.kind === "no_design_match") assert.equal(choice.reason, "本人已提供颜色或主题，但当前暂无对应原创设计");
  }
  const mixed = selectAccountDesign(ready("I'm trying to figure out what color my living room will be. My room is green."));
  assert.equal(mixed.kind, "no_design_match");
  if (mixed.kind === "no_design_match") assert.match(mixed.reason, /多个空间/);
  const supported = selectAccountDesign(ready("I'm choosing a color for my living room.", [ownPost("222222", "My living room has teal curtains.")]));
  assert.equal(supported.kind, "no_design_match");
});

test("fallback needs a live eligible pillow room project and ignores quoted design material", () => {
  for (const text of ["I ate gingerbread in my apartment.", "I'm choosing colors for my room in GTA.", "I relaxed in my bedroom."]) {
    assert.equal(selectAccountDesign(ready(text)).kind, "no_design_match", text);
  }
  for (const status of ["blocked", "no_match", "evidence_pending"] as const)
    assert.equal(selectAccountDesign({ ...ready("I'm choosing a color for my living room."), status }).kind, "no_design_match");
  assert.equal(selectAccountDesign({ ...ready("I'm choosing a color for my living room."), productSlug: "face-towel" }).kind, "no_design_match");
  for (const modifier of ["new", "own", "real"]) {
    const choice = procedural(selectAccountDesign(ready(`I'm choosing a color for my ${modifier} living room.`)));
    assert.equal(choice.matchType, "fallback_option");
  }
  for (const text of ["I'm choosing paint colors for my living room.", "I'm deciding on colors for my living room.",
    "I'm choosing a wall color for my living room.", "I'm picking out colors for my living room.",
    "I'm figuring out a color scheme for my living room.", "I'm picking a theme for my living room.",
    "I'm trying to decide what color to paint my living room.", "I can't decide which style to choose for my living room.",
    "I'm changing the style of my living room.", "I'm choosing a new theme for my living room."]) {
    const choice = procedural(selectAccountDesign(ready(text)));
    assert.equal(choice.matchType, "fallback_option", text);
  }
  const input: AccountDraftInput = {
    author_id: "123456789", account_status: "watch", entry_status: "ready", review_status: "unreviewed",
    account_evidence: { own_post_ids: ["111111"], own_posts: [{ ...ownPost("111111", "I'm choosing a color for my living room."),
      quoted_tweet: { text: "My living room is blue with a floral theme", media_url: "https://example.com/art.png" } }] },
    entry_evidence: {},
  };
  const choice = procedural(selectAccountDesign(selectAccountDraft(input, [{ slug: "custom-pillow", name: "Pillow" }], NOW)));
  assert.equal(choice.recipeId, "neutral-starter");
  assert.deepEqual(choice.evidencePostIds, ["111111"]);
});

test("quoted artwork and colors from another author do not become the brand design", () => {
  const input: AccountDraftInput = {
    author_id: "123456789", account_status: "watch", entry_status: "ready", review_status: "unreviewed",
    account_evidence: { own_post_ids: ["111111"], own_posts: [{ ...ownPost("111111", "My living room is so beige. I want some warmth like this."),
      quoted_tweet: { id: "999999", text: "My orange sofa and floral print", media_url: "https://example.com/other-art.jpg" } }] },
    entry_evidence: {},
  };
  const selected = selectAccountDraft(input, [{ slug: "custom-pillow", name: "Custom pillow cover" }], NOW);
  assert.equal(selected.status, "draft_ready");
  const choice = procedural(selectAccountDesign(selected));
  assert.equal(choice.recipeId, "warm-neutral");
  assert.deepEqual(choice.evidencePostIds, ["111111"]);
  assert.doesNotMatch(choice.designReason, /orange|floral|print/i);
});

test("gingerbread food does not match the gingerbread apartment artwork", () => {
  const apartment = selectAccountDesign(ready("I'm decorating my apartment as a gingerbread house."));
  assert.equal(apartment.kind, "seed");
  if (apartment.kind === "seed") assert.equal(apartment.designId, "gingerbread-v1");
  assert.equal(selectAccountDesign(ready("I ate gingerbread in my apartment.")).kind, "no_design_match");
});

test("unsettled palettes remain explicit proposals rather than chosen mixed colors", () => {
  const purpleOrPink = procedural(selectAccountDesign(ready("I want to paint my living room purple or pink.")));
  assert.equal(purpleOrPink.recipeId, "purple-option");
  assert.equal(purpleOrPink.matchType, "proposed_option");
  assert.match(purpleOrPink.designReason, /one purple option/i);

  const pinkBlueOrBlack = procedural(selectAccountDesign(ready(
    "I want to switch the aesthetic of my room. I want pink and blue or pink and black.",
  )));
  assert.equal(pinkBlueOrBlack.recipeId, "pink-blue");
  assert.equal(pinkBlueOrBlack.matchType, "proposed_option");

  const holiday = procedural(selectAccountDesign(ready(
    "For my living room holiday decor, should I go all gold or red and green?",
  )));
  assert.equal(holiday.recipeId, "gold-ivory");
  assert.equal(holiday.matchType, "proposed_option");
});

test("five composition families render reproducible and distinct PNG artwork", async () => {
  const examples = [
    ["I want to paint my bedroom pink.", "waves"],
    ["I'd like to paint my bedroom door light green.", "stripes"],
    ["I want to take the green out my living room and go with burnt orange.", "arches"],
    ["My room colors will be black, white, and gold.", "geometric"],
    ["I like the black nouvea theme for my bedroom.", "curves"],
  ] as const;
  const hashes = new Set<string>();
  for (const [source, expectedFamily] of examples) {
    const choice = procedural(selectAccountDesign(ready(source)));
    assert.equal(compositionFamilyForRecipe(choice.recipeId), expectedFamily, source);
    const first = await renderProceduralArtwork(choice);
    const second = await renderProceduralArtwork(choice);
    assert.deepEqual(first, second, `${expectedFamily} artwork must be reproducible`);
    assert.deepEqual([...first.slice(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
    hashes.add(createHash("sha256").update(first).digest("hex"));
  }
  assert.equal(hashes.size, 5);
});
