export type XOutreachCopyVariant = "short_direct_b_v1" | "guided_preview_a_v2";

export const X_OUTREACH_GROUPS = {
  general: {
    label: "通用宠物照片",
    copy: {
      short_direct_b_v1: "I turned this {pet} photo into a personalized pillow-cover preview. See how it looks:",
      guided_preview_a_v2: "I made a quick pillow-cover preview from this {pet} photo. Open it to see the design with your photo already added:",
    },
  },
  demand_custom: {
    label: "宠物定制需求",
    copy: {
      short_direct_b_v1: "Since you were looking at personalized {pet} ideas, I made a pillow-cover preview with this photo:",
      guided_preview_a_v2: "I made a pillow-cover preview with your {pet} photo already added, so you can see one custom option:",
    },
  },
  demand_gift: {
    label: "宠物照片礼物需求",
    copy: {
      short_direct_b_v1: "For the {pet} photo-gift idea, I made a pillow-cover preview with this photo:",
      guided_preview_a_v2: "I put this {pet} photo on a pillow-cover preview so you can see how it might look as a gift:",
    },
  },
  demand_decor: {
    label: "宠物家居装饰兴趣",
    copy: {
      short_direct_b_v1: "I tried this {pet} photo on a pillow-cover preview for your space. Here's the design:",
      guided_preview_a_v2: "I made a pillow-cover preview with your {pet} photo already added, to show how it could look at home:",
    },
  },
  new_adoption: {
    label: "新领养 / 到家",
    copy: {
      short_direct_b_v1: "I made a pillow-cover preview from this new {pet} photo. See how it looks:",
      guided_preview_a_v2: "I added your new {pet}'s photo to a pillow-cover preview, so you can see the design:",
    },
  },
  pet_birthday: {
    label: "宠物生日",
    copy: {
      short_direct_b_v1: "I made a birthday-inspired pillow-cover preview from this {pet} photo:",
      guided_preview_a_v2: "I added your {pet}'s photo to a birthday-inspired pillow-cover preview. Take a look:",
    },
  },
  pet_adventure: {
    label: "户外 / 旅行",
    copy: {
      short_direct_b_v1: "I made a pillow-cover preview from this {pet} adventure photo. See the design:",
      guided_preview_a_v2: "I added this {pet} adventure photo to a pillow-cover preview, so you can see how it looks:",
    },
  },
  pet_costume: {
    label: "装扮 / 节日造型",
    copy: {
      short_direct_b_v1: "I made a pillow-cover preview from this {pet} costume photo. See how it looks:",
      guided_preview_a_v2: "I added your {pet}'s costume photo to a pillow-cover preview. Take a look at the design:",
    },
  },
  pet_portrait: {
    label: "照片 / 高光时刻",
    copy: {
      short_direct_b_v1: "I made a pillow-cover preview from this {pet} portrait. See how it looks:",
      guided_preview_a_v2: "I added this {pet} portrait to a pillow-cover preview, so you can see the design:",
    },
  },
} as const satisfies Record<string, { label: string; copy: Record<XOutreachCopyVariant, string> }>;

export type XOutreachGroupKey = keyof typeof X_OUTREACH_GROUPS;

export function isXOutreachGroupKey(value: unknown): value is XOutreachGroupKey {
  return typeof value === "string" && Object.hasOwn(X_OUTREACH_GROUPS, value);
}

export function resolveXOutreachGroup(lead: { segment?: string | null; targetingData?: Record<string, unknown> | null }): XOutreachGroupKey {
  const targeting = lead.targetingData;
  const intent = targeting?.purchase_intent;
  if (intent && typeof intent === "object" && !Array.isArray(intent)) {
    const evidence = intent as Record<string, unknown>;
    if (evidence.tier === "explicit_request" || evidence.tier === "exploratory") {
      const sceneGroup = typeof evidence.scene === "string" ? `demand_${evidence.scene}` : null;
      if (isXOutreachGroupKey(sceneGroup)) return sceneGroup;
    }
  }
  for (const value of [targeting?.outreach_group, targeting?.discovery_segment, lead.segment]) {
    if (isXOutreachGroupKey(value)) return value;
  }
  return "general";
}

export function xOutreachCampaign(group: XOutreachGroupKey, dateKey: string) {
  return `xg_${group}_${dateKey}`;
}

export function marketingOutreachGroup(campaign: string): string | null {
  const match = /^xg_([a-z][a-z0-9_]{0,39})_\d{8}$/.exec(campaign);
  return match?.[1] ?? null;
}

export function marketingOutreachGroupKey(campaign: string) {
  return marketingOutreachGroup(campaign) ?? (/^x_/.test(campaign) ? "__legacy__" : "__other__");
}

export function marketingOutreachGroupLabel(campaign: string) {
  const group = marketingOutreachGroup(campaign);
  if (!group) return /^x_/.test(campaign) ? "历史 X / 未分组" : "其他活动 / 未分组";
  return isXOutreachGroupKey(group) ? X_OUTREACH_GROUPS[group].label : group;
}
