import { NextRequest, NextResponse } from 'next/server';
import { getAdminRequestContext } from '@/lib/auth-server';

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { supabase, user } = await getAdminRequestContext(request);
    const { id } = await params;

    // 仅允许撤销尚未接受的邀请；已接受的邀请对应真实成员，不允许删除
    const { data, error } = await supabase
      .from('organization_invitations')
      .delete()
      .eq('id', id)
      .eq('organization_id', user.organizationId)
      .is('accepted_at', null)
      .select('id');

    if (error) {
      throw new Error(error.message);
    }
    if (!data || data.length === 0) {
      return NextResponse.json(
        { success: false, error: '邀请不存在或已被接受' },
        { status: 404 },
      );
    }
    return NextResponse.json({ success: true, data: { id: data[0].id } });
  } catch (error) {
    const message = error instanceof Error ? error.message : '未知错误';
    const status = message === '未登录' || message === '登录信息无效'
      ? 401
      : message === '权限不足'
        ? 403
        : 500;
    return NextResponse.json({ success: false, error: message }, { status });
  }
}
