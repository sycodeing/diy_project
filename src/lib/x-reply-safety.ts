export type ApprovalSafetyInput = {
  jobStatus: string;
  preparationStatus: string;
  account: null | {
    active: boolean;
    accountKey: string;
    executorId: string | null;
    networkMode: string;
    expectedEgressIp: string | null;
    verificationStatus: string;
    proxyStatus: string | null;
  };
  worker: null | {
    lastSeenAt: string;
    xuseAvailable: boolean;
    configuredAccounts: string[];
    currentEgressIp: string | null;
    networkProbeStatus: string;
  };
  nowMillis: number;
};

export type ClaimSafetyInput = {
  executionMode: string;
  executorId: string;
  xuseAvailable: boolean;
  configuredAccounts: string[];
  currentEgressIp: string | null;
  networkProbeStatus: string;
  account: {
    executorId: string | null;
    accountKey: string;
    networkMode: string;
    expectedEgressIp: string | null;
    verificationStatus: string;
    hasProxy: boolean;
    proxyStatus: string | null;
  };
};

export type JobClaimSafetyInput = {
  status: string;
  preparationStatus: string;
  attemptCount: number;
  approvedAt: string | null;
  scheduledFor: string;
  nowMillis: number;
};

export function isXDailyGateClaimAllowed(requiresConfirmation: boolean, status: string | null | undefined): boolean {
  return !requiresConfirmation || status == null || status === "pending" || status === "authorized";
}

export function isBoundProxyEgress(boundEgressIp: string | null, observedEgressIp: string): boolean {
  return !boundEgressIp || boundEgressIp === observedEgressIp;
}

export function isXJobClaimEligible(input: JobClaimSafetyInput): boolean {
  return input.status === "queued"
    && input.preparationStatus === "ready"
    && input.attemptCount === 0
    && Boolean(input.approvedAt)
    && new Date(input.scheduledFor).getTime() <= input.nowMillis;
}

export function isXAccountClaimEligible(input: ClaimSafetyInput): boolean {
  if (input.executionMode !== "send" || !input.xuseAvailable) return false;
  if (!input.account.executorId || input.account.executorId !== input.executorId) return false;
  if (!input.configuredAccounts.includes(input.account.accountKey)) return false;
  if (input.account.networkMode === "vpn_direct") {
    return Boolean(
      input.account.expectedEgressIp
      && input.currentEgressIp === input.account.expectedEgressIp
      && input.networkProbeStatus === "healthy",
    );
  }
  if (input.account.networkMode === "fixed_proxy") {
    return input.account.verificationStatus === "passed"
      && input.account.hasProxy
      && input.account.proxyStatus !== "error";
  }
  return false;
}

export function getXApprovalBlockReason(input: ApprovalSafetyInput): string | null {
  if (input.jobStatus !== "draft") return "该任务已经处理，不能重复批准。";
  if (input.preparationStatus !== "ready") return "预览图、链接和文案尚未准备完成，暂不能批准发送。";
  if (!input.account?.active) return "该账号已停用。";
  if (!input.account.executorId) return "该账号尚未绑定 Mac 执行器。";
  if (!input.worker || input.nowMillis - new Date(input.worker.lastSeenAt).getTime() >= 5 * 60_000) {
    return `执行器 ${input.account.executorId} 最近五分钟没有心跳。`;
  }
  if (!input.worker.xuseAvailable) return "绑定执行器报告 x-use 不可用。";
  if (!input.worker.configuredAccounts.includes(input.account.accountKey)) {
    return `绑定执行器的 x-use 本地账号中不存在 ${input.account.accountKey}。`;
  }
  if (input.account.networkMode === "vpn_direct") {
    if (!input.account.expectedEgressIp) return "VPN 出口 IP 尚未由管理员确认锁定。";
    if (input.worker.networkProbeStatus !== "healthy" || input.worker.currentEgressIp !== input.account.expectedEgressIp) {
      const currentIp = input.worker.currentEgressIp ?? "未探测到";
      return `当前 Patchright 浏览器出口 ${currentIp} 与管理员锁定的 VPN IP ${input.account.expectedEgressIp} 不一致。请恢复已锁定的 VPN，或前往“X 账号/IP”人工确认后重新锁定。`;
    }
    return null;
  }
  if (input.account.networkMode === "fixed_proxy") {
    if (input.account.verificationStatus !== "passed") return "请先在“X 账号/IP”使用绑定代理打开主页，并完成账号与 IP 映射验证。";
    if (!input.account.proxyStatus) return "固定代理模式尚未配置代理。";
    if (input.account.proxyStatus === "error") return "该账号的固定代理处于异常状态，请更换或重新保存后再批准。";
    return null;
  }
  return "账号网络模式无效。";
}
