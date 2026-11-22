import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";
import { hashMarketingToken } from "./marketing.ts";
import { createAccountReply, selectAccountDraft } from "./x-lead-account-draft.ts";
import { isValidV2ReplyText, supportsXReplyV2Worker, validateV2Evidence, type V2EvidenceInput } from "./x-reply-v2.ts";

const now = new Date("2026-11-22T12:00:00Z");
const secret = "test-secret-not-for-production";
const token = "abcdefghij";
const appUrl = "https://www.thebestdiyshop.com";
const marketingUrl = `${appUrl}/g/${token}`;
const products = [{ slug: "custom-pillow", name: "Custom pillow cover", variants: [{ price_cents: 2900, currency: "USD" }] }];
const post = { post_id: "1234567890", author_id: "987654321", created_at: "2026-11-21T12:00:00Z",
  text: "I'm arranging my sofa cushions with a blue pattern.", source: "recent", direct_parent_status: "own_recent_post" };
const account = { author_id: post.author_id, x_handle: "room_owner", account_status: "watch", entry_status: "ready",
  review_status: "unreviewed", account_evidence: { own_post_ids: [post.post_id], own_posts: [post] }, entry_evidence: {} };
const selection = selectAccountDraft(account, products, now);
assert.equal(selection.status, "draft_ready");
const replyText = createAccountReply(selection, marketingUrl, false);

function validInput(): V2EvidenceInput {
  return {
    job: { id: "job-1", queue_version: 2, content_mode: "account_product_link", target_author_id: post.author_id,
      account_draft_author_id: post.author_id, marketing_link_id: "link-1", source_post_id: post.post_id,
      draft_generated_at: "2026-11-22T11:00:00Z", target_post_url: `https://x.com/room_owner/status/${post.post_id}`, reply_text: replyText },
    account: structuredClone(account), draft: { author_id: post.author_id, status: "draft_ready", review_status: "unreviewed",
      selected_post_id: post.post_id, product_slug: "custom-pillow", reply_text: replyText,
      marketing_link_id: "link-1", marketing_url: marketingUrl, marketing_expires_at: "2026-12-01T00:00:00Z",
      generated_at: "2026-11-22T11:00:00Z" },
    link: { channel: "public_reply", product_slug: "custom-pillow", x_post_id: post.post_id,
      x_author_hash: createHmac("sha256", secret).update(`x-author:${post.author_id}`).digest("hex"),
      source_image_url: null, token_hash: hashMarketingToken(token), expires_at: "2026-12-01T00:00:00Z" },
    products: structuredClone(products), promotion: null, now, appUrl, secret,
  };
}

test("V2 accepts a current owned post, active product and one approved tracked link", () => {
  assert.equal(validateV2Evidence(validInput()), null);
  assert.equal(isValidV2ReplyText(replyText, marketingUrl), true);
  assert.equal(supportsXReplyV2Worker("4.10.1-first-contact"), false);
  assert.equal(supportsXReplyV2Worker("4.11.0-account-product-link"), true);
});

test("V2 blocks changed drafts, stale evidence, wrong link and inactive product", () => {
  const changed = validInput(); changed.draft.reply_text = "replaced after approval";
  assert.match(validateV2Evidence(changed) ?? "", /草稿已变更/);
  const stale = validInput(); stale.account.account_evidence.own_posts[0] = { ...post, created_at: "2026-10-01T00:00:00Z" };
  assert.match(validateV2Evidence(stale) ?? "", /过期/);
  const badLink = validInput(); badLink.link.x_post_id = "9999";
  assert.match(validateV2Evidence(badLink) ?? "", /链接/);
  const inactive = validInput(); inactive.products = [];
  assert.match(validateV2Evidence(inactive) ?? "", /商品已下架/);
});

test("V2 blocks dismissed accounts and unsupported replies while V1 cannot claim its mode", () => {
  const dismissed = validInput(); dismissed.account.review_status = "dismissed";
  assert.match(validateV2Evidence(dismissed) ?? "", /忽略/);
  const wrongAuthor = validInput(); wrongAuthor.job.target_author_id = "111111111";
  assert.notEqual(validateV2Evidence(wrongAuthor), null);
  const extraLink = validInput(); extraLink.job.reply_text += " https://example.com/g/extra12345";
  assert.notEqual(validateV2Evidence(extraLink), null);
});
