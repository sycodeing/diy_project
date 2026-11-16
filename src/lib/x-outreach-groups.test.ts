import assert from "node:assert/strict";
import test from "node:test";
import { createXLeadDrafts } from "./x-lead-copy";
import {
  marketingOutreachGroup,
  marketingOutreachGroupKey,
  marketingOutreachGroupLabel,
  resolveXOutreachGroup,
  xOutreachCampaign,
  X_OUTREACH_GROUPS,
} from "./x-outreach-groups";

test("resolves purchase-intent evidence before the reused cloud segment", () => {
  const gift = resolveXOutreachGroup({ segment: "custom", targetingData: {
    discovery_segment: "demand_custom",
    purchase_intent: { scene: "gift", tier: "explicit_request" },
  } });
  assert.equal(gift, "demand_gift");
  assert.equal(resolveXOutreachGroup({ segment: "pet_birthday" }), "pet_birthday");
  assert.equal(resolveXOutreachGroup({ segment: "unknown" }), "general");
});

test("each configured group creates a distinguishable campaign and contextual copy", () => {
  const campaigns = new Set<string>();
  const copies = new Set<string>();
  for (const group of Object.keys(X_OUTREACH_GROUPS) as Array<keyof typeof X_OUTREACH_GROUPS>) {
    assert.match(group, /^[a-z][a-z0-9_]{0,39}$/);
    const campaign = xOutreachCampaign(group, "20261116");
    const copy = createXLeadDrafts(
      { occasion: null, occasionConfidence: null, petType: "cat", targetingData: null },
      "https://example.com/go/abc",
      undefined,
      "guided_preview_a_v2",
      group,
    ).publicCopy;
    assert.equal(marketingOutreachGroup(campaign), group);
    assert.equal(marketingOutreachGroupLabel(campaign), X_OUTREACH_GROUPS[group].label);
    assert.ok(copy.endsWith("https://example.com/go/abc"));
    assert.ok(copy.length <= 220);
    campaigns.add(campaign);
    copies.add(copy);
  }
  assert.equal(campaigns.size, Object.keys(X_OUTREACH_GROUPS).length);
  assert.equal(copies.size, Object.keys(X_OUTREACH_GROUPS).length);
});

test("historical links remain ungrouped and future unknown groups remain visible", () => {
  assert.equal(marketingOutreachGroup("x_custom_20261116"), null);
  assert.equal(marketingOutreachGroupLabel("x_custom_20261116"), "历史 X / 未分组");
  assert.equal(marketingOutreachGroupKey("other_campaign"), "__other__");
  assert.equal(marketingOutreachGroupLabel("xg_future_scene_20261116"), "future_scene");
});
