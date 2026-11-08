import assert from "node:assert/strict";
import test from "node:test";
import {
  getXApprovalBlockReason,
  isBoundProxyEgress,
  isXAccountClaimEligible,
  isXDailyGateClaimAllowed,
  isXJobClaimEligible,
  type ApprovalSafetyInput,
  type ClaimSafetyInput,
} from "./x-reply-safety.ts";

const nowMillis = Date.parse("2026-10-31T02:00:00.000Z");

function healthyInput(): ApprovalSafetyInput {
  return {
    jobStatus: "draft",
    preparationStatus: "ready",
    nowMillis,
    account: {
      active: true,
      accountKey: "pet_account",
      executorId: "macbook-x-01",
      networkMode: "vpn_direct",
      expectedEgressIp: "203.0.113.10",
      verificationStatus: "passed",
      proxyStatus: null,
    },
    worker: {
      lastSeenAt: "2026-10-31T01:59:00.000Z",
      xuseAvailable: true,
      configuredAccounts: ["pet_account"],
      currentEgressIp: "203.0.113.10",
      networkProbeStatus: "healthy",
    },
  };
}

test("vpn_direct cannot be approved before an administrator locks the egress IP", () => {
  const input = healthyInput();
  input.account!.expectedEgressIp = null;
  assert.match(getXApprovalBlockReason(input) ?? "", /尚未.*锁定/);
});

test("vpn_direct cannot be approved when the live browser egress changes", () => {
  const input = healthyInput();
  input.worker!.currentEgressIp = "203.0.113.11";
  const reason = getXApprovalBlockReason(input) ?? "";
  assert.match(reason, /203\.0\.113\.11/);
  assert.match(reason, /203\.0\.113\.10/);
  assert.match(reason, /X 账号\/IP/);
});

test("an executor mismatch or missing local x-use account blocks approval", () => {
  const input = healthyInput();
  input.worker!.configuredAccounts = [];
  assert.match(getXApprovalBlockReason(input) ?? "", /不存在/);
});

test("fixed_proxy requires a configured non-error route", () => {
  const input = healthyInput();
  input.account!.networkMode = "fixed_proxy";
  input.account!.expectedEgressIp = null;
  input.account!.verificationStatus = "unverified";
  assert.match(getXApprovalBlockReason(input) ?? "", /账号与 IP 映射验证/);
  input.account!.verificationStatus = "running";
  assert.match(getXApprovalBlockReason(input) ?? "", /尚未配置代理/);
  input.account!.verificationStatus = "passed";
  assert.match(getXApprovalBlockReason(input) ?? "", /尚未配置代理/);
  input.account!.proxyStatus = "error";
  assert.match(getXApprovalBlockReason(input) ?? "", /异常/);
});

test("a fresh healthy vpn_direct executor passes the approval safety gate", () => {
  assert.equal(getXApprovalBlockReason(healthyInput()), null);
});

function healthyClaim(): ClaimSafetyInput {
  return {
    executionMode: "send",
    executorId: "macbook-x-01",
    xuseAvailable: true,
    configuredAccounts: ["pet_account"],
    currentEgressIp: "203.0.113.10",
    networkProbeStatus: "healthy",
    account: {
      executorId: "macbook-x-01",
      accountKey: "pet_account",
      networkMode: "vpn_direct",
      expectedEgressIp: "203.0.113.10",
      verificationStatus: "passed",
      hasProxy: false,
      proxyStatus: null,
    },
  };
}

test("observe, executor mismatch, and missing local account all block claims", () => {
  const observe = healthyClaim();
  observe.executionMode = "observe";
  assert.equal(isXAccountClaimEligible(observe), false);
  const mismatch = healthyClaim();
  mismatch.account.executorId = "another-mac";
  assert.equal(isXAccountClaimEligible(mismatch), false);
  const missing = healthyClaim();
  missing.configuredAccounts = [];
  assert.equal(isXAccountClaimEligible(missing), false);
});

test("vpn_direct requires a locked matching healthy browser egress before claim", () => {
  const unlocked = healthyClaim();
  unlocked.account.expectedEgressIp = null;
  assert.equal(isXAccountClaimEligible(unlocked), false);
  const changed = healthyClaim();
  changed.currentEgressIp = "203.0.113.11";
  assert.equal(isXAccountClaimEligible(changed), false);
});

test("fixed_proxy cannot claim without a non-error proxy", () => {
  const input = healthyClaim();
  input.account.networkMode = "fixed_proxy";
  input.account.expectedEgressIp = null;
  input.account.verificationStatus = "unverified";
  assert.equal(isXAccountClaimEligible(input), false);
  input.account.verificationStatus = "passed";
  input.account.hasProxy = true;
  input.account.proxyStatus = "error";
  assert.equal(isXAccountClaimEligible(input), false);
  input.account.proxyStatus = "pending";
  assert.equal(isXAccountClaimEligible(input), true);
});

test("fixed proxy egress is pinned after the first confirmed browser probe", () => {
  assert.equal(isBoundProxyEgress(null, "198.51.100.7"), true);
  assert.equal(isBoundProxyEgress("198.51.100.7", "198.51.100.7"), true);
  assert.equal(isBoundProxyEgress("198.51.100.7", "198.51.100.8"), false);
});

test("attempt_count and approval state prevent duplicate claims", () => {
  const input = {
    status: "queued",
    preparationStatus: "ready",
    attemptCount: 0,
    approvedAt: "2026-10-31T01:00:00.000Z",
    scheduledFor: "2026-10-31T01:30:00.000Z",
    nowMillis,
  };
  assert.equal(isXJobClaimEligible(input), true);
  assert.equal(isXJobClaimEligible({ ...input, attemptCount: 1 }), false);
  assert.equal(isXJobClaimEligible({ ...input, approvedAt: null }), false);
  assert.equal(isXJobClaimEligible({ ...input, status: "claimed" }), false);
});

test("daily first-success gate pauses later jobs until explicit authorization", () => {
  assert.equal(isXDailyGateClaimAllowed(true, "pending"), true);
  assert.equal(isXDailyGateClaimAllowed(true, "awaiting_confirmation"), false);
  assert.equal(isXDailyGateClaimAllowed(true, "paused"), false);
  assert.equal(isXDailyGateClaimAllowed(true, "authorized"), true);
  assert.equal(isXDailyGateClaimAllowed(false, "awaiting_confirmation"), true);
});
