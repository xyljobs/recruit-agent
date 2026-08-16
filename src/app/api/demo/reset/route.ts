import { NextRequest, NextResponse } from 'next/server';
import { getAdminRequestContext } from '@/lib/auth-server';
import { apiErrorResponse } from '@/lib/api-response';
import { getSupabaseServiceClient } from '@/storage/database/supabase-client';
import { DEMO_ORG_SLUGS, resetDemoBusinessData, seedDemoData } from '@/lib/demo/demo-data';

/**
 * 演示数据重置（仅限演示组织的管理员）：
 * - GET：查询当前组织是否为演示组织（前端据此决定是否展示重置入口）
 * - POST：清空两个演示组织的业务数据并重跑 seed 恢复基线
 */
export async function GET(request: NextRequest) {
  try {
    const { user } = await getAdminRequestContext(request);
    const { data: organization } = await getSupabaseServiceClient()
      .from('organizations')
      .select('slug')
      .eq('id', user.organizationId)
      .maybeSingle();
    const available =
      !!organization && (DEMO_ORG_SLUGS as readonly string[]).includes(organization.slug);
    return NextResponse.json({
      success: true,
      data: { available, demo_orgs: DEMO_ORG_SLUGS },
    });
  } catch (error) {
    return apiErrorResponse(error, '查询演示环境状态失败');
  }
}

export async function POST(request: NextRequest) {
  try {
    const { user } = await getAdminRequestContext(request);
    const service = getSupabaseServiceClient();
    const { data: organization } = await service
      .from('organizations')
      .select('slug')
      .eq('id', user.organizationId)
      .maybeSingle();
    if (!organization || !(DEMO_ORG_SLUGS as readonly string[]).includes(organization.slug)) {
      return NextResponse.json(
        { success: false, error: '仅演示组织支持一键重置（slug: drill / lanwan-precision）' },
        { status: 403 },
      );
    }

    const reset = await resetDemoBusinessData({ supabase: service });
    const seeded = await seedDemoData();

    return NextResponse.json({
      success: true,
      data: {
        deleted_total: reset.totalDeleted,
        candidates_inserted: seeded.candidatesInserted,
        jobs_inserted: seeded.jobsInserted,
        jobs_backfilled: seeded.jobsBackfilled,
      },
    });
  } catch (error) {
    return apiErrorResponse(error, '重置演示数据失败');
  }
}
