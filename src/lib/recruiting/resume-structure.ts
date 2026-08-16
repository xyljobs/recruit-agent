import { z } from 'zod';
import { extractJsonObject } from '@/lib/ai/json';

export const RESUME_STRUCTURE_PROMPT_VERSION = 'resume-structure-v1';

const experienceItemSchema = z.strictObject({
  title: z.string().trim().min(1).max(120),
  detail: z.string().trim().min(1).max(400),
});

export const resumeStructureSchema = z.strictObject({
  summary: z.string().trim().min(1).max(200),
  skills: z.array(z.string().trim().min(1).max(50)).max(20),
  experience: z.array(experienceItemSchema).max(10),
  highlights: z.array(z.string().trim().min(1).max(200)).max(8),
});

export type ResumeStructure = z.infer<typeof resumeStructureSchema>;

export function parseModelResumeStructure(value: string): ResumeStructure {
  return resumeStructureSchema.parse(JSON.parse(extractJsonObject(value)));
}

export const RESUME_STRUCTURE_PROMPT = `你是一位资深招聘顾问。请阅读候选人的简历原文，提炼出结构化摘要，用于在候选人详情页以卡片形式展示，替代冗长难读的原文。

约束：
1. 只允许基于简历原文内容提炼，严禁编造、推测或补充原文不存在的信息。
2. 不得输出候选人评分、等级、排序结论、录用或拒绝建议。
3. 不得输出婚姻、生育、年龄、户籍、籍贯、健康、病史、宗教、政治面貌、性取向、家庭财产等敏感信息。
4. 只返回一个严格 JSON 对象，不要 Markdown，不要代码块标记，不要额外字段或解释。

JSON 字段：
- summary: string，一句话概括候选人的核心定位（例如"8年智能制造PLC工程师，擅长整线电控设计与现场交付"）
- skills: string[]，从简历提炼的技能关键词（优先硬技能，含简历中明确出现但未单独列出的技术名词），最多 20 项
- experience: Array<{ title, detail }>，工作或项目经历，title 为岗位或项目名称（含时间段，如有），detail 为该段经历的职责与量化成果概括，最多 10 项
- highlights: string[]，候选人区别于他人的亮点或优势，最多 8 项

输出纪律（控制篇幅）：
- summary 不超过 60 字
- skills 每项 2-20 字，只保留具体技能名词
- experience 每项 detail 不超过 150 字，概括改写，禁止逐字复制原文
- highlights 每项不超过 60 字

输入：
{input}`;
