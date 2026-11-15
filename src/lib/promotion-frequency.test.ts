import assert from "node:assert/strict";
import test from "node:test";
import { localDateKey, wasPromotionDismissedToday } from "./promotion-frequency";

test("dismissal suppresses the offer for the browser's current calendar day", () => {
  const today = new Date(2026, 10, 15, 23, 59);
  const tomorrow = new Date(2026, 10, 16, 0, 1);
  const dismissedDate = localDateKey(today);

  assert.equal(wasPromotionDismissedToday(dismissedDate, today), true);
  assert.equal(wasPromotionDismissedToday(dismissedDate, tomorrow), false);
  assert.equal(wasPromotionDismissedToday(null, today), false);
});
