"use server";
import { requireAdmin } from "@/lib/auth";
export type V2ActionState = { ok: number; failed: Array<{ id: string; reason: string }> };
async function disabled(): Promise<V2ActionState> {
  await requireAdmin("/admin/x-auto-posts-v2");
  return { ok: 0, failed: [{ id: "manual-only", reason: "V2 已转为账号手动发送队列，不再加入或批准自动发送。请刷新并使用新入口。" }] };
}
export async function addV2Drafts(_previous?: V2ActionState, _form?: FormData) { void _previous; void _form; return disabled(); }
export async function approveV2Drafts(_previous?: V2ActionState, _form?: FormData) { void _previous; void _form; return disabled(); }
export async function withdrawV2Draft(_form: FormData) { void _form; return disabled(); }
