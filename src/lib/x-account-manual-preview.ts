/** Ordinary queue preparation preserves a valid reviewed manual asset; replacement requires explicit force. */
export async function reuseManualAccountPreview(designSource: string | null | undefined,
  brief: Record<string, unknown>, force: boolean, validateCurrent: () => Promise<boolean>): Promise<boolean> {
  if (force || designSource !== "brand_created" || brief.generationMethod) return false;
  if (!await validateCurrent())
    throw new Error("现有人工设计草稿或链接已失效；请核对后明确重生成，不能自动替换人工设计。");
  return true;
}
