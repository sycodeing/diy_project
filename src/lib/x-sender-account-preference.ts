// Keep the existing key so selections saved by the original candidates page still apply.
export const X_SENDER_ACCOUNT_KEY = "diyproject:x-auto-default-account-id";
const CHANGE_EVENT = "diyproject:x-auto-default-account-changed";
let sessionSelection = "";

export function readXSenderAccountPreference(): string {
  try {
    return window.localStorage.getItem(X_SENDER_ACCOUNT_KEY) ?? "";
  } catch {
    return sessionSelection;
  }
}

export function setXSenderAccountPreference(accountId: string) {
  sessionSelection = accountId;
  try {
    window.localStorage.setItem(X_SENDER_ACCOUNT_KEY, accountId);
  } catch { /* Selection still works for this session if storage is unavailable. */ }
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

export function subscribeXSenderAccountPreference(onChange: () => void) {
  const onStorage = (event: StorageEvent) => {
    if (event.key === X_SENDER_ACCOUNT_KEY || event.key === null) onChange();
  };
  window.addEventListener("storage", onStorage);
  window.addEventListener(CHANGE_EVENT, onChange);
  return () => {
    window.removeEventListener("storage", onStorage);
    window.removeEventListener(CHANGE_EVENT, onChange);
  };
}

export function resolveXSenderAccountId(savedId: string, accounts: ReadonlyArray<{ id: string }>) {
  return accounts.some((account) => account.id === savedId) ? savedId : accounts[0]?.id ?? "";
}
