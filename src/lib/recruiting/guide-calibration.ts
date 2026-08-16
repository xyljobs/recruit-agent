/**
 * 提纲专项题命中率聚合（校准输入）。
 * 只读取 recruiting_outcome_events 中 interview_feedback 事件的 metadata，
 * 聚合专项题命中率（总体 / 按 origin / 按提纲），
 * 作为管理员提出评分权重校准（/api/calibration propose）时的证据输入。
 * 本模块为纯函数：不写库、不决定权重，命中率只作展示与人工判断依据。
 */

export const GUIDE_QUESTION_ORIGINS = [
  'evidence_gap',
  'depth_check',
  'boundary_risk',
  'resume_probe',
] as const;

export type GuideQuestionOrigin = typeof GUIDE_QUESTION_ORIGINS[number];

export interface GuideCalibrationEvent {
  event_type: string;
  metadata: Record<string, unknown> | null;
}

export interface GuideHitGroupStats {
  key: string;
  total: number;
  hit_count: number;
  hit_rate: number;
}

export interface GuideHitStats {
  /** 关联了面试提纲的 interview_feedback 事件数 */
  feedback_events: number;
  /** 其中携带逐题命中结果的事件数 */
  events_with_results: number;
  /** 逐题命中记录总数 */
  total_results: number;
  hit_count: number;
  /** 无记录时为 null */
  hit_rate: number | null;
  by_origin: GuideHitGroupStats[];
  by_guide: GuideHitGroupStats[];
}

interface QuestionResultRecord {
  question: string;
  origin: GuideQuestionOrigin;
  hit: boolean;
}

function roundRate(hitCount: number, total: number): number {
  return Math.round((hitCount / total) * 1000) / 1000;
}

/** 防御性校验：历史数据或旁路写入的畸形条目直接跳过，不抛错 */
function isQuestionResult(value: unknown): value is QuestionResultRecord {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return typeof record.question === 'string'
    && record.question.trim().length > 0
    && typeof record.hit === 'boolean'
    && (GUIDE_QUESTION_ORIGINS as readonly string[]).includes(String(record.origin));
}

function pushGroup(
  groups: Map<string, { total: number; hit_count: number }>,
  key: string,
  hit: boolean,
): void {
  const current = groups.get(key) ?? { total: 0, hit_count: 0 };
  current.total += 1;
  if (hit) current.hit_count += 1;
  groups.set(key, current);
}

function toSortedStats(
  groups: Map<string, { total: number; hit_count: number }>,
  order?: readonly string[],
): GuideHitGroupStats[] {
  const entries = [...groups.entries()]
    .filter(([, value]) => value.total > 0);
  entries.sort((left, right) => {
    if (order) {
      const leftIndex = order.indexOf(left[0]);
      const rightIndex = order.indexOf(right[0]);
      if (leftIndex !== rightIndex) return leftIndex - rightIndex;
    }
    if (right[1].total !== left[1].total) return right[1].total - left[1].total;
    return left[0].localeCompare(right[0]);
  });
  return entries.map(([key, value]) => ({
    key,
    total: value.total,
    hit_count: value.hit_count,
    hit_rate: roundRate(value.hit_count, value.total),
  }));
}

export function computeGuideHitStats(
  events: readonly GuideCalibrationEvent[],
): GuideHitStats {
  let feedbackEvents = 0;
  let eventsWithResults = 0;
  let totalResults = 0;
  let hitCount = 0;
  const byOrigin = new Map<string, { total: number; hit_count: number }>();
  const byGuide = new Map<string, { total: number; hit_count: number }>();

  for (const event of events) {
    if (event.event_type !== 'interview_feedback') continue;
    const metadata = event.metadata ?? {};
    const guideId = typeof metadata.interview_guide_id === 'string'
      ? metadata.interview_guide_id
      : null;
    if (!guideId) continue;
    feedbackEvents += 1;

    const rawResults = Array.isArray(metadata.question_results)
      ? metadata.question_results
      : [];
    const results = rawResults.filter(isQuestionResult);
    if (results.length === 0) continue;
    eventsWithResults += 1;

    for (const result of results) {
      totalResults += 1;
      if (result.hit) hitCount += 1;
      pushGroup(byOrigin, result.origin, result.hit);
      pushGroup(byGuide, guideId, result.hit);
    }
  }

  return {
    feedback_events: feedbackEvents,
    events_with_results: eventsWithResults,
    total_results: totalResults,
    hit_count: hitCount,
    hit_rate: totalResults > 0 ? roundRate(hitCount, totalResults) : null,
    by_origin: toSortedStats(byOrigin, GUIDE_QUESTION_ORIGINS),
    by_guide: toSortedStats(byGuide),
  };
}
