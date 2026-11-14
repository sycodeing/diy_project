import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const adminPages = [
  "../app/admin/x-auto-posts/page.tsx",
  "../app/admin/x-manual-posts/page.tsx",
  "../app/admin/x-leads/page.tsx",
];

test("admin X pages never render direct post or result links", () => {
  for (const relativePath of adminPages) {
    const source = readFileSync(new URL(relativePath, import.meta.url), "utf8");
    assert.doesNotMatch(source, /href=\{(?:lead\.post_url|post\.(?:target_post_url|result_url)|job\.result_url|xResultUrl)\}/);
  }
});

test("automatic queue views use the bound inspection action", () => {
  const source = readFileSync(new URL("../app/admin/x-auto-posts/page.tsx", import.meta.url), "utf8");
  assert.match(source, /form action=\{requestBoundXJobInspection\}/);
  assert.match(source, /使用绑定 IP 查看对应原帖/);
  assert.match(source, /使用绑定 IP 查看已发送回复/);
});
