import type {
  BaseMatchScore,
  MatchCandidateInput,
  MatchJobInput,
} from './scorer';

export const MANUFACTURING_STANDARD_VERSION = 'manufacturing-frozen-v1';

export const MANUFACTURING_ROLE_IDS = [
  'MFG-PLC-V1',
  'MFG-ROB-V1',
  'MFG-MNT-V1',
] as const;

export type ManufacturingRoleId = typeof MANUFACTURING_ROLE_IDS[number];
export type GateResult = 'PASS' | 'FAIL' | 'UNKNOWN';
export type ExperienceReviewStatus = 'confirmed' | 'provided' | 'partial' | 'unknown';

export interface ManufacturingHardGateResult {
  code: string;
  name: string;
  result: GateResult;
  evidence: string[];
}

export interface ManufacturingCriterionResult {
  code: string;
  name: string;
  weight: number;
  score: number;
  evidence: string[];
}

export interface ManufacturingExperienceReview {
  status: ExperienceReviewStatus;
  years: number | null;
  source: string;
  evidence: string | null;
}

export interface ManufacturingExperienceReviewInput {
  verified_experience_years?: number | null;
  experience_years_status?: string | null;
  experience_years_evidence?: string | null;
}

export interface ManufacturingAnalysis {
  role_id: ManufacturingRoleId;
  standard_version: typeof MANUFACTURING_STANDARD_VERSION;
  hard_fail: boolean;
  hard_gates: ManufacturingHardGateResult[];
  criteria: ManufacturingCriterionResult[];
  total_score: number;
  experience_review: ManufacturingExperienceReview;
  pending_business_checks: string[];
}

interface IndicatorDefinition {
  points: number;
  patterns: readonly RegExp[];
}

interface CriterionDefinition {
  code: string;
  name: string;
  weight: number;
  indicators: readonly IndicatorDefinition[];
}

interface GateDefinition {
  code: string;
  name: string;
  evaluate: (text: string) => ManufacturingHardGateResult;
}

const INDUSTRIAL_SITE = /产线|生产线|非标|自动化设备|生产设备|工厂|制造|工作站|车间/i;
const PLC_PROGRAMMING = /PLC.{0,30}(?:编程|程序|逻辑|开发|组态)|(?:编程|程序|逻辑|开发|组态).{0,30}PLC|S7[- ]?(?:1200|1500|300|400).{0,30}(?:编程|程序|逻辑|开发|组态)/i;
const PLC_EXPLICIT_BOUNDARY = /PLC程序由.{0,12}(?:软件工程师|电气工程师|同事|他人).{0,8}(?:负责|完成)|仅.{0,10}(?:配柜|接线|布线)|只.{0,10}(?:配柜|接线|布线)/i;
const NON_INDUSTRIAL_ELECTRICAL = /楼宇|弱电|门禁|监控系统|商业综合体|物业/i;
const ROBOT_BRAND = /FANUC|发那科|ABB|KUKA|库卡|Yaskawa|安川|松下|OTC|埃斯顿|那智|NACHI|EPSON|雅马哈/i;
const ROBOT_PROGRAMMING = /机器人.{0,35}(?:编程|程序|示教|轨迹调试|点位调试)|(?:编程|程序|示教|轨迹调试|点位调试).{0,35}机器人|编写.{0,20}工作站.{0,20}程序|RAPID|KRL|Roboguide|RobotStudio/i;
const ROBOT_OPERATOR_ONLY = /仅?.{0,8}(?:上下料|换型|点检|操作).{0,20}(?:程序异常|复杂故障).{0,15}(?:联系|交由).{0,10}(?:工程师|厂家)|程序.{0,10}(?:由|交给).{0,10}(?:工程师|厂家)/i;
const ROBOT_APPLICATION = /搬运|码垛|上下料|焊接|点焊|弧焊|涂胶|打磨|喷涂|装配|检测|视觉/i;
const PRODUCTION_EQUIPMENT = /生产设备|产线设备|自动化设备|机台|制造|工厂|车间|设备工程师|维修工程师|贴片机|冲压机/i;
const CONCRETE_FAULT = /(?:故障|异常|报警).{0,35}(?:诊断|排查|分析|维修|修复|抢修|根因|恢复)|(?:诊断|排查|分析|维修|修复|抢修|根因).{0,35}(?:故障|异常|报警)|5Why|5why|鱼骨图/i;
const OPERATOR_ONLY = /仅?.{0,10}(?:操作|点检|清洁|简单换件).{0,25}(?:复杂故障|程序异常).{0,15}(?:联系|交由).{0,10}(?:工程师|维修|厂家)/i;
const MAINTENANCE_ADMIN = /设备投资|预算编制|采购立项|寻价采购|固定资产|计量仪器|量检具计量|体系审核|比价竞标/gi;
const PREVENTIVE_MAINTENANCE = /点检|巡检|PM|预防性维护|预见性维护|定期保养|维护计划|周期性检修|TPM/i;

const ROLE_CRITERIA: Record<ManufacturingRoleId, readonly CriterionDefinition[]> = {
  'MFG-PLC-V1': [
    criterion('C1', 'PLC编程与控制逻辑', 25, [
      indicator(10, PLC_PROGRAMMING),
      indicator(5, /西门子|三菱|欧姆龙|罗克韦尔|倍福|汇川|施耐德/i),
      indicator(5, /联锁|报警|手自动|顺序控制|SCL|LAD|FBD|ST语言|配方/i),
      indicator(5, /独立|主导|负责.{0,20}(?:编程|程序|逻辑)/i),
    ]),
    criterion('C2', '电气设计与元件', 15, [
      indicator(6, /电气(?:原理图|设计|图纸)|电路图纸|自控设计|控制设计|EPLAN|AutoCAD Electrical/i),
      indicator(4, /BOM|元件选型|元器件选型|电器元件选型/i),
      indicator(3, /配电柜|控制柜|接线图|布线/i),
      indicator(2, /安全回路|安全系统|EMC/i),
    ]),
    criterion('C3', '现场调试与交付', 20, [
      indicator(7, /现场调试|驻场调试|安装调试/i),
      indicator(5, /FAT|SAT|验收|交付|试产|陪产/i),
      indicator(4, /上电|单机|整线|联调/i),
      indicator(4, /故障.{0,20}(?:解决|处理|排查)|问题.{0,20}闭环|异常恢复/i),
    ]),
    criterion('C4', '驱动与外围设备', 10, [
      indicator(3, /伺服/i),
      indicator(2, /变频器|变频/i),
      indicator(2, /传感器|工业相机|视觉/i),
      indicator(2, /气动|液压/i),
      indicator(1, /安全元件|安全回路/i),
    ]),
    criterion('C5', '工业网络与系统集成', 10, [
      indicator(4, /Profinet|Profibus|EtherNet\/IP|Modbus|CC-Link|EtherCAT|MRP冗余|OPC UA/i),
      indicator(2, /机器人/i),
      indicator(2, /视觉|相机/i),
      indicator(2, /MES|SCADA|WINCC|DCS|上位机/i),
    ]),
    criterion('C6', '项目复杂度与本人贡献', 10, [
      indicator(4, /主导|独立完成|项目负责人|技术负责人/i),
      indicator(2, /产线|整线|生产线|工作站/i),
      indicator(2, /I\/O|IO点|轴|节拍|台机器人|点位/i),
      indicator(2, /提高|降低|提升|缩短|节省|效率|稳定性/i),
    ]),
    criterion('C7', '经验可迁移性', 5, [
      indicator(3, /\d+年.{0,20}(?:自动化|PLC|电气)|(?:自动化|PLC|电气).{0,20}\d+年|10年以上/i),
      indicator(2, /汽车|半导体|新能源|制药|化工|包装|非标/i),
    ]),
    criterion('C8', '文档与问题解决', 5, [
      indicator(2, /调试记录|故障分析|根因|5Why|鱼骨|FMEA/i),
      indicator(2, /SOP|操作手册|技术文档|验证文档|报告/i),
      indicator(1, /版本|备份|标准化/i),
    ]),
  ],
  'MFG-ROB-V1': [
    criterion('C1', '品牌机器人与示教编程', 25, [
      indicator(8, ROBOT_BRAND),
      indicator(8, ROBOT_PROGRAMMING),
      indicator(5, /独立|主导|负责.{0,25}机器人|现场经理|技术担当/i),
      indicator(4, /RobotStudio|Roboguide|KUKA\.Sim|Process Simulate/i),
    ]),
    criterion('C2', '坐标标定、轨迹与恢复', 15, [
      indicator(5, /坐标系|工具坐标|用户坐标|TCP|零点|标定/i),
      indicator(4, /轨迹|点位|节拍/i),
      indicator(3, /碰撞|干涉|奇异|异常恢复|故障恢复/i),
      indicator(3, /精度|重复定位|优化/i),
    ]),
    criterion('C3', '应用工艺能力', 15, [
      indicator(5, /搬运|码垛|上下料/i),
      indicator(5, /焊接|点焊|弧焊|涂胶|打磨|喷涂/i),
      indicator(3, /装配|检测|视觉/i),
      indicator(2, /工艺|节拍|质量优化/i),
    ]),
    criterion('C4', 'PLC联调与安全联锁', 15, [
      indicator(5, /PLC/i),
      indicator(3, /HMI|触摸屏/i),
      indicator(4, /联锁|安全回路|安全门|安全PLC|DCS安全信号|干涉区/i),
      indicator(3, /Profinet|Profibus|Ethernet|Modbus|通讯|Process IO/i),
    ]),
    criterion('C5', '现场调试与客户验收', 15, [
      indicator(5, /现场调试|现场交付|驻场|技术支持/i),
      indicator(4, /验收|试产|陪产|上电/i),
      indicator(3, /客户培训|客户沟通|协调客户|集成商/i),
      indicator(3, /故障|问题处理|异常|维修/i),
    ]),
    criterion('C6', '离线仿真与布局验证', 5, [
      indicator(3, /离线(?:编程|仿真)|虚拟调试/i),
      indicator(2, /RobotStudio|Roboguide|KUKA\.Sim|Process Simulate|3D CAD/i),
    ]),
    criterion('C7', '项目复杂度与本人贡献', 5, [
      indicator(2, /主导|独立|现场经理|技术担当|负责人/i),
      indicator(2, /\d+台机器人|工作站|产线|整线/i),
      indicator(1, /提高|降低|提升|缩短|节拍|效率/i),
    ]),
    criterion('C8', '问题解决与文档', 5, [
      indicator(2, /故障卡|故障分析|根因|复盘/i),
      indicator(2, /SOP|手册|报告|文档|标准/i),
      indicator(1, /备份|版本|培训/i),
    ]),
  ],
  'MFG-MNT-V1': [
    criterion('C1', '故障诊断与恢复', 25, [
      indicator(8, CONCRETE_FAULT),
      indicator(5, /机械|电气/i),
      indicator(4, /液压|气动/i),
      indicator(4, /恢复|停机|Uptime|稼动率/i),
      indicator(4, /独立|主导|疑难故障/i),
    ]),
    criterion('C2', '预防性维护体系', 15, [
      indicator(5, /点检|巡检/i),
      indicator(5, /PM|预防性维护|预见性维护|定期保养|维护计划/i),
      indicator(3, /SOP|工单|设备履历|台账/i),
      indicator(2, /年度|季度|月度|周期/i),
    ]),
    criterion('C3', '自动化设备基础', 10, [
      indicator(4, /PLC/i),
      indicator(2, /伺服|变频器|变频/i),
      indicator(2, /传感器|工业相机/i),
      indicator(2, /安全回路|通讯|Modbus|Profinet/i),
    ]),
    criterion('C4', 'TPM与设备指标', 15, [
      indicator(5, /TPM/i),
      indicator(4, /OEE|Uptime|稼动率/i),
      indicator(3, /MTBF/i),
      indicator(3, /MTTR|停机时间|故障率/i),
    ]),
    criterion('C5', '改善与根因分析', 10, [
      indicator(4, /5Why|5why|鱼骨|FMEA|根因/i),
      indicator(3, /改造|改善|优化/i),
      indicator(3, /降低|提升|延长|节省|减少/i),
    ]),
    criterion('C6', '备件与文档管理', 10, [
      indicator(4, /备件|易损件/i),
      indicator(2, /安全库存|库存|采购|预算/i),
      indicator(2, /SOP|操作指导书|报告/i),
      indicator(2, /台账|履历|记录/i),
    ]),
    criterion('C7', '安装调试与验收', 10, [
      indicator(4, /安装|装机|move in/i),
      indicator(3, /调试|搬迁|改造/i),
      indicator(3, /验收|量产导入|交付/i),
    ]),
    criterion('C8', '行业设备可迁移性', 5, [
      indicator(3, /汽车|锂电|光伏|半导体|制造|生产线|工厂/i),
      indicator(2, /自动化设备|机台|产线设备|生产设备/i),
    ]),
  ],
};

const ROLE_GATES: Record<ManufacturingRoleId, readonly GateDefinition[]> = {
  'MFG-PLC-V1': [
    gate('H1', '工业现场证据', text => evidenceGate(text, INDUSTRIAL_SITE)),
    gate('H2', 'PLC独立编程', text => evidenceOrExplicitFailureGate(
      text,
      PLC_PROGRAMMING,
      PLC_EXPLICIT_BOUNDARY,
    )),
    gate('H3', '工业自动化岗位边界', text => {
      if (PLC_PROGRAMMING.test(text) || /PLC|电气自动化|非标自动化|自控工程师/i.test(text)) {
        return passWithEvidence(text, [PLC_PROGRAMMING, /PLC|电气自动化|非标自动化|自控工程师/i]);
      }
      if (NON_INDUSTRIAL_ELECTRICAL.test(text)) {
        return failWithEvidence(text, [NON_INDUSTRIAL_ELECTRICAL]);
      }
      return unknown();
    }),
    gate('H4', '出差接受性', text => preferenceGate(text, /不接受.{0,6}出差|拒绝.{0,6}出差|不能出差/i, /接受.{0,6}出差|可出差/i)),
  ],
  'MFG-ROB-V1': [
    gate('H1', '工业机器人证据', text => evidenceGate(text, ROBOT_BRAND)),
    gate('H2', '示教/编程独立性', text => evidenceOrExplicitFailureGate(
      text,
      ROBOT_PROGRAMMING,
      ROBOT_OPERATOR_ONLY,
    )),
    gate('H3', '工作站应用工艺', text => evidenceGate(text, ROBOT_APPLICATION)),
    gate('H4', '出差接受性', text => preferenceGate(text, /不接受.{0,6}出差|拒绝.{0,6}出差|不能出差/i, /接受.{0,6}出差|可出差/i)),
  ],
  'MFG-MNT-V1': [
    gate('H1', '生产设备维护证据', text => {
      if (PRODUCTION_EQUIPMENT.test(text)) return passWithEvidence(text, [PRODUCTION_EQUIPMENT]);
      if (/物业|商业综合体|消防设施|电梯维保/i.test(text)) {
        return failWithEvidence(text, [/物业|商业综合体|消防设施|电梯维保/i]);
      }
      return unknown();
    }),
    gate('H2', '独立故障诊断', text => {
      if (CONCRETE_FAULT.test(text)) return passWithEvidence(text, [CONCRETE_FAULT]);
      if (OPERATOR_ONLY.test(text)) return failWithEvidence(text, [OPERATOR_ONLY]);
      const administrativeMatches = text.match(MAINTENANCE_ADMIN) ?? [];
      if (administrativeMatches.length >= 3) {
        return failWithEvidence(text, [MAINTENANCE_ADMIN]);
      }
      return unknown();
    }),
    gate('H3', '维护职责完整性', text => {
      if (PREVENTIVE_MAINTENANCE.test(text) && CONCRETE_FAULT.test(text)) {
        return passWithEvidence(text, [PREVENTIVE_MAINTENANCE, CONCRETE_FAULT]);
      }
      return unknownWithEvidence(text, [PREVENTIVE_MAINTENANCE, CONCRETE_FAULT]);
    }),
    gate('H4', '倒班接受性', text => preferenceGate(text, /不接受.{0,6}(?:倒班|夜班|轮班)|只能白班/i, /接受.{0,6}(?:倒班|夜班|轮班)|可倒班/i)),
  ],
};

export function detectManufacturingRole(job: MatchJobInput): ManufacturingRoleId | null {
  const title = job.title?.trim() ?? '';
  if (/工业机器人|机器人应用|机器人调试/i.test(title)) return 'MFG-ROB-V1';
  if (/设备维护|设备维修|设备工程师|设备动力/i.test(title)) return 'MFG-MNT-V1';
  if (/PLC|电气自动化|自控工程师/i.test(title)) return 'MFG-PLC-V1';

  const source = [job.raw_jd, ...(job.skills_required ?? [])]
    .filter((value): value is string => typeof value === 'string')
    .join(' ');
  if (/工业机器人|机器人应用|机器人调试/i.test(source)) return 'MFG-ROB-V1';
  if (/设备维护|设备维修|设备工程师|设备动力/i.test(source)) return 'MFG-MNT-V1';
  if (/PLC|电气自动化|自控工程师/i.test(source)) return 'MFG-PLC-V1';
  return null;
}

export function calculateManufacturingMatchScore(
  job: MatchJobInput,
  candidate: MatchCandidateInput,
  experienceInput?: ManufacturingExperienceReviewInput,
): BaseMatchScore | null {
  const roleId = detectManufacturingRole(job);
  if (!roleId) return null;
  const resumeText = (candidate.resume_text ?? '')
    .split(/\r?\n/)
    .filter(line => !/^\s*(候选人ID|目标岗位|岗位标准ID)[：:]/.test(line))
    .join('\n')
    .trim();

  const hardGates = ROLE_GATES[roleId].map(definition => {
    const result = definition.evaluate(resumeText);
    return { ...result, code: definition.code, name: definition.name };
  });
  const criteria = ROLE_CRITERIA[roleId].map(definition => scoreCriterion(resumeText, definition));
  const technicalScore = criteria.reduce((sum, row) => sum + row.score, 0);
  const hardFail = hardGates.some(row => row.result === 'FAIL');
  const experienceReview = resolveExperienceReview({ ...candidate, ...experienceInput });
  const experienceScore = scoreExperience(job.experience_required, experienceReview.years);
  const unknownGates = hardGates.filter(row => row.result === 'UNKNOWN').map(row => row.name);
  const failedGates = hardGates.filter(row => row.result === 'FAIL');
  const strongCriteria = criteria.filter(row => row.score >= row.weight * 0.7);
  const weakCriteria = criteria.filter(row => row.score < row.weight * 0.5);
  const pendingBusinessChecks = roleId === 'MFG-MNT-V1'
    ? ['工作地点', '薪资期望', '倒班接受性', '到岗时间']
    : ['工作地点', '薪资期望', '出差接受性', '到岗时间'];

  const strengths = strongCriteria.map(row => `${row.name} ${row.score}/${row.weight}: ${firstEvidence(row.evidence)}`);
  const gaps = [
    ...failedGates.map(row => `硬门槛不通过 ${row.code} ${row.name}: ${firstEvidence(row.evidence)}`),
    ...unknownGates.map(name => `待确认: ${name}`),
    ...weakCriteria.map(row => `${row.name}证据不足(${row.score}/${row.weight})`),
    ...(experienceReview.status === 'partial' || experienceReview.status === 'unknown'
      ? ['工作年限无法完整确认，不按0年惩罚']
      : []),
  ];

  const analysis: ManufacturingAnalysis = {
    role_id: roleId,
    standard_version: MANUFACTURING_STANDARD_VERSION,
    hard_fail: hardFail,
    hard_gates: hardGates,
    criteria,
    total_score: technicalScore,
    experience_review: experienceReview,
    pending_business_checks: pendingBusinessChecks,
  };

  return {
    overall_score: hardFail ? 0 : technicalScore,
    skill_score: technicalScore,
    experience_score: experienceScore,
    education_score: 70,
    salary_score: 50,
    location_score: 50,
    availability_score: 50,
    stability_score: 60,
    match_details: {
      strengths: strengths.length > 0 ? strengths : ['简历已完成岗位证据扫描'],
      gaps,
      recommendations: hardFail
        ? '存在有简历证据支持的硬门槛不通过项，不进入自动推荐榜；应由招聘者复核证据。'
        : '未发现明确硬门槛失败；未知业务变量和证据缺口必须由招聘者确认，不得自动淘汰。',
      skill_analysis: {
        matched: strongCriteria.map(row => row.name),
        missing: weakCriteria.map(row => row.name),
        bonus_matched: [],
      },
      salary_analysis: {
        candidate_expectation: formatRange(candidate.salary_min, candidate.salary_max, candidate.salary_expectation),
        job_range: formatRange(job.salary_min, job.salary_max, job.salary_range),
        overlap: salaryRangesOverlap(job, candidate) ? '有交集' : '无交集',
      },
      location_analysis: {
        candidate_city: candidate.current_city?.trim() || '未知',
        job_city: job.location?.trim() || '未知',
        match: cityMatches(job.location, candidate.current_city, candidate.preferred_locations),
      },
      manufacturing_analysis: analysis,
    },
  };
}

function criterion(
  code: string,
  name: string,
  weight: number,
  indicators: readonly IndicatorDefinition[],
): CriterionDefinition {
  return { code, name, weight, indicators };
}

function indicator(points: number, ...patterns: readonly RegExp[]): IndicatorDefinition {
  return { points, patterns };
}

function gate(
  code: string,
  name: string,
  evaluate: GateDefinition['evaluate'],
): GateDefinition {
  return { code, name, evaluate };
}

function scoreCriterion(text: string, definition: CriterionDefinition): ManufacturingCriterionResult {
  let score = 0;
  const matchedPatterns: RegExp[] = [];
  for (const indicatorDefinition of definition.indicators) {
    if (indicatorDefinition.patterns.some(pattern => testPattern(pattern, text))) {
      score += indicatorDefinition.points;
      matchedPatterns.push(...indicatorDefinition.patterns);
    }
  }
  return {
    code: definition.code,
    name: definition.name,
    weight: definition.weight,
    score: Math.min(score, definition.weight),
    evidence: evidenceLines(text, matchedPatterns),
  };
}

function resolveExperienceReview(candidate: MatchCandidateInput): ManufacturingExperienceReview {
  const explicitStatus = normalizeExperienceStatus(candidate.experience_years_status);
  const verifiedYears = finiteNonNegative(candidate.verified_experience_years);
  const providedYears = finiteNonNegative(candidate.experience_years);
  if (explicitStatus === 'partial' || explicitStatus === 'unknown') {
    return {
      status: explicitStatus,
      years: null,
      source: explicitStatus === 'partial' ? 'HR年限复核：部分确认' : 'HR年限复核：无法确认',
      evidence: candidate.experience_years_evidence?.trim() || null,
    };
  }
  if (verifiedYears !== null) {
    return {
      status: 'confirmed',
      years: verifiedYears,
      source: 'HR年限复核',
      evidence: candidate.experience_years_evidence?.trim() || null,
    };
  }
  if (providedYears !== null) {
    return {
      status: explicitStatus === 'confirmed' ? 'confirmed' : 'provided',
      years: providedYears,
      source: explicitStatus === 'confirmed' ? 'HR年限复核' : '候选人结构化字段',
      evidence: candidate.experience_years_evidence?.trim() || null,
    };
  }
  return { status: 'unknown', years: null, source: '未提供', evidence: null };
}

function normalizeExperienceStatus(value: string | null | undefined): ExperienceReviewStatus | null {
  if (!value) return null;
  const normalized = value.trim().toLowerCase();
  if (normalized.includes('部分确认') || normalized === 'partial') return 'partial';
  if (normalized.includes('无法确认') || normalized === 'unknown') return 'unknown';
  if (['confirmed', '确认', '确认并纠正', '按简历自述确认'].some(token => normalized.includes(token.toLowerCase()))) return 'confirmed';
  return null;
}

function scoreExperience(requirement: string | null | undefined, years: number | null): number {
  if (years === null) return 50;
  const required = Number(requirement?.match(/(\d+)\s*[-~年]/)?.[1] ?? 0);
  if (required <= 0) return 70;
  if (years >= required) return Math.min(100, Math.round(70 + Math.min((years - required) * 5, 30)));
  return Math.max(20, Math.round((years / required) * 70));
}

function evidenceGate(text: string, positive: RegExp): ManufacturingHardGateResult {
  return testPattern(positive, text) ? passWithEvidence(text, [positive]) : unknown();
}

function evidenceOrExplicitFailureGate(
  text: string,
  positive: RegExp,
  explicitFailure: RegExp,
): ManufacturingHardGateResult {
  if (testPattern(explicitFailure, text)) return failWithEvidence(text, [explicitFailure]);
  if (testPattern(positive, text)) return passWithEvidence(text, [positive]);
  return unknown();
}

function preferenceGate(text: string, refusal: RegExp, acceptance: RegExp): ManufacturingHardGateResult {
  if (testPattern(refusal, text)) return failWithEvidence(text, [refusal]);
  if (testPattern(acceptance, text)) return passWithEvidence(text, [acceptance]);
  return unknown();
}

function passWithEvidence(text: string, patterns: readonly RegExp[]): ManufacturingHardGateResult {
  return { code: '', name: '', result: 'PASS', evidence: evidenceLines(text, patterns) };
}

function failWithEvidence(text: string, patterns: readonly RegExp[]): ManufacturingHardGateResult {
  return { code: '', name: '', result: 'FAIL', evidence: evidenceLines(text, patterns) };
}

function unknown(): ManufacturingHardGateResult {
  return { code: '', name: '', result: 'UNKNOWN', evidence: [] };
}

function unknownWithEvidence(text: string, patterns: readonly RegExp[]): ManufacturingHardGateResult {
  return { code: '', name: '', result: 'UNKNOWN', evidence: evidenceLines(text, patterns) };
}

function evidenceLines(text: string, patterns: readonly RegExp[], limit = 3): string[] {
  const matches: string[] = [];
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/\s+/g, ' ').trim();
    if (!line || !patterns.some(pattern => testPattern(pattern, line))) continue;
    const excerpt = [...line].slice(0, 180).join('');
    if (!matches.includes(excerpt)) matches.push(excerpt);
    if (matches.length >= limit) break;
  }
  return matches;
}

function testPattern(pattern: RegExp, text: string): boolean {
  pattern.lastIndex = 0;
  return pattern.test(text);
}

function firstEvidence(evidence: readonly string[]): string {
  return evidence[0] ?? '简历未提供可定位证据';
}

function finiteNonNegative(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

function formatRange(
  min: number | null | undefined,
  max: number | null | undefined,
  fallback: string | null | undefined,
): string {
  if (typeof min === 'number' || typeof max === 'number') return `${min ?? '?'}-${max ?? '?'}K`;
  return fallback?.trim() || '未提供';
}

function salaryRangesOverlap(job: MatchJobInput, candidate: MatchCandidateInput): boolean {
  if (
    typeof job.salary_min !== 'number'
    || typeof job.salary_max !== 'number'
    || typeof candidate.salary_min !== 'number'
    || typeof candidate.salary_max !== 'number'
  ) return false;
  return candidate.salary_min <= job.salary_max && candidate.salary_max >= job.salary_min;
}

function cityMatches(
  jobCity: string | null | undefined,
  candidateCity: string | null | undefined,
  preferredLocations: readonly string[] | null | undefined,
): boolean {
  if (!jobCity) return false;
  const normalizedJobCity = jobCity.replace(/[市区县]/g, '');
  return [candidateCity, ...(preferredLocations ?? [])]
    .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    .some(value => {
      const normalized = value.replace(/[市区县]/g, '');
      return normalized.includes(normalizedJobCity) || normalizedJobCity.includes(normalized);
    });
}
