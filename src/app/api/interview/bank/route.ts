import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { ApiRequestError, parseLimitedJson, SMALL_JSON_BODY_LIMIT } from '@/lib/api-limits';
import { apiErrorResponse } from '@/lib/api-response';
import { getTenantRequestContext } from '@/lib/auth-server';
import { enforceRateLimit } from '@/lib/rate-limit';
import { parseStrictSearchParams } from '@/lib/recruiting/api-contracts';
import { assertNoProhibitedTopic, parseBankBulkText } from '@/lib/recruiting/interview-guide';

const bankListQuerySchema = z.strictObject({
  scope: z.enum(['organization', 'job']).optional(),
  job_id: z.string().trim().uuid('ID 格式无效').optional(),
  dimension: z.string().trim().min(1).max(50).optional(),
  is_active: z.enum(['true', 'false']).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(100),
});

const singleQuestionSchema = z.strictObject({
  scope: z.enum(['organization', 'job']),
  job_id: z.string().trim().uuid('ID 格式无效').optional(),
  dimension: z.string().trim().min(1, '考察点不能为空').max(50, '考察点最多 50 字'),
  question: z.string().trim().min(1, '题目不能为空').max(500, '题目最多 500 字'),
  probe_followups: z.array(z.string().trim().min(1).max(200)).max(2).optional(),
  expected_signals: z.array(z.string().trim().min(1).max(200)).max(3).optional(),
  scoring_anchors: z.array(z.string().trim().min(1).max(200)).max(3).optional(),
  difficulty: z.enum(['基础', '进阶', '高级']).optional(),
}).superRefine((body, context) => {
  if (body.scope === 'job' && !body.job_id) {
    context.addIssue({ code: 'custom', path: ['job_id'], message: '职位级题目必须指定职位' });
  }
  if (body.scope === 'organization' && body.job_id) {
    context.addIssue({ code: 'custom', path: ['job_id'], message: '组织级题目不能指定职位' });
  }
});

const bulkTextSchema = z.strictObject({
  bulk_text: z.string().trim().min(1, '批量文本不能为空').max(100_000, '批量文本过长'),
});

const createBodySchema = z.discriminatedUnion('mode', [
  z.strictObject({ mode: z.literal('single'), ...singleQuestionSchema.shape }),
  z.strictObject({ mode: z.literal('bulk'), bulk_text: z.string().trim().min(1).max(100_000) }),
]);

export async function GET(request: NextRequest) {
  try {
    const { supabase, user } = await getTenantRequestContext(request);
    await enforceRateLimit(supabase, { scope: 'interview:bank:read' });
    const query = parseStrictSearchParams(request.nextUrl.searchParams, bankListQuerySchema);

    let builder = supabase
      .from('interview_question_bank')
      .select('id, scope, job_id, dimension, question, probe_followups, expected_signals, scoring_anchors, difficulty, is_active, version, created_at, updated_at')
      .eq('organization_id', user.organizationId)
      .order('created_at', { ascending: false })
      .limit(query.limit);
    if (query.scope) builder = builder.eq('scope', query.scope);
    if (query.job_id) builder = builder.eq('job_id', query.job_id);
    if (query.dimension) builder = builder.ilike('dimension', `%${query.dimension}%`);
    if (query.is_active) builder = builder.eq('is_active', query.is_active === 'true');

    const { data, error } = await builder;
    if (error) throw new Error('面试题库读取失败');
    return NextResponse.json({ success: true, data: data ?? [] });
  } catch (error) {
    return apiErrorResponse(error, '面试题库读取失败');
  }
}

export async function POST(request: NextRequest) {
  try {
    const { supabase, user } = await getTenantRequestContext(request);
    await enforceRateLimit(supabase, { scope: 'interview:bank:write' });
    const body = await parseLimitedJson(request, createBodySchema, SMALL_JSON_BODY_LIMIT);

    if (body.mode === 'single') {
      assertNoProhibitedTopic(body.question);
      const { data, error } = await supabase
        .from('interview_question_bank')
        .insert({
          organization_id: user.organizationId,
          scope: body.scope,
          job_id: body.scope === 'job' ? body.job_id : null,
          dimension: body.dimension,
          question: body.question,
          probe_followups: body.probe_followups ?? [],
          expected_signals: body.expected_signals ?? [],
          scoring_anchors: body.scoring_anchors ?? [],
          difficulty: body.difficulty ?? null,
          source: 'user',
          created_by: user.userId,
        })
        .select('id, scope, job_id, dimension, question, probe_followups, expected_signals, scoring_anchors, difficulty, is_active, version')
        .single();
      if (error) {
        if (error.code === '23505') {
          throw new ApiRequestError('该题目已存在于题库', 409);
        }
        throw new Error('面试题库新增失败');
      }
      return NextResponse.json({ success: true, data });
    }

    const lines = parseBankBulkText(body.bulk_text);
    const created: string[] = [];
    const skipped: string[] = [];
    const errors: Array<{ line: number; message: string }> = [];
    for (const line of lines) {
      if (line.error) {
        errors.push({ line: line.line, message: line.error });
        continue;
      }
      try {
        assertNoProhibitedTopic(line.question);
      } catch (error) {
        errors.push({
          line: line.line,
          message: error instanceof ApiRequestError ? error.message : '题目包含禁止询问的内容',
        });
        continue;
      }
      const { data, error } = await supabase
        .from('interview_question_bank')
        .insert({
          organization_id: user.organizationId,
          scope: 'organization',
          job_id: null,
          dimension: line.dimension,
          question: line.question,
          probe_followups: [],
          expected_signals: line.expected_signals,
          scoring_anchors: [],
          source: 'user',
          created_by: user.userId,
        })
        .select('id')
        .single();
      if (error) {
        if (error.code === '23505') {
          skipped.push(line.question);
        } else {
          errors.push({ line: line.line, message: `写入失败：${error.message}` });
        }
        continue;
      }
      created.push(data.id);
    }

    return NextResponse.json({
      success: true,
      data: { created: created.length, skipped: skipped.length, errors },
    });
  } catch (error) {
    return apiErrorResponse(error, '面试题库写入失败');
  }
}
