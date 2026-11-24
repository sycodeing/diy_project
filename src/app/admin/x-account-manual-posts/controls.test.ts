import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ManualReport, ManualWindowControl } from "./controls.tsx";
import { MANUAL_SENDER_ID } from "@/lib/x-account-manual";

test("account and task entry buttons need no checkbox or hidden consent", () => {
  for (const props of [{ accountId: MANUAL_SENDER_ID }, { taskId: "test-task" }]) {
    const html = renderToStaticMarkup(createElement(ManualWindowControl, { ...props, helperOnline: true }));
    assert.match(html, /使用绑定代理打开 X 首页（x-use）/);
    assert.doesNotMatch(html, /checkbox|understandProfile|disabled=""/);
  }
});

test("real helper and binding blocks still disable entry buttons", () => {
  for (const props of [{ helperOnline: false }, { helperOnline: true, blockedReason: "绑定已变化" }]) {
    const html = renderToStaticMarkup(createElement(ManualWindowControl, { accountId: MANUAL_SENDER_ID, ...props }));
    assert.match(html, /disabled=""/);
  }
});

test("text and preview result forms only ask for the result URL", () => {
  for (const withPreview of [false, true]) {
    const html = renderToStaticMarkup(createElement(ManualReport, { taskId: "test-task", withPreview }));
    assert.match(html, /<input(?=[^>]*type="url")(?=[^>]*name="resultUrl")(?=[^>]*required="")/);
    assert.match(html, /仅记录本人自报/);
    assert.doesNotMatch(html, /checkbox|personallySent|previewUploaded/);
  }
});
