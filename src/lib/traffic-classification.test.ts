import assert from "node:assert/strict";
import test from "node:test";
import { classifyDevice, classifyReferrer, classifyTraffic } from "./traffic-classification";

test("classifies common device families without storing raw identifiers", () => {
  assert.equal(classifyDevice("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)"), "mobile");
  assert.equal(classifyDevice("Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X)"), "tablet");
  assert.equal(classifyDevice("Mozilla/5.0 (Linux; Android 14; SM-X710) AppleWebKit/537.36"), "tablet");
  assert.equal(classifyDevice("Mozilla/5.0 (Windows NT 10.0; Win64; x64)"), "desktop");
});

test("groups referrers into privacy-bounded buckets", () => {
  assert.equal(classifyReferrer("https://t.co/abc", "https://www.thebestdiyshop.com"), "x");
  assert.equal(classifyReferrer("https://www.google.com/search?q=pillow", "https://www.thebestdiyshop.com"), "search");
  assert.equal(classifyReferrer("https://www.thebestdiyshop.com/products", "https://www.thebestdiyshop.com"), "internal");
  assert.equal(classifyReferrer(null, "https://www.thebestdiyshop.com"), "direct");
});

test("marks common preview crawlers and headless verification", () => {
  const headers = new Headers({ "user-agent": "Twitterbot/1.0", referer: "https://t.co/a" });
  const result = classifyTraffic(headers, "https://www.thebestdiyshop.com");
  assert.equal(result.suspectedBot, true);
  assert.equal(result.referrerGroup, "x");
});
