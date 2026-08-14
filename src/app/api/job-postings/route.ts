import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { parseLimitedJson, SMALL_JSON_BODY_LIMIT } from '@/lib/api-limits';
import { apiErrorResponse } from '@/lib/api-response';
import { getTenantRequestContext } from '@/lib/auth-server';
import { parseStrictSearchParams } from '@/lib/recruiting/api-contracts';
import { enforceRateLimit, RATE_LIMITS } from '@/lib/rate-limit';

export const JOB_POSTING_PLATFORMS = [
  'Boss直聘',
  '智联',
  '58',
  '猎聘',
  'LinkedIn',
  '内推',
  '其他',
] as const;

const jobPostingsQuerySchema = z.strictObject({
  jobId: z.string().trim().uuid('职位ID格式无效'),
});

const jobPostingsCreateBodySchema = z.strictObject({
  jobId: z.string().trim().uuid('职位ID格式无效'),
  platform: z.enum(JOB_POSTING_PLATFORMS),
  url: z
    .string()
    .trim()
    .max(1000, '链接过长')
    .refine((value) => !value || /^https?:\/\//.test(value), '链接需以 http(s):// 开头')
    .optional(),
  note: z.string().trim().max(500, '备注过长').optional(),
});

interface JobPostingRow {
  id: string;
  platform: string;
  url: string | null;
  note: string | null;
  posted_at: string;
}

/**
 * 发布台账 - 职位发布渠道登记
 * GET  ?jobId= 查询当前职位已登记发布记录（按发布时间降序）
 * POST { jobId, platform, url?, note? } 登记一次发布
 */
export async function GET(request: NextRequest) {
  try {
    const { supabase, user } = await getTenantRequestContext(request);
    await enforceRateLimit(supabase, RATE_LIMITS.jobPostingsRead);
    const { searchParams } = new URL(request.url);
    const query = await parseStrictSearchParams(searchParams, jobPostingsQuerySchema);

    const { data: job } = await supabase
      .from('job_requirements')
      .select('id')
      .eq('id', query.jobId)
      .eq('organization_id', user.organizationId)
      .maybeSingle();
    if (!job) {
      return NextResponse.json(
        { success: false, error: '职位不存在' },
        { status: 404 },
      );
    }

    const { data, error } = await supabase
      .from('job_postings')
      .select('id, platform, url, note, posted_at')
      .eq('organization_id', user.organizationId)
      .eq('job_id', query.jobId)
      .order('posted_at', { ascending: false })
      .limit(100);
    if (error) {
      throw new Error(`查询发布台账失败: ${error.message}`);
    }

    const postings = ((data ?? []) as unknown as JobPostingRow[]).map((posting) => ({
      id: posting.id,
      platform: posting.platform,
      url: posting.url,
      note: posting.note,
      posted_at: posting.posted_at,
    }));

    return NextResponse.json({ success: true, data: postings });
  } catch (error) {
    return apiErrorResponse(error, '获取发布台账失败');
  }
}

export async function POST(request: NextRequest) {
  try {
    const { supabase, user } = await getTenantRequestContext(request);
    await enforceRateLimit(supabase, RATE_LIMITS.jobPostingsCreate);
    const body = await parseLimitedJson(
      request,
      jobPostingsCreateBodySchema,
      SMALL_JSON_BODY_LIMIT,
    );

    const { data: job } = await supabase
      .from('job_requirements')
      .select('id')
      .eq('id', body.jobId)
      .eq('organization_id', user.organizationId)
      .maybeSingle();
    if (!job) {
      return NextResponse.json(
        { success: false, error: '职位不存在' },
        { status: 404 },
      );
    }

    const { data: posting, error } = await supabase
      .from('job_postings')
      .insert({
        organization_id: user.organizationId,
        job_id: body.jobId,
        platform: body.platform,
        url: body.url ?? null,
        note: body.note ?? null,
        posted_at: new Date().toISOString(),
        created_by: user.userId,
      })
      .select('id, platform, url, note, posted_at')
      .single();
    if (error) {
      throw new Error(`登记发布失败: ${error.message}`);
    }

    return NextResponse.json({
      success: true,
      data: {
        id: posting.id,
        platform: posting.platform,
        url: posting.url,
        note: posting.note,
        posted_at: posting.posted_at,
      },
    });
  } catch (error) {
    return apiErrorResponse(error, '登记发布失败');
  }
}
