import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { compositionFamilyForRecipe, renderProceduralArtwork } from "./x-account-design-recipes";
import { selectAccountDesign, type DesignChoice } from "./x-account-design-selector";
import { selectAccountDraft, type AccountDraftInput, type DraftSelection, type OwnPost } from "./x-lead-account-draft";

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
  const choice = selectAccountDesign(ready(
    "I can't decide what color my living room should be.",
    [ownPost("222222", "My bedroom is green.")],
  ));
  assert.equal(choice.kind, "no_design_match");
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
