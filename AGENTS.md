<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

## X 宠物候选筛选

在本项目中，用户只说“筛选”且没有指定其他筛选对象时，默认指 X 猫狗候选筛选，调用 `.agents/skills/x-pet-lead-discovery/SKILL.md`。明确指定商品、订单等其他对象时，按其实际对象处理。候选发现保持只读；筛选请求不授权发送公开回复或私信。
