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
  assert.match(copy, /sofa color or pattern/);
  assert.match(copy, /printed pillow cover/);
  assert.match(copy, /Make it yours with your own image.*Preview & order/);
  assert.doesNotMatch(copy, /already made|exclusive|one.of.a.kind|\$/i);
});

test("an owned room palette or theme can suggest a cover without a buying or pillow request", () => {
  const scenes = [
    "So happy I stole Tijami idea and did a neutral color Christmas tree with a pop of olive. It match my living room so well lol I’m ready to finish it",
    "I’m trying figure out what color my living room finna be . Cause my room definitely green 😂🤣",
    "I like the black nouvea theme for my bedroom.",
  ];
  const expectedAngles = [/neutral tree.*olive accent/, /living room color.*swatches/, /black nouveau bedroom/];
  for (const [index, text] of scenes.entries()) {
    const result = select(account(post(String(111111 + index), text)));
    assert.equal(result.status, "draft_ready", text);
    assert.equal(result.productSlug, "custom-pillow");
    assert.match(result.productMatchReason ?? "", /条件式软装用途建议/);
    const reply = createAccountReply(result, "https://example.com/g/abc1234567", false);
    assert.match(reply, expectedAngles[index]);
    assert.match(reply, /your own image.*Preview & order/);
    assert.doesNotMatch(reply, /already made|exclusive|one.of.a.kind|\$/i);
    assert.ok(reply.length <= 280);
  }
});

test("named colors and a named room style in actual personal projects support conditional drafts", () => {
  const scenes = [
    "i'd like to paint the inside of my bedroom door a light green. an accent door, if you will",
    "I get to paint my living room and I can’t decide if I want purple or pink. Then I need to find a new couch. I’m so excited.",
    "I want to take the green out my living room and go with burnt orange.",
    "Idk if I wanna do my tree and holiday decor all gold to match my living room decor? Or if I wanna go red, green and gold?",
    "Tbh I am considering redecorating my room to be cabin core with a pinch of winter",
  ];
  const angles = [/green bedroom/, /living room palette you're changing or considering/, /living room palette you're changing or considering/, /gold accents in your living room/, /cabin core direction/];
  for (const [index, text] of scenes.entries()) {
    const result = select(account(post(String(111111 + index), text)));
    assert.equal(result.status, "draft_ready", text);
    assert.match(result.conversationAngle ?? "", angles[index]);
    assert.ok(createAccountReply(result, "https://www.pattayamade.com/g/abcdefghij", true).length <= 280);
  }
  const switching = select(account(post("333333", "I think I want to switch my whole aesthetic of my room. I don't want nature vibes anymore. I want pink and blue or pink and black.")));
  assert.equal(switching.status, "draft_ready");
  assert.match(switching.conversationAngle ?? "", /room palette you're changing or considering/);
  const painted = select(account(post("444444", "I’m considering using the time to paint my room 😭 I have four different colored walls w/ purple trim but it’s also so dark in here… yearning for the aesthetic white room")));
  assert.equal(painted.status, "draft_ready");
  assert.match(painted.conversationAngle ?? "", /room palette you're changing or considering/);
});

test("room words without a personal decor palette do not force a pillow suggestion", () => {
  for (const text of [
    "I watched a TV color test in my bedroom.",
    "I'm painting my room in GTA with a blue theme.",
    "Tomorrow I'm decorating my room.",
    "I relaxed in my room after work.",
    "I am building a gallery wall for my family photos.",
    "I feel blue after relaxing in my bedroom.",
    "My bedroom went black when the power went out.",
    "I painted my bedroom blue in GTA.",
  ]) assert.equal(select(account(post("111111", text))).status, "no_match", text);
  assert.equal(select(account(post("111111", "I'm decorating my real bedroom with a green theme for GTA."))).status, "draft_ready");
});

test("specific image placement outranks newer generic sofa styling", () => {
  const result = select(account(
    post("111111", "I'm arranging my sofa cushions with a blue pattern.", 1),
    post("222222", "I made a photo collage of my dog for our reading corner.", 2),
  ));
  assert.equal(result.selectedPost?.post_id, "222222");
  assert.equal(result.matchStrength, 2);
  assert.match(createAccountReply(result, "https://example.com/g/abc1234567", false), /photo-and-pillow idea in your reading corner.*your own image.*pillow cover/);
});

test("wall art, accidental word co-occurrence, and third-party or stale posts do not force a pillow", () => {
  assert.equal(select(account(post("111111", "I am building a gallery wall for my family photos."))).status, "no_match");
  assert.equal(select(account(post("111111", "I drew my friend's portrait while sitting on my sofa."))).status, "no_match");
  assert.equal(select(account(post("111111", "I'm arranging my sofa cushions with a blue pattern.", 20))).status, "evidence_pending");
  assert.equal(select(account(post("111111", "I'm arranging my sofa cushions with a blue pattern.", 1,
    { author_id: "999999999" }))).status, "evidence_pending");
  const quotedContext = post("111111", "I like this", 1,
    { quoted_tweet: { id: "222222", text: "I am arranging my sofa cushions with a blue pattern." } });
  assert.equal(select(account(quotedContext)).status, "no_match");
  const ownQuote = post("333333", "Dark and moody is the color scheme I’m leaning more into for my living room.", 1,
    { quoted_tweet: { id: "222222", text: "How my room is going" } });
  assert.equal(select(account(ownQuote)).selectedPost?.is_quote, true);
  assert.equal(select(account(ownQuote)).productSlug, "custom-pillow");
});

test("own-room palette and adjacent aesthetic wish can support a conditional draft without quoted artwork", () => {
  const own = post("111111", "My living room is so beige. I high key want some warmth like this.", 1,
    { quoted_tweet: { id: "222222", text: "Here's my orange sofa and print." } });
  const chosen = select(account(own));
  assert.equal(chosen.status, "draft_ready");
  assert.equal(chosen.selectedPost?.is_quote, true);
  assert.match(chosen.conversationAngle ?? "", /new look/);
  const cooler = select(account(post("333333", "My bedroom looks too orange. I want a cooler look like this.")));
  assert.equal(cooler.status, "draft_ready");
  assert.doesNotMatch(cooler.conversationAngle ?? "", /warmer/);
  for (const text of [
    "My living room is freezing. I want warmth.",
    "I wore beige in my living room. I want warmth.",
    "I love this.",
  ]) {
    const value = post("111111", text, 1,
      { quoted_tweet: { id: "222222", text: "My living room is beige. I want a warmer look." } });
    assert.equal(select(account(value)).status, "no_match", text);
  }
});

test("one author's ongoing room project may use a distinct earlier palette post without merging quotes", () => {
  const older = post("111111", "Finished off my living room I just need one more thing I think &amp; some pink curtains .", 3);
  const current = post("222222", "Everybody sliding up in my living room && I’m not even done yet. Guess that means I’m off to a good start with this redecoration .", 1);
  const chosen = select(account(older, current));
  assert.equal(chosen.status, "draft_ready");
  assert.equal(chosen.selectedPost?.post_id, "222222");
  assert.deepEqual(chosen.supportingPostIds, ["111111"]);
  assert.match(chosen.productMatchReason ?? "", /111111.*222222|222222.*111111/);
  assert.match(createAccountReply(chosen, "https://www.pattayamade.com/g/abcdefghij", true), /Pink curtains.*unfinished living room.*pillow cover/);

  const otherRoom = select(account(post("111111", "I want pink curtains for my bedroom.", 3), current));
  assert.equal(otherRoom.status, "no_match");
  const quoted = select(account(post("111111", "I like this", 3,
    { quoted_tweet: { text: "Pink curtains for my living room" } }), current));
  assert.equal(quoted.status, "no_match");
  assert.equal(select(account(older, current, post("333333", "Not interested in cushions or recommendations.", 0.5))).status, "blocked");
  assert.equal(select(account(older, current, post("333333", "My custom pillow covers arrived today.", 0.5))).status, "blocked");
  assert.equal(select(account(post("111111", "Pink curtains for my room in GTA.", 3),
    post("222222", "I'm still decorating my room.", 1))).status, "no_match");
});

test("an apartment palette project uses the apartment as the reply context", () => {
  for (const text of [
    "Can’t wait to decorate my apartment next month. I want beige, light pink &amp; gold decor like everythings gonna be so cute &amp; girly",
    "my apartment is coming together so pretty so pink everywhere",
  ]) {
    const chosen = select(account(post("111111", text)));
    assert.equal(chosen.status, "draft_ready", text);
    assert.match(chosen.conversationAngle ?? "", /apartment/);
    assert.doesNotMatch(chosen.conversationAngle ?? "", /bedroom/);
  }
  assert.equal(select(account(post("111111", "I'm staying in a pink apartment on vacation."))).status, "no_match");
  const motif = select(account(post("222222", "Decorating my apartment as a gingerbread house &amp; I’m so excited 😊")));
  assert.equal(motif.status, "draft_ready");
  assert.match(motif.conversationAngle ?? "", /gingerbread house direction.*apartment/);
  assert.equal(select(account(post("333333", "I ate gingerbread in my apartment."))).status, "no_match");
  assert.equal(select(account(post("444444", "I'm decorating a gingerbread house in my apartment."))).status, "no_match");
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
  const url = "https://www.thebestdiyshop.com/g/abcdefghij";
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
      if (!offer) assert.doesNotMatch(reply, /25% off/);
      assert.match(reply, /Preview & order: https:\/\/www\.thebestdiyshop\.com\/g\/abcdefghij/);
      assert.doesNotMatch(reply, /exclusive|one.of.a.kind|already made for you|\$/i);
    }
  }
  assert.match(createAccountReply(scenes[2], url, false), /custom face towel/);
});

test("original sample copy states the reviewed design direction without claiming prospect artwork", () => {
  const scenes = [
    { text: "Decorating my apartment as a gingerbread house &amp; I’m so excited 😊",
      visibleMotifs: "iced houses and candy canes", designReason: "echoing your gingerbread theme", word: /gingerbread-house/ },
    { text: "I did a neutral color Christmas tree with a pop of olive. It match my living room so well",
      visibleMotifs: "olive foliage and pale berries", designReason: "echoing the olive tree accent", word: /neutral tree's olive accent/ },
    { text: "I am considering redecorating my room to be cabin core with a pinch of winter",
      visibleMotifs: "snowy cabins, pines and woodland animals", designReason: "exploring a fuller winter direction", word: /sample leans snowy/ },
  ];
  for (const [index, scene] of scenes.entries()) {
    const selection = select(account(post(String(999990 + index), scene.text)));
    assert.equal(selection.status, "draft_ready", scene.text);
    const reply = createAccountReply(selection, "https://www.thebestdiyshop.com/g/abcdefghij", true,
      { preview: { visibleMotifs: scene.visibleMotifs, designReason: scene.designReason } });
    assert.match(reply, scene.word);
    assert.match(reply, new RegExp(scene.designReason));
    assert.match(reply, /Custom pillow cover idea/);
    assert.match(reply, /Make it yours: use this print or (upload )?your own/);
    assert.ok(reply.length <= 280, `${index}: ${reply.length}`);
    assert.doesNotMatch(reply, /your photo|your design|already made for you|\$/i);
  }
});
