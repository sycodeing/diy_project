"use client";

import { useSyncExternalStore } from "react";
import {
  readXSenderAccountPreference,
  resolveXSenderAccountId,
  setXSenderAccountPreference,
  subscribeXSenderAccountPreference,
} from "./x-sender-account-preference";

const serverSnapshot = () => "";

export function useXSenderAccount(accounts: ReadonlyArray<{ id: string }>) {
  const savedId = useSyncExternalStore(subscribeXSenderAccountPreference, readXSenderAccountPreference, serverSnapshot);
  return [resolveXSenderAccountId(savedId, accounts), setXSenderAccountPreference] as const;
}
