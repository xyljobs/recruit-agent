import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { SCORE_WEIGHTS, type MatchScoreWeights } from './scorer';

const weightsSchema = z.object({
  SKILL: z.number().min(0).max(1),
  EXPERIENCE: z.number().min(0).max(1),
  SALARY: z.number().min(0).max(1),
  LOCATION: z.number().min(0).max(1),
  AVAILABILITY: z.number().min(0).max(1),
  STABILITY: z.number().min(0).max(1),
}).strict().refine(weights => (
  Math.abs(Object.values(weights).reduce((sum, value) => sum + value, 0) - 1) < 0.000001
), 'weights must sum to 1.0');

export interface ActiveScoringWeights {
  weights: MatchScoreWeights;
  version: string;
}

export async function loadActiveScoringWeights(
  supabase: SupabaseClient,
  organizationId: string,
): Promise<ActiveScoringWeights> {
  const { data, error } = await supabase
    .from('scoring_weight_versions')
    .select('version,weights')
    .eq('organization_id', organizationId)
    .eq('status', 'active')
    .maybeSingle();
  if (error) throw new Error(`读取生效评分权重失败: ${error.message}`);
  if (!data) return { weights: SCORE_WEIGHTS, version: 'match-weights-v1' };
  const parsed = weightsSchema.safeParse(data.weights);
  if (!parsed.success) throw new Error('生效评分权重结构无效');
  return {
    weights: parsed.data,
    version: `organization-calibration-v${data.version}`,
  };
}
