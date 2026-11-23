import assert from "node:assert/strict";
import test from "node:test";
import {
  X_SENDER_ACCOUNT_KEY, readXSenderAccountPreference, resolveXSenderAccountId,
  setXSenderAccountPreference, subscribeXSenderAccountPreference,
} from "./x-sender-account-preference";

test("candidate cards share a preference, retain it on remount, and react to another browser tab", () => {
  const events = new EventTarget();
  const values = new Map<string, string>([[X_SENDER_ACCOUNT_KEY, "sender-b"]]);
  const browser = Object.assign(events, { localStorage: {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
  } });
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", { value: browser, configurable: true });
  const accounts = [{ id: "sender-a" }, { id: "sender-b" }];
  const selected = () => resolveXSenderAccountId(readXSenderAccountPreference(), accounts);
  let cardA = selected();
  let cardB = selected();
  const unsubscribeA = subscribeXSenderAccountPreference(() => { cardA = selected(); });
  const unsubscribeB = subscribeXSenderAccountPreference(() => { cardB = selected(); });
  try {
    assert.equal(cardA, "sender-b", "reuses the original candidates page's saved key");
    setXSenderAccountPreference("sender-a");
    assert.equal(cardA, "sender-a");
    assert.equal(cardB, "sender-a");
    assert.equal(selected(), "sender-a", "new cards and pages read the same selection");
    const storageEvent = (key: string | null) => Object.assign(new Event("storage"), { key });
    values.set(X_SENDER_ACCOUNT_KEY, "sender-b");
    browser.dispatchEvent(storageEvent("unrelated-key"));
    assert.equal(cardA, "sender-a");
    browser.dispatchEvent(storageEvent(X_SENDER_ACCOUNT_KEY));
    assert.equal(cardA, "sender-b");
    assert.equal(cardB, "sender-b");
    values.clear();
    browser.dispatchEvent(storageEvent(null));
    assert.equal(cardB, "sender-a", "cleared preferences fall back to an enabled account");
    unsubscribeB();
    setXSenderAccountPreference("sender-b");
    assert.equal(cardA, "sender-b");
    assert.equal(cardB, "sender-a", "unmounted cards unsubscribe");
    Object.defineProperty(browser, "localStorage", { get() { throw new Error("Storage disabled"); } });
    setXSenderAccountPreference("sender-a");
    assert.equal(readXSenderAccountPreference(), "sender-a");
    assert.equal(cardA, "sender-a", "selection still synchronizes without browser storage");
  } finally {
    unsubscribeA(); unsubscribeB();
    if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow);
    else Reflect.deleteProperty(globalThis, "window");
  }
});

test("disabled or removed sender selections fall back without overwriting the stored preference", () => {
  assert.equal(resolveXSenderAccountId("disabled-sender", [{ id: "enabled-sender" }]), "enabled-sender");
  assert.equal(resolveXSenderAccountId("sender-b", [{ id: "sender-a" }, { id: "sender-b" }]), "sender-b");
  assert.equal(resolveXSenderAccountId("sender-b", []), "");
});
