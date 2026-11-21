export function supportsDemandPhotoJoin(version: string | undefined) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version ?? "");
  if (!match) return false;
  const [major, minor] = [Number(match[1]), Number(match[2])];
  return major > 1 || (major === 1 && minor >= 9);
}

export function supportsDiscussionSearch(version: string | undefined) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version ?? "");
  if (!match) return false;
  const major = Number(match[1]);
  const minor = Number(match[2]);
  return major > 1 || (major === 1 && minor >= 12);
}

export function supportsPurchaseRecall(version: string | undefined) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version ?? "");
  if (!match) return false;
  const major = Number(match[1]);
  const minor = Number(match[2]);
  return major > 1 || (major === 1 && minor >= 15);
}

export function supportsConsumerRecall(version: string | undefined) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version ?? "");
  if (!match) return false;
  const major = Number(match[1]);
  const minor = Number(match[2]);
  const patch = Number(match[3]);
  return major > 1 || (major === 1 && (minor > 17 || (minor === 17 && patch >= 3)));
}

export function supportsEngagementRecall(version: string | undefined) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version ?? "");
  if (!match) return false;
  const [major, minor, patch] = [Number(match[1]), Number(match[2]), Number(match[3])];
  return major > 1 || (major === 1 && (minor > 18 || (minor === 18 && patch >= 3)));
}

export function supportsAccountFirst(version: string | undefined) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version ?? "");
  if (!match) return false;
  const [major, minor] = [Number(match[1]), Number(match[2])];
  return major > 1 || (major === 1 && minor >= 19);
}
