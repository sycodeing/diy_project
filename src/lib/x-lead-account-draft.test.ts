import assert from "node:assert/strict";
import test from "node:test";
import { createAccountReply, selectAccountDraft, type AccountDraftInput, type ActiveDraftProduct } from "./x-lead-account-draft.ts";
import { canAdvertiseFirstOrder25 } from "./x-lead-copy.ts";

const NOW = new Date("2026-11-22T12:00:00Z");
const products: ActiveDraftProduct[] = [{ slug: "custom-pillow", name: "Custom photo pillow cover" },
  { slug: "face-towel", name: "Custom face towel" }];
const post = (id: string, text: string, days = 1, extra: Record<string, unknown> = {}) => ({
  post_id: id, author_id: "123456789", created_at: new Date(NOW.getTime() - days * 86_400_000).toISOString(),
  text, source: "recent", direct_parent_status: "own_recent_post", ...extra,
});
function account(...posts: Array<ReturnType<typeof post>>): AccountDraftInput {
  return { author_id: "123456789", account_status: "watch", entry_status: "ready", review_status: "unreviewed",
    account_evidence: { own_post_ids: posts.map((item) => item.post_id), own_posts: posts }, entry_evidence: {} };
}
const select = (value: AccountDraftInput, available = products) => selectAccountDraft(value, available, NOW);

test("a non-buying sofa style project can yield a conditional review draft", () => {
  const result = select(account(post("111111", "I'm arranging my sofa cushions with a blue pattern.")));
  assert.equal(result.status, "draft_ready");
  assert.equal(result.productSlug, "custom-pillow");
  const copy = createAccountReply(result, "https://example.com/g/abc1234567", false);
  assert.match(copy, /cushion colors and patterns/);
  assert.match(copy, /could be one option/);
  assert.doesNotMatch(copy, /preview|already made|\$/i);
});

test("specific image placement outranks newer generic sofa styling", () => {
  const result = select(account(
    post("111111", "I'm arranging my sofa cushions with a blue pattern.", 1),
    post("222222", "I made a photo collage of my dog for our reading corner.", 2),
  ));
  assert.equal(result.selectedPost?.post_id, "222222");
  assert.equal(result.matchStrength, 2);
});

test("wall art, accidental word co-occurrence, and third-party or stale posts do not force a pillow", () => {
  assert.equal(select(account(post("111111", "I am building a gallery wall for my family photos."))).status, "no_match");
  assert.equal(select(account(post("111111", "I drew my friend's portrait while sitting on my sofa."))).status, "no_match");
  assert.equal(select(account(post("111111", "I'm arranging my sofa cushions with a blue pattern.", 20))).status, "evidence_pending");
  assert.equal(select(account(post("111111", "I'm arranging my sofa cushions with a blue pattern.", 1,
    { author_id: "999999999" }))).status, "evidence_pending");
  assert.equal(select(account(post("111111", "I'm arranging my sofa cushions with a blue pattern.", 1,
    { quoted_tweet: { id: "222222" } }))).status, "evidence_pending");
});

test("reply needs a verified direct parent and own ID; legacy sparse evidence is partial", () => {
  const text = "I'm arranging my sofa cushions with a blue pattern.";
  assert.equal(select(account(post("111111", text, 1, { source: "reply", direct_parent_status: undefined }))).status, "evidence_pending");
  const legacy = account();
  legacy.account_evidence = { own_post_ids: ["111111"], project_evidence: [post("111111", text)] };
  const result = select(legacy);
  assert.equal(result.status, "draft_ready");
  assert.equal(result.evidenceCoverage, "partial");
  legacy.account_evidence = { own_post_ids: ["999999"], project_evidence: [post("111111", text)] };
  assert.equal(select(legacy).status, "evidence_pending");
});

test("completed same product, refusal, sensitive context and human dismissal block", () => {
  assert.equal(select(account(post("111111", "I finished cushions with a blue pattern for my sofa."))).status, "blocked");
  assert.equal(select(account(post("111111", "I'm decorating my sofa cushions, but not interested in cushions."))).status, "blocked");
  assert.equal(select(account(post("111111", "I'm arranging sofa cushions while grieving my dog's death."))).status, "blocked");
  assert.equal(select(account(post("111111", "I'm arranging my sofa cushions with a blue pattern.", 2),
    post("222222", "I finished cushions for the sofa today.", 1))).status, "blocked");
  assert.equal(select(account(post("111111", "I'm arranging my sofa cushions with a blue pattern.", 2),
    post("222222", "I'm not interested in cushions anymore.", 1))).status, "blocked");
  assert.equal(select(account(post("111111", "I'm arranging my sofa cushions with a blue pattern.", 2),
    post("222222", "I'm not looking for recommendations.", 1))).status, "blocked");
  assert.equal(select(account(post("111111", "I'm arranging my sofa cushions with a blue pattern.", 2),
    post("222222", "Please don't suggest anything.", 1))).status, "blocked");
  const dismissed = account(post("111111", "I'm arranging my sofa cushions with a blue pattern."));
  dismissed.review_status = "dismissed";
  assert.equal(select(dismissed).status, "blocked");
  dismissed.review_status = "unreviewed";
  dismissed.entry_status = "hold";
  assert.equal(select(dismissed).status, "blocked");
});

test("face towel requires the supported product and a specific personalization context", () => {
  assert.equal(select(account(post("111111", "I designed a photo for my face towel."))).productSlug, "face-towel");
  assert.equal(select(account(post("111111", "I designed a photo for my beach towel."))).status, "no_match");
  assert.equal(select(account(post("111111", "I embroidered a face towel for my mum."))).status, "no_match");
  assert.equal(select(account(post("111111", "I'm designing an embroidered face towel for my mum."))).status, "no_match");
  assert.equal(select(account(post("111111", "I designed a photo for my face towel.")), products.slice(0, 1)).status, "no_match");
});

test("25% statement is based on the selected product variants, without product prices", () => {
  const result = select(account(post("111111", "I'm arranging my sofa cushions with a blue pattern.")));
  assert.equal(canAdvertiseFirstOrder25({ priceCents: 1000, currency: "usd" }, [
    { price_cents: 1400, currency: "usd" }, { price_cents: 1500, currency: "usd" }]), true);
  assert.equal(canAdvertiseFirstOrder25({ priceCents: 1000, currency: "usd" }, [
    { price_cents: 1400, currency: "usd" }, { price_cents: 1200, currency: "usd" }]), false);
  assert.match(createAccountReply(result, "https://example.com/g/abc1234567", true), /25% off/);
});

test("all supported scene replies fit X with a production-length short link and either offer state", () => {
  const url = "https://www.pattayamade.com/g/abcdefghij";
  const scenes = [
    select(account(post("111111", "I made a photo collage of my dog for our reading corner."))),
    select(account(post("222222", "I'm arranging my sofa cushions with a blue pattern."))),
    select(account(post("333333", "I designed a photo for my face towel."))),
  ];
  for (const scene of scenes) {
    assert.equal(scene.status, "draft_ready");
    for (const offer of [false, true]) {
      const reply = createAccountReply(scene, url, offer);
      assert.ok(reply.length <= 280, `${scene.productSlug} reply length ${reply.length}`);
      assert.equal(reply.includes("25% off"), offer);
    }
  }
  assert.match(createAccountReply(scenes[2], url, false), /personalized face towel/);
});
