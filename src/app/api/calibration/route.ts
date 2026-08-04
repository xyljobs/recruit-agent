import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getAdminRequestContext } from '@/lib/auth-server';
import { SMALL_JSON_BODY_LIMIT, parseLimitedJson } from '@/lib/api-limits';
import { apiErrorResponse } from '@/lib/api-response';

const bodySchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('propose'),
    proposed_weights: z.object({
      SKILL: z.number().finite().min(0).max(1),
      EXPERIENCE: z.number().finite().min(0).max(1),
      SALARY: z.number().finite().min(0).max(1),
      LOCATION: z.number().finite().min(0).max(1),
      AVAILABILITY: z.number().finite().min(0).max(1),
      STABILITY: z.number().finite().min(0).max(1),
    }).strict().refine(weights => Math.abs(Object.values(weights).reduce((sum, value) => sum + value, 0) - 1) < 0.000001, '权重总和必须为 1.0'),
    rationale: z.string().trim().min(1).max(2000),
  }).strict(),
  z.object({
    action: z.literal('review'),
    proposal_id: z.string().uuid(),
    decision: z.enum(['approved', 'rejected']),
  }).strict(),
]);

export async function POST(request: NextRequest) {
  try {
    const body = await parseLimitedJson(request, bodySchema, SMALL_JSON_BODY_LIMIT);
    const { supabase } = await getAdminRequestContext(request);
    const result = body.action === 'propose'
      ? await supabase.rpc('propose_scoring_calibration', {
          p_proposed_weights: body.proposed_weights,
          p_rationale: body.rationale,
        })
      : await supabase.rpc('review_scoring_calibration', {
          p_proposal_id: body.proposal_id,
          p_decision: body.decision,
        });
    if (result.error) throw new Error(`校准操作失败: ${result.error.message}`);
    return NextResponse.json({ success: true, data: result.data });
  } catch (error) {
    return apiErrorResponse(error, '校准操作失败');
  }
}
