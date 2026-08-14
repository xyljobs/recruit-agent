/**
 * 简历文本本地启发式提取（rules_only 回退路径）。
 *
 * 仅使用确定性正则与静态词表，不调用任何外部服务；
 * AI 提取失败或未启用时，由本模块保证快捷入库功能可用。
 */

export interface ExtractedResumeFields {
  name: string;
  phone: string;
  email: string;
  current_city: string;
  current_company: string;
  current_position: string;
  skills: string[];
  experience_years: number | null;
  education: string;
  salary_expectation: string;
  preferred_locations: string[];
}

// 常见技术/制造技能静态词表（源自 assets/知识库-IT技能图谱.md 的子集）
const COMMON_SKILL_KEYWORDS = [
  'Python', 'Java', 'JavaScript', 'TypeScript', 'React', 'Vue', 'Node.js',
  'Go', 'C++', 'C#', 'PHP', 'Rust', 'SQL', 'MySQL', 'PostgreSQL', 'Redis',
  'MongoDB', 'Docker', 'Kubernetes', 'Linux', 'Git', 'Nginx', 'Spring',
  'Django', 'Flask', 'Flutter', '小程序', 'HTML', 'CSS', 'Webpack',
  '大数据', 'Hadoop', 'Spark', '机器学习', '深度学习', '人工智能',
  'PLC', '变频器', '伺服', '传感器', 'HMI', 'SCADA', 'MES', '工业互联网',
  '智能制造', '嵌入式', '单片机', 'STM32', 'FPGA', 'ARM', 'PCB', 'CAD',
  'SolidWorks', '机械设计', '电气', '液压', '气动', '自动化', '机器人',
  '电路设计', '模电', '数电', '通信协议', '物联网', '云计算', '运维',
] as const;

const PHONE_PATTERN = /(?<!\d)1[3-9]\d{9}(?!\d)/;
const EMAIL_PATTERN = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;
const YEARS_PATTERN = /(\d{1,2})\s*年/;
const SALARY_RANGE_PATTERN = /(\d{1,2})\s*[kK]?\s*[-~—至]\s*(\d{1,2})\s*[kK]/;
const SALARY_SINGLE_PATTERN = /(\d{1,2})\s*[kK]/;
const NAME_LABEL_PATTERN = /(?:姓名|名字|name)[:：\s]*([\u4e00-\u9fa5]{2,4})/i;

const EDUCATION_ORDER = ['博士', '硕士', '本科', '大专'] as const;

/** 提取候选姓名：优先「姓名：xxx」标注，否则取首行内 2-4 字中文词 */
function extractName(text: string): string {
  const labeled = text.match(NAME_LABEL_PATTERN);
  if (labeled?.[1]) return labeled[1];
  const firstLine = text
    .split(/\r?\n/)
    .map(line => line.trim())
    .find(line => line.length > 0 && line.length <= 30) ?? '';
  const chineseName = firstLine.match(/^[\u4e00-\u9fa5]{2,4}/);
  return chineseName?.[0] ?? '';
}

/** 提取学历关键词（按博士→大专优先级） */
function extractEducation(text: string): string {
  for (const education of EDUCATION_ORDER) {
    if (text.includes(education)) return education;
  }
  return '';
}

/** 提取工作年限：取首个「N年」表达式 */
function extractExperienceYears(text: string): number | null {
  const match = text.match(YEARS_PATTERN);
  if (!match) return null;
  const years = Number.parseInt(match[1], 10);
  return Number.isFinite(years) && years >= 0 && years <= 100 ? years : null;
}

/** 提取期望薪资：「20-30K」或「15K」 */
function extractSalaryExpectation(text: string): string {
  const range = text.match(SALARY_RANGE_PATTERN);
  if (range) return `${range[1]}-${range[2]}K`;
  const single = text.match(SALARY_SINGLE_PATTERN);
  if (single) return `${single[1]}K`;
  return '';
}

/** 提取现居城市：「现居：杭州」或「所在地 上海」 */
function extractCurrentCity(text: string): string {
  const match = text.match(/(?:现居|所在地|居住地|城市)[:：\s]*([\u4e00-\u9fa5]{2,6}(?:市|省)?)/);
  if (!match) return '';
  const city = match[1].replace(/(市|省)$/, '');
  return city.length >= 2 ? city : '';
}

/** 用静态词表匹配简历中出现的技能（忽略大小写） */
function extractSkills(text: string): string[] {
  const lowerText = text.toLowerCase();
  const skills = COMMON_SKILL_KEYWORDS.filter(keyword => (
    lowerText.includes(keyword.toLowerCase())
  ));
  return [...new Set(skills)];
}

/**
 * 本地确定性提取简历字段。
 * 无法可靠推断的字段（公司、职位、意向城市等）保持空值，由 HR 在表单中补充。
 */
export function extractResumeFieldsLocally(text: string): ExtractedResumeFields {
  return {
    name: extractName(text),
    phone: text.match(PHONE_PATTERN)?.[0] ?? '',
    email: text.match(EMAIL_PATTERN)?.[0] ?? '',
    current_city: extractCurrentCity(text),
    current_company: '',
    current_position: '',
    skills: extractSkills(text),
    experience_years: extractExperienceYears(text),
    education: extractEducation(text),
    salary_expectation: extractSalaryExpectation(text),
    preferred_locations: [],
  };
}

/** 清理字段：空字符串转空、裁剪数组长度，保证与 API 输入约束一致 */
export function sanitizeExtractedFields(fields: ExtractedResumeFields): ExtractedResumeFields {
  return {
    name: fields.name.trim().slice(0, 200),
    phone: fields.phone.trim().slice(0, 50),
    email: fields.email.trim().slice(0, 320),
    current_city: fields.current_city.trim().slice(0, 200),
    current_company: fields.current_company.trim().slice(0, 500),
    current_position: fields.current_position.trim().slice(0, 500),
    skills: [...new Set(fields.skills.map(skill => skill.trim()).filter(Boolean))].slice(0, 200),
    experience_years: fields.experience_years,
    education: fields.education.trim().slice(0, 200),
    salary_expectation: fields.salary_expectation.trim().slice(0, 200),
    preferred_locations: [
      ...new Set(fields.preferred_locations.map(location => location.trim()).filter(Boolean)),
    ].slice(0, 50),
  };
}

/**
 * 从模型输出中解析 JSON 对象：容忍 markdown 代码块与前后说明文字。
 * 解析失败返回 null，由调用方回退本地提取。
 */
export function parseLlmJsonObject<T>(content: string): T | null {
  const cleaned = content
    .replace(/```(?:json)?/gi, '')
    .trim();
  const startIndex = cleaned.indexOf('{');
  if (startIndex < 0) return null;
  const endIndex = cleaned.lastIndexOf('}');
  if (endIndex <= startIndex) return null;
  try {
    return JSON.parse(cleaned.slice(startIndex, endIndex + 1)) as T;
  } catch {
    return null;
  }
}
