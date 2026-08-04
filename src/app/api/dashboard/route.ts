import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { decryptField } from '@/lib/encryption';
import { getTenantRequestContext } from '@/lib/auth-server';
import { apiErrorResponse } from '@/lib/api-response';
import { enforceRateLimit, RATE_LIMITS } from '@/lib/rate-limit';

const countSchema = z.number().int().min(0);
const nullableScoreSchema = z.number().int().min(0).max(100).nullable();

const dashboardMetricsSchema = z.object({
  total_jobs: countSchema,
  total_candidates: countSchema,
  total_matches: countSchema,
  status_stats: z.object({
    pending: countSchema,
    contacted: countSchema,
    interviewing: countSchema,
    offered: countSchema,
    hired: countSchema,
    rejected: countSchema,
    withdrawn: countSchema,
  }),
  avg_scores: z.object({
    overall: nullableScoreSchema,
    skill: nullableScoreSchema,
    experience: nullableScoreSchema,
    education: nullableScoreSchema,
    salary: nullableScoreSchema,
    location: nullableScoreSchema,
    availability: nullableScoreSchema,
    stability: nullableScoreSchema,
  }),
  funnel_counts: z.object({
    contacted: countSchema,
    interviewing: countSchema,
    offered: countSchema,
    hired: countSchema,
  }),
});

export async function GET(request: NextRequest) {
  try {
    const { supabase, user } = await getTenantRequestContext(request);
    await enforceRateLimit(supabase, RATE_LIMITS.dashboard);

    const [
      { data: rawMetrics, error: metricsError },
      { data: recentMatches, error: recentError },
      { data: topMatches, error: topError },
    ] = await Promise.all([
      supabase.rpc('get_dashboard_metrics'),
      supabase
        .from('match_records')
        .select(`
          id,
          overall_score,
          skill_score,
          experience_score,
          salary_score,
          location_score,
          availability_score,
          stability_score,
          status,
          created_at,
          job:job_requirements(id, title),
          candidate:candidates(id, name, current_company)
        `)
        .eq('organization_id', user.organizationId)
        .eq('scoring_status', 'succeeded')
        .order('created_at', { ascending: false })
        .limit(10),
      supabase
        .from('match_records')
        .select(`
          id,
          overall_score,
          skill_score,
          experience_score,
          salary_score,
          location_score,
          availability_score,
          stability_score,
          job:job_requirements(id, title),
          candidate:candidates(id, name, current_company)
        `)
        .eq('organization_id', user.organizationId)
        .eq('scoring_status', 'succeeded')
        .gte('overall_score', 70)
        .eq('status', 'pending')
        .order('overall_score', { ascending: false })
        .limit(5),
    ]);

    if (metricsError) {
      throw new Error(`看板聚合查询失败: ${metricsError.message}`);
    }
    if (recentError) {
      throw new Error(`最近匹配查询失败: ${recentError.message}`);
    }
    if (topError) {
      throw new Error(`高匹配候选人查询失败: ${topError.message}`);
    }

    const metrics = dashboardMetricsSchema.safeParse(rawMetrics);
    if (!metrics.success) {
      throw new Error('看板聚合查询返回了无效结果');
    }

    const decryptMatchRecord = (record: Record<string, unknown>) => {
      const candidate = record.candidate as Record<string, unknown> | null;
      if (candidate) {
        candidate.name = decryptField(candidate.name as string) || candidate.name;
        candidate.current_company = decryptField(candidate.current_company as string) || candidate.current_company;
      }
      return record;
    };
    const decryptedRecent = (recentMatches || []).map(decryptMatchRecord);
    const decryptedTop = (topMatches || []).map(decryptMatchRecord);

    const totalMatches = metrics.data.total_matches;
    const funnelData = [
      { stage: '已完成匹配', count: totalMatches },
      { stage: '已联系', count: metrics.data.funnel_counts.contacted },
      { stage: '进入面试', count: metrics.data.funnel_counts.interviewing },
      { stage: '已发 Offer', count: metrics.data.funnel_counts.offered },
      { stage: '已录用', count: metrics.data.funnel_counts.hired },
    ].map(stage => ({
      ...stage,
      rate: totalMatches > 0 ? Math.round((stage.count / totalMatches) * 100) : 0,
    }));

    return NextResponse.json({
      success: true,
      data: {
        stats: {
          totalJobs: metrics.data.total_jobs,
          totalCandidates: metrics.data.total_candidates,
          totalMatches,
          ...metrics.data.status_stats,
        },
        avgScores: metrics.data.avg_scores,
        recentMatches: decryptedRecent,
        topMatches: decryptedTop,
        funnelData,
      },
    });
  } catch (error) {
    console.error('获取看板数据失败:', error);
    return apiErrorResponse(error, '获取看板数据失败');
  }
}
