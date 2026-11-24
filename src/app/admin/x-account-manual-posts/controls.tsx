"use client";

import { useActionState } from "react";
import { addAccountManualDrafts, reportAccountManualSent, requestAccountManualWindow, requestAccountIpWindow, type ManualActionState } from "./actions";
import { MANUAL_SENDER_ID, MANUAL_SENDER_LABEL } from "@/lib/x-account-manual";

const initial = { ok: 0, failed: [] };
function Feedback({ state, success }: { state: ManualActionState; success: string }) {
  return <div className="mt-2 text-xs" aria-live="polite">{state.ok ? <p className="text-emerald-800">{success}</p> : null}{state.failed.map((f) => <p className="text-red-700" key={f.id}>{f.reason}</p>)}</div>;
}
const button = "rounded-lg border border-line bg-white px-3 py-2 text-sm font-bold disabled:opacity-50";

export function ManualAdd({ authorId, hasPreview = true }: { authorId: string; hasPreview?: boolean }) {
  const [state, action, pending] = useActionState(addAccountManualDrafts, initial);
  return <form action={action} className="mt-3 rounded-lg border border-line p-3">
    <input type="hidden" name="authorId" value={authorId} /><input type="hidden" name="accountId" value={MANUAL_SENDER_ID} />
    <input type="hidden" name="preparationMode" value={hasPreview ? "auto_preview" : "text_only"} />
    <p className="text-xs font-bold">固定手动账号：{MANUAL_SENDER_LABEL}</p>
    {!hasPreview ? <label className="my-2 block text-xs"><input type="checkbox" name="confirmTextOnly" required /> 我明确选择现有纯文字草稿</label> : null}
    <button className={`${button} mt-2`} disabled={pending}>{pending ? "加入中…" : "加入账号手动发送队列"}</button>
    <p className="mt-1 text-xs text-muted">仅复制当前有效草稿；不自动生成、打开 X 或发送。</p>
    <Feedback state={state} success="已加入手动队列，由本人逐条操作。" />
  </form>;
}

export function ManualWindowControl({ taskId, accountId, helperOnline, blockedReason }: { taskId?: string; accountId?: string; helperOnline: boolean; blockedReason?: string | null }) {
  const [state, action, pending] = useActionState(accountId ? requestAccountIpWindow : requestAccountManualWindow, initial);
  return <form action={action} className="mt-3 rounded border border-line p-3">
    {accountId ? <input type="hidden" name="accountId" value={accountId} /> : <input type="hidden" name="taskId" value={taskId} />}
    <label className="block text-xs leading-5"><input type="checkbox" name="understandProfile" value="yes" required /> 我明确请求 x-use 使用该账号原绑定代理及 Cookie 会话打开 X 首页；不批准或发送。保持原 x-use 浏览器配置，同一会话复用。会话结束后不自动保存 Cookie，初始化失败可能关闭窗口。</label>
    <button className={`${button} mt-2`} disabled={pending || !helperOnline || Boolean(blockedReason)}>{pending ? "请求中…" : "使用绑定代理打开 X 首页（x-use）"}</button>
    {blockedReason ? <p className="mt-2 text-xs text-amber-900">{blockedReason}</p> : null}
    <Feedback state={state} success="请求已交独立 x-use 手动助手。请手动刷新查看打开状态；请求不代表窗口或账号已就绪。" />
  </form>;
}

export function ManualReport({ taskId, withPreview }: { taskId: string; withPreview: boolean }) {
  const [state, action, pending] = useActionState(reportAccountManualSent, initial);
  return <form action={action} className="mt-3 space-y-2 rounded border border-line p-3">
    <input type="hidden" name="taskId" value={taskId} />
    <label className="block text-sm font-bold">本人发送后的真实结果链接<input type="url" name="resultUrl" required placeholder="https://x.com/Le6wCummeratawi/status/…" className="mt-1 w-full rounded border border-line bg-white p-2 font-normal" /></label>
    <label className="block text-xs"><input type="checkbox" name="personallySent" value="yes" required /> 我已自行核对 X 登录账号为 @Le6wCummeratawi，并亲手检查文案和实际附件、点击发送；此处仅登记结果，不再发送。</label>
    {withPreview ? <label className="block text-xs"><input type="checkbox" name="previewUploaded" value="yes" required /> 我已在这条回复中上传所示商品预览图（本人声明，系统未核验）</label> : null}
    <button className={button} disabled={pending}>{pending ? "登记中…" : "登记本人已发送"}</button>
    <Feedback state={state} success="已记录本人声明与结果链接；系统未自动核验平台发布结果。绑定窗口和标签保持不变。" />
  </form>;
}
