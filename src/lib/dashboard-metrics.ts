const SCORE_DIMENSIONS = [
  ['overall', 'overall_score'],
  ['skill', 'skill_score'],
  ['experience', 'experience_score'],
  ['education', 'education_score'],
  ['salary', 'salary_score'],
  ['location', 'location_score'],
  ['availability', 'availability_score'],
  ['stability', 'stability_score'],
] as const;

type AverageScoreKey = (typeof SCORE_DIMENSIONS)[number][0];
type ScoreColumn = (typeof SCORE_DIMENSIONS)[number][1];

export type AverageScores = Record<AverageScoreKey, number | null>;

export type MatchScoreRecord = Partial<Record<ScoreColumn, number | null>>;

export interface MatchFlowRecord {
  status?: unknown;
  status_history?: unknown;
}

export interface FunnelData {
  stage: string;
  count: number;
  rate: number;
}

const FUNNEL_STAGES = [
  { stage: '已完成匹配', status: null },
  { stage: '已联系', status: 'contacted' },
  { stage: '进入面试', status: 'interviewing' },
  { stage: '已发 Offer', status: 'offered' },
  { stage: '已录用', status: 'hired' },
] as const;

export function calculateAverageScores(records: readonly MatchScoreRecord[]): AverageScores {
  return Object.fromEntries(
    SCORE_DIMENSIONS.map(([key, column]) => {
      const values = records
        .map((record) => record[column])
        .filter((value): value is number => typeof value === 'number' && Number.isFinite(value));

      const average = values.length > 0
        ? Math.round(values.reduce((sum, value) => sum + value, 0) / values.length)
        : null;

      return [key, average];
    }),
  ) as AverageScores;
}

export function buildCumulativeFunnel(records: readonly MatchFlowRecord[]): FunnelData[] {
  const reachedStatuses = records.map((record) => {
    const statuses = new Set<string>();

    if (typeof record.status === 'string') {
      statuses.add(record.status);
    }

    if (Array.isArray(record.status_history)) {
      record.status_history.forEach((entry: unknown) => {
        if (
          typeof entry === 'object'
          && entry !== null
          && 'status' in entry
          && typeof entry.status === 'string'
        ) {
          statuses.add(entry.status);
        }
      });
    }

    return statuses;
  });

  const total = records.length;

  return FUNNEL_STAGES.map(({ stage, status }) => {
    const count = status === null
      ? total
      : reachedStatuses.filter((statuses) => statuses.has(status)).length;

    return {
      stage,
      count,
      rate: total > 0 ? Math.round((count / total) * 100) : 0,
    };
  });
}
