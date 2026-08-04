import { NextRequest, NextResponse } from 'next/server';
import { getTenantRequestContext } from '@/lib/auth-server';

export async function GET(request: NextRequest) {
  try {
    const { supabase, user: requestUser } = await getTenantRequestContext(request);

    // 获取最新用户信息
    const { data: user, error } = await supabase
      .from('users')
      .select('id, email, name, role, company, avatar_url, is_active, must_change_password, mfa_enabled, created_at, organization_id')
      .eq('id', requestUser.userId)
      .eq('organization_id', requestUser.organizationId)
      .single();

    if (error || !user) {
      return NextResponse.json(
        { error: '用户不存在', authenticated: false },
        { status: 401 }
      );
    }

    const { data: organization } = await supabase
      .from('organizations')
      .select('name')
      .eq('id', requestUser.organizationId)
      .single();

    return NextResponse.json({
      success: true,
      data: {
        ...user,
        role: requestUser.role,
        company: organization?.name || user.company,
      },
      authenticated: true
    });
  } catch {
    return NextResponse.json(
      { error: '登录已过期', authenticated: false },
      { status: 401 }
    );
  }
}
