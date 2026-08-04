import { NextRequest, NextResponse } from 'next/server';
import { getTenantRequestContext } from '@/lib/auth-server';

export async function GET(request: NextRequest) {
  try {
    const { supabase, user } = await getTenantRequestContext(request);
    const { data, error } = await supabase
      .from('resume_batch_sheets')
      .select('id, name, worksheet_id, created_at')
      .eq('organization_id', user.organizationId)
      .order('created_at', { ascending: false });

    if (error) {
      throw new Error(error.message);
    }

    return NextResponse.json({
      success: true,
      data: data || [],
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : '未知错误';
    const status = message === '未登录' || message === '登录信息无效' ? 401 : 500;
    return NextResponse.json(
      { success: false, error: `读取表格预设失败: ${message}` },
      { status },
    );
  }
}
