"use client";

import { useActionState } from "react";
import { addAccountManualDrafts, confirmAccountManualIp, reportAccountManualSent, requestAccountManualWindow, type ManualActionState } from "./actions";
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

export function ManualWindowControl({ taskId, helperOnline }: { taskId: string; helperOnline: boolean }) {
  const [state, action, pending] = useActionState(requestAccountManualWindow, initial);
  return <form action={action} className="mt-3 rounded border border-line p-3">
    <input type="hidden" name="taskId" value={taskId} />
    <label className="block text-xs leading-5"><input type="checkbox" name="understandProfile" value="yes" required /> 我了解将使用独立持久 Chrome 资料目录及固定代理；首次由本人登录。这里只打开 IP 核对页，不打开 X 或发送。同一绑定已有窗口将保留复用。</label>
    <button className={`${button} mt-2`} disabled={pending || !helperOnline}>{pending ? "请求中…" : "请求本机绑定 IP 核对窗口"}</button>
    <Feedback state={state} success="请求已交独立手动助手。请手动刷新查看打开状态；请求不代表窗口或账号已就绪。" />
  </form>;
}

export function ManualIpConfirmation({ requestId }: { requestId: string }) {
  const [state, action, pending] = useActionState(confirmAccountManualIp, initial);
  return <form action={action} className="mt-2 text-xs">
    <input type="hidden" name="requestId" value={requestId} />
    <label><input type="checkbox" name="checkedIp" value="yes" required /> 我已在该独立绑定窗口核对 IP 与页面预期一致</label>
    <button className={`${button} ml-2`} disabled={pending}>登记本人已核对 IP</button>
    <Feedback state={state} success="已登记用户声明；不是系统自动验证。" />
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
