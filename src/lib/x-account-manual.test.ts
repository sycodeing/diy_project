import assert from "node:assert/strict";
import test from "node:test";
// @ts-expect-error Explicit extension for Node type stripping.
import { canonicalManualResultUrl, freshManualHelper, MANUAL_SENDER_ID, manualSenderMatches, manualReportError } from "./x-account-manual.ts";
// @ts-expect-error Explicit extension for Node type stripping.
import { manualRouteRevision } from "./x-account-manual-route.ts";

test("manual identity cannot silently switch to Latte or another enabled sender", () => {
  const sender = { id: MANUAL_SENDER_ID, account_key: "Le6wCummeratawi", active: true, network_mode: "fixed_proxy" };
  assert.equal(manualSenderMatches(sender), true);
  assert.equal(manualSenderMatches({ ...sender, account_key: "Latte192837465" }), false);
  assert.equal(manualSenderMatches({ ...sender, active: false }), false);
  assert.equal(manualSenderMatches({ ...sender, network_mode: "vpn_direct" }), false);
});
test("reported result must be an actual status URL under the fixed manual handle", () => {
  assert.equal(canonicalManualResultUrl("https://twitter.com/le6wcummeratawi/status/2124867220396441652?s=20"), "https://x.com/Le6wCummeratawi/status/2124867220396441652");
  for (const value of ["https://x.com/Latte192837465/status/2124867220396441652", "https://x.com/Le6wCummeratawi", "https://x.com.evil.test/Le6wCummeratawi/status/123456", "http://x.com/Le6wCummeratawi/status/123456"])
    assert.equal(canonicalManualResultUrl(value), null);
});
test("route changes invalidate reuse and offline/restarted helpers cannot authorize old requests", () => {
  const revision = manualRouteRevision(MANUAL_SENDER_ID, "cipher-a", "192.0.2.1");
  assert.notEqual(revision, manualRouteRevision(MANUAL_SENDER_ID, "cipher-b", "192.0.2.1"));
  assert.notEqual(revision, manualRouteRevision(MANUAL_SENDER_ID, "cipher-a", "192.0.2.2"));
  const now = Date.parse("2026-11-24T10:00:00Z");
  const helper = { boot_id: "test-boot", booted_at: new Date(now - 10000).toISOString(), last_seen_at: new Date(now).toISOString(), status: "online" };
  assert.equal(freshManualHelper(helper, now), true);
  assert.equal(freshManualHelper({ ...helper, status: "stopped" }, now), false);
  assert.equal(freshManualHelper(helper, now + 45001), false);
});
test("preview reports require explicit upload declaration while text does not", () => {
  const base = { resultUrl: "https://x.com/Le6wCummeratawi/status/123456789", personallySent: true, previewUploaded: false };
  assert.match(manualReportError({ ...base, contentMode: "account_product_preview" }) ?? "", /上传/);
  assert.equal(manualReportError({ ...base, previewUploaded: true, contentMode: "account_product_preview" }), null);
  assert.equal(manualReportError({ ...base, contentMode: "account_product_link" }), null);
});
