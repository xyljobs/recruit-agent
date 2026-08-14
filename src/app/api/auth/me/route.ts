import { NextRequest, NextResponse } from 'next/server';
import { getTenantRequestContext } from '@/lib/auth-server';
import { getSupabaseServiceClient } from '@/storage/database/supabase-client';

interface MembershipRow {
  role: string;
  organizations: { id: string; name: string; slug: string; is_active: boolean } | null;
}

export async function GET(request: NextRequest) {
  try {
    const { supabase, user: requestUser } = await getTenantRequestContext(request);

    // 获取最新用户信息；多组织模型下不再限定 users.organization_id，
    // 租户身份由会话校验（validate_auth_session）保证
    const { data: user, error } = await supabase
      .from('users')
      .select('id, email, name, role, company, avatar_url, is_active, must_change_password, mfa_enabled, created_at, organization_id')
      .eq('id', requestUser.userId)
      .single();

    if (error || !user) {
      return NextResponse.json(
        { error: '用户不存在', authenticated: false },
        { status: 401 }
      );
    }

    const { data: organization } = await supabase
      .from('organizations')
      .select('name, slug')
      .eq('id', requestUser.organizationId)
      .single();

    // 当前账号加入的全部有效组织，供导航栏组织切换器使用
    const serviceSupabase = getSupabaseServiceClient();
    const { data: membershipRows, error: membershipError } = await serviceSupabase
      .from('organization_members')
      .select('role, organizations ( id, name, slug, is_active )')
      .eq('user_id', requestUser.userId)
      .eq('is_active', true);
    if (membershipError) {
      throw new Error(`查询组织成员关系失败: ${membershipError.message}`);
    }
    const memberships = (membershipRows ?? []) as unknown as MembershipRow[];
    const organizations = memberships
      .filter((row) => row.organizations?.is_active === true)
      .map((row) => ({
        id: row.organizations?.id ?? '',
        name: row.organizations?.name ?? '',
        slug: row.organizations?.slug ?? '',
        role: row.role,
      }))
      .filter((item) => item.id !== '');

    return NextResponse.json({
      success: true,
      data: {
        ...user,
        role: requestUser.role,
        company: organization?.name || user.company,
        current_organization: {
          id: requestUser.organizationId,
          name: organization?.name || user.company || '',
          slug: organization?.slug ?? '',
        },
        organizations,
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
