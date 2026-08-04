import bcrypt from 'bcryptjs';
import { NextRequest, NextResponse } from 'next/server';
import { setAuthCookies } from '@/lib/auth-cookie';
import {
  createAuthenticatedSession,
  getRequestUser,
  revokeAllAuthSessions,
} from '@/lib/auth-server';
import { getPasswordValidationError } from '@/lib/password-policy';
import { getSupabaseServiceClient } from '@/storage/database/supabase-client';

interface ChangePasswordBody {
  currentPassword?: unknown;
  newPassword?: unknown;
}

export async function POST(request: NextRequest) {
  try {
    const requestUser = await getRequestUser(request);
    const body = await request.json() as ChangePasswordBody;
    const currentPassword = body.currentPassword;
    const newPassword = body.newPassword;

    if (typeof currentPassword !== 'string' || !currentPassword) {
      return NextResponse.json(
        { success: false, error: '请输入当前密码' },
        { status: 400 }
      );
    }

    const passwordError = getPasswordValidationError(newPassword);
    if (passwordError) {
      return NextResponse.json(
        { success: false, error: passwordError },
        { status: 400 }
      );
    }
    if (typeof newPassword !== 'string') {
      return NextResponse.json(
        { success: false, error: '密码格式无效' },
        { status: 400 }
      );
    }
    if (currentPassword === newPassword) {
      return NextResponse.json(
        { success: false, error: '新密码不能与当前密码相同' },
        { status: 400 }
      );
    }

    const supabase = getSupabaseServiceClient();
    const { data: user, error: userError } = await supabase
      .from('users')
      .select('id, email, name, password_hash, is_active, auth_version')
      .eq('id', requestUser.userId)
      .eq('organization_id', requestUser.organizationId)
      .single();

    if (userError || !user || user.is_active === false) {
      return NextResponse.json(
        { success: false, error: '用户不存在或已停用' },
        { status: 401 }
      );
    }

    const currentPasswordValid = await bcrypt.compare(currentPassword, user.password_hash);
    if (!currentPasswordValid) {
      return NextResponse.json(
        { success: false, error: '当前密码错误' },
        { status: 401 }
      );
    }

    const passwordHash = await bcrypt.hash(newPassword, 12);
    const { data: updatedUser, error: updateError } = await supabase
      .from('users')
      .update({
        password_hash: passwordHash,
        must_change_password: false,
        updated_at: new Date().toISOString(),
      })
      .eq('id', user.id)
      .eq('organization_id', requestUser.organizationId)
      .select('auth_version')
      .single();

    if (updateError || !updatedUser) {
      throw new Error(`更新密码失败: ${updateError.message}`);
    }

    await revokeAllAuthSessions(user.id);
    const { token } = await createAuthenticatedSession({
      id: user.id,
      email: user.email,
      name: user.name,
      appRole: requestUser.role,
      organizationId: requestUser.organizationId,
      mustChangePassword: false,
      authVersion: updatedUser.auth_version,
    });
    const response = NextResponse.json({
      success: true,
      data: { token },
      message: '密码已更新',
    });

    setAuthCookies(response, request, token);

    return response;
  } catch {
    return NextResponse.json(
      { success: false, error: '修改密码失败，请重新登录后重试' },
      { status: 500 }
    );
  }
}
