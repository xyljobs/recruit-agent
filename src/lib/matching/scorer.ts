import { SCORE_WEIGHTS } from '@/storage/database/shared/schema';
import { matchLlmSupplementSchema } from '@/lib/ai/match-scoring';
import { calculateManufacturingMatchScore } from './manufacturing-scorer';

export { SCORE_WEIGHTS };

export const BASE_SCORING_MODEL = 'explainable-base-v2';
export type MatchScoreWeights = Record<keyof typeof SCORE_WEIGHTS, number>;

export interface MatchJobInput {
  title?: string | null;
  raw_jd?: string | null;
  skills_required?: readonly string[] | null;
  bonus_skills?: readonly string[] | null;
  experience_required?: string | null;
  education_required?: string | null;
  salary_min?: number | null;
  salary_max?: number | null;
  salary_range?: string | null;
  location?: string | null;
  urgency?: string | null;
}

export interface MatchCandidateInput {
  skills?: readonly string[] | null;
  experience_years?: number | null;
  education?: string | null;
  salary_min?: number | null;
  salary_max?: number | null;
  salary_expectation?: string | null;
  current_city?: string | null;
  preferred_locations?: readonly string[] | null;
  availability?: string | null;
  job_change_frequency?: string | number | null;
  resume_text?: string | null;
  verified_experience_years?: number | null;
  experience_years_status?: string | null;
  experience_years_evidence?: string | null;
}

export interface MatchEvidence {
  dimension: string;
  finding: string;
  source: string;
}

export interface MatchLlmSupplement {
  summary?: string;
  evidence: MatchEvidence[];
}

export interface MatchDetails {
  strengths: string[];
  gaps: string[];
  recommendations: string;
  skill_analysis: {
    matched: string[];
    missing: string[];
    bonus_matched: string[];
  };
  salary_analysis: {
    candidate_expectation: string;
    job_range: string;
    overlap: string;
  };
  location_analysis: {
    candidate_city: string;
    job_city: string;
    match: boolean;
  };
  llm_supplement?: MatchLlmSupplement;
  manufacturing_analysis?: import('@/lib/matching/manufacturing-scorer').ManufacturingAnalysis;
}

export interface BaseMatchScore {
  overall_score: number;
  skill_score: number;
  experience_score: number;
  education_score: number;
  salary_score: number;
  location_score: number;
  availability_score: number;
  stability_score: number;
  match_details: MatchDetails;
}

/**
 * Shared deterministic scorer used by both single and batch matching.
 * LLM output must never be used to change these scores or structural findings.
 */
export function calculateBaseMatchScore(
  job: MatchJobInput,
  candidate: MatchCandidateInput,
  weights: MatchScoreWeights = SCORE_WEIGHTS,
): BaseMatchScore {
  const manufacturingScore = calculateManufacturingMatchScore(job, candidate);
  if (manufacturingScore) return manufacturingScore;

  const requiredSkills = [...(job.skills_required ?? [])];
  const bonusSkills = [...(job.bonus_skills ?? [])];
  const candidateSkills = [...(candidate.skills ?? [])];

  const matchedRequired = requiredSkills.filter(requiredSkill =>
    candidateSkills.some(candidateSkill => isSkillMatch(candidateSkill, requiredSkill)),
  );
  const matchedBonus = bonusSkills.filter(bonusSkill =>
    candidateSkills.some(candidateSkill => isSkillMatch(candidateSkill, bonusSkill)),
  );
  const missingRequired = requiredSkills.filter(skill => !matchedRequired.includes(skill));

  let skillScore: number;
  if (requiredSkills.length > 0) {
    skillScore = Math.round(
      (matchedRequired.length / requiredSkills.length) * 80
      + (matchedBonus.length / Math.max(bonusSkills.length, 1)) * 20,
    );
  } else {
    skillScore = candidateSkills.length > 0 ? 60 : 30;
  }
  skillScore = Math.min(100, skillScore);

  const requiredExperience = parseExperienceYears(job.experience_required ?? '');
  const candidateExperience = toFiniteNumber(candidate.experience_years);
  let experienceScore = 50;
  if (requiredExperience > 0) {
    if (candidateExperience >= requiredExperience) {
      experienceScore = Math.min(
        100,
        70 + Math.min((candidateExperience - requiredExperience) * 5, 30),
      );
    } else {
      experienceScore = Math.max(
        20,
        Math.round((candidateExperience / requiredExperience) * 70),
      );
    }
  }

  const educationRequired = job.education_required ?? '';
  const candidateEducation = candidate.education ?? '';
  let educationScore = 70;
  const educationLevels = ['大专', '本科', '硕士', '博士'];
  const requiredEducationLevel = educationLevels.findIndex(level =>
    educationRequired.includes(level),
  );
  const candidateEducationLevel = educationLevels.findIndex(level =>
    candidateEducation.includes(level),
  );
  if (requiredEducationLevel >= 0 && candidateEducationLevel >= 0) {
    educationScore = candidateEducationLevel >= requiredEducationLevel
      ? 100
      : Math.max(30, 100 - (requiredEducationLevel - candidateEducationLevel) * 25);
  }

  const jobSalaryMin = toFiniteNumber(job.salary_min)
    || parseSalaryNumber(job.salary_range ?? '', 'min');
  const jobSalaryMax = toFiniteNumber(job.salary_max)
    || parseSalaryNumber(job.salary_range ?? '', 'max');
  const candidateSalaryMin = toFiniteNumber(candidate.salary_min)
    || parseSalaryNumber(candidate.salary_expectation ?? '', 'min');
  const candidateSalaryMax = toFiniteNumber(candidate.salary_max)
    || parseSalaryNumber(candidate.salary_expectation ?? '', 'max');

  let salaryScore = 50;
  if (jobSalaryMin > 0 && jobSalaryMax > 0 && candidateSalaryMin > 0) {
    const overlapMin = Math.max(jobSalaryMin, candidateSalaryMin);
    const overlapMax = Math.min(jobSalaryMax, candidateSalaryMax);
    if (overlapMax >= overlapMin) {
      const overlapRatio = (overlapMax - overlapMin)
        / (candidateSalaryMax - candidateSalaryMin || 1);
      salaryScore = Math.round(60 + overlapRatio * 40);
    } else {
      const gap = candidateSalaryMin - jobSalaryMax;
      salaryScore = gap > 20 ? 20 : Math.max(30, 60 - gap * 3);
    }
  }

  const jobCity = job.location ?? '';
  const candidateCity = candidate.current_city ?? '';
  const preferredLocations = candidate.preferred_locations ?? [];
  const currentCityMatches = isCityMatch(candidateCity, jobCity);
  let locationScore = 50;
  if (jobCity) {
    if (currentCityMatches) {
      locationScore = 100;
    } else if (preferredLocations.some(location => isCityMatch(location, jobCity))) {
      locationScore = 85;
    } else {
      locationScore = 30;
    }
  }

  const availability = candidate.availability ?? '';
  const availabilityScores: Record<string, number> = {
    immediately: 100,
    '1week': 90,
    '2weeks': 75,
    '1month': 55,
    negotiable: 45,
  };
  let availabilityScore = availabilityScores[availability] ?? 50;
  if (
    job.urgency === 'urgent'
    && (availability === 'immediately' || availability === '1week')
  ) {
    availabilityScore = 100;
  } else if (job.urgency === 'urgent' && availability === '1month') {
    availabilityScore = 30;
  }

  const jobChangeFrequency = toFiniteNumber(candidate.job_change_frequency);
  let stabilityScore = 60;
  if (jobChangeFrequency > 0) {
    if (jobChangeFrequency <= 0.5) stabilityScore = 95;
    else if (jobChangeFrequency <= 1.0) stabilityScore = 80;
    else if (jobChangeFrequency <= 1.5) stabilityScore = 60;
    else if (jobChangeFrequency <= 2.0) stabilityScore = 40;
    else stabilityScore = 20;
  }

  skillScore = normalizeScore(skillScore);
  experienceScore = normalizeScore(experienceScore);
  educationScore = normalizeScore(educationScore);
  salaryScore = normalizeScore(salaryScore);
  locationScore = normalizeScore(locationScore);
  availabilityScore = normalizeScore(availabilityScore);
  stabilityScore = normalizeScore(stabilityScore);

  const overallScore = normalizeScore(
    skillScore * weights.SKILL
    + experienceScore * weights.EXPERIENCE
    + salaryScore * weights.SALARY
    + locationScore * weights.LOCATION
    + availabilityScore * weights.AVAILABILITY
    + stabilityScore * weights.STABILITY,
  );

  const salaryRangesOverlap = (
    jobSalaryMin > 0
    && jobSalaryMax > 0
    && candidateSalaryMin > 0
    && candidateSalaryMax > 0
    && candidateSalaryMin <= jobSalaryMax
    && candidateSalaryMax >= jobSalaryMin
  );

  const matchDetails: MatchDetails = {
    strengths: [
      ...(matchedRequired.length > 0
        ? [`${matchedRequired.length}/${requiredSkills.length} 必需技能匹配: ${matchedRequired.join('、')}`]
        : []),
      ...(matchedBonus.length > 0 ? [`加分技能命中: ${matchedBonus.join('、')}`] : []),
      ...(candidateExperience >= requiredExperience && requiredExperience > 0
        ? [`经验年限满足要求(${candidateExperience}年≥${requiredExperience}年)`]
        : []),
      ...(currentCityMatches ? ['当前城市与岗位城市一致'] : []),
      ...(availability === 'immediately' || availability === '1week'
        ? [`到岗速度快(${availability})`]
        : []),
    ],
    gaps: [
      ...(missingRequired.length > 0
        ? [`${missingRequired.length}项必需技能缺失: ${missingRequired.join('、')}`]
        : []),
      ...(candidateExperience < requiredExperience && requiredExperience > 0
        ? [`经验不足: ${candidateExperience}年 < ${requiredExperience}年`]
        : []),
      ...(!currentCityMatches && jobCity
        ? [`地域不匹配: 候选人在${candidateCity || '未知'}，岗位在${jobCity}`]
        : []),
      ...(candidateSalaryMin > jobSalaryMax && jobSalaryMax > 0
        ? [
            `薪资期望超出范围: ${candidateSalaryMin}-${candidateSalaryMax}K`
            + ` > ${jobSalaryMin}-${jobSalaryMax}K`,
          ]
        : []),
      ...(jobChangeFrequency > 1.5
        ? [`跳槽频率偏高(${jobChangeFrequency}次/年)`]
        : []),
    ],
    recommendations: generateRecommendation(
      overallScore,
      skillScore,
      salaryScore,
      locationScore,
    ),
    skill_analysis: {
      matched: matchedRequired,
      missing: missingRequired,
      bonus_matched: matchedBonus,
    },
    salary_analysis: {
      candidate_expectation: formatSalaryRange(candidateSalaryMin, candidateSalaryMax),
      job_range: formatSalaryRange(jobSalaryMin, jobSalaryMax),
      overlap: salaryRangesOverlap ? '有交集' : '无交集',
    },
    location_analysis: {
      candidate_city: candidateCity || '未知',
      job_city: jobCity || '未知',
      match: currentCityMatches,
    },
  };

  return {
    overall_score: overallScore,
    skill_score: skillScore,
    experience_score: experienceScore,
    education_score: educationScore,
    salary_score: salaryScore,
    location_score: locationScore,
    availability_score: availabilityScore,
    stability_score: stabilityScore,
    match_details: matchDetails,
  };
}

export function parseMatchLlmSupplement(response: string): MatchLlmSupplement | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(response);
  } catch {
    return null;
  }

  const result = matchLlmSupplementSchema.safeParse(parsed);
  return result.success ? result.data : null;
}

export function attachLlmSupplement(
  details: MatchDetails,
  supplement: MatchLlmSupplement | null,
): MatchDetails {
  if (!supplement) {
    return details;
  }
  return { ...details, llm_supplement: supplement };
}

function toFiniteNumber(value: string | number | null | undefined): number {
  const parsed = typeof value === 'number' ? value : Number.parseFloat(value ?? '');
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeScore(value: number): number {
  return Math.min(100, Math.max(0, Math.round(value)));
}

function isSkillMatch(candidateSkill: string, requiredSkill: string): boolean {
  const normalizedCandidateSkill = candidateSkill.toLowerCase().trim();
  const normalizedRequiredSkill = requiredSkill.toLowerCase().trim();
  if (
    normalizedCandidateSkill === normalizedRequiredSkill
    || normalizedCandidateSkill.includes(normalizedRequiredSkill)
    || normalizedRequiredSkill.includes(normalizedCandidateSkill)
  ) {
    return true;
  }

  const skillGroups: readonly (readonly string[])[] = [
    ['react', 'vue', 'angular', '前端框架', 'frontend'],
    ['java', 'kotlin', 'jvm', '后端', 'backend'],
    ['spring', 'spring boot', 'spring cloud', 'springboot'],
    ['python', 'django', 'flask'],
    ['node', 'nodejs', 'node.js'],
    ['typescript', 'javascript', 'ts', 'js'],
    ['mysql', 'postgresql', '数据库', 'database', 'sql'],
    ['redis', '缓存', 'cache'],
    ['docker', 'k8s', 'kubernetes', '容器', 'container'],
    ['aws', '阿里云', '云服务', 'cloud'],
    ['ci/cd', 'jenkins', 'devops'],
    ['微服务', 'microservice', '分布式'],
    ['机器学习', 'ml', '深度学习', 'dl', 'ai'],
    ['大数据', 'hadoop', 'spark', 'flink'],
    ['plc', '可编程逻辑控制器', '工业控制'],
    ['工业机器人', 'robot', '机械臂'],
  ];

  return skillGroups.some(group =>
    group.some(skill =>
      normalizedCandidateSkill.includes(skill) || skill.includes(normalizedCandidateSkill),
    )
    && group.some(skill =>
      normalizedRequiredSkill.includes(skill) || skill.includes(normalizedRequiredSkill),
    ),
  );
}

function parseExperienceYears(experience: string): number {
  const match = experience.match(/(\d+)\s*[-~年]/);
  return match ? Number.parseInt(match[1], 10) : 0;
}

function parseSalaryNumber(salary: string, type: 'min' | 'max'): number {
  const numbers = salary.match(/(\d+)/g);
  if (!numbers) {
    return 0;
  }

  const normalized = numbers
    .map(Number)
    .map(value => value > 1000 ? Math.round(value / 1000) : value);
  return type === 'min' ? Math.min(...normalized) : Math.max(...normalized);
}

function isCityMatch(firstCity: string, secondCity: string): boolean {
  if (!firstCity || !secondCity) {
    return false;
  }
  const normalizedFirstCity = firstCity.replace(/[市区县]/g, '');
  const normalizedSecondCity = secondCity.replace(/[市区县]/g, '');
  return (
    normalizedFirstCity.includes(normalizedSecondCity)
    || normalizedSecondCity.includes(normalizedFirstCity)
  );
}

function formatSalaryRange(min: number, max: number): string {
  return min > 0 || max > 0 ? `${min}-${max}K` : '未提供';
}

function generateRecommendation(
  _overall: number,
  skill: number,
  salary: number,
  location: number,
): string {
  const parts = ['请由招聘者结合证据、缺失信息和候选人意愿作出人工判断'];
  if (skill >= 90) parts.push('技能证据覆盖较充分');
  if (salary < 50) parts.push('需关注薪资期望差异');
  if (location < 50) parts.push('需关注地域匹配问题');

  return `${parts.join('；')}。`;
}
