<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

## X 宠物候选筛选

在本项目中，用户只说“筛选”且没有指定其他筛选对象时，默认指 X 猫狗候选筛选，调用 `.agents/skills/x-pet-lead-discovery/SKILL.md`。明确指定商品、订单等其他对象时，按其实际对象处理。候选发现保持只读；筛选请求不授权发送公开回复或私信。

## 项目需求协作

本项目的新需求先由 `gpt-6-astra` high 负责理解、方案与独立差异审查；`gpt-6-sol` high 负责具体编码和操作；根代理协调、核验与交付。各角色共享工作区时须明确文件归属，不回退他人的改动。用户对具体任务的指示优先。
