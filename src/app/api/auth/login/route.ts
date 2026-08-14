import bcrypt from 'bcryptjs';
import { NextRequest, NextResponse } from 'next/server';
import { setAuthCookies } from '@/lib/auth-cookie';
import { createAuthenticatedSession } from '@/lib/auth-server';
import { decryptField } from '@/lib/encryption';
import {
  isAccountLocked,
  isLoginRateLimited,
  recordLoginFailure,
  recordLoginSuccess,
} from '@/lib/login-protection';
import { hashRecoveryCode, verifyTotp } from '@/lib/totp';
import { getSupabaseServiceClient } from '@/storage/database/supabase-client';

const DUMMY_PASSWORD_HASH = '$2b$12$2bauMsUUX94vHdKQNCpiM.UJ0W.v/KG4Zo0RntPiQEcwnq8kUXdXS';
const RETRY_AFTER_SECONDS = 15 * 60;

interface LoginBody {
  email?: unknown;
  password?: unknown;
  mfaCode?: unknown;
  organizationSlug?: unknown;
}

function invalidCredentials(): NextResponse {
  return NextResponse.json(
    { success: false, error: '邮箱、密码或组织不匹配' },
    { status: 401 },
  );
}

function rateLimited(): NextResponse {
  return NextResponse.json(
    { success: false, error: '登录尝试过多，请 15 分钟后重试' },
    {
      status: 429,
      headers: { 'Retry-After': String(RETRY_AFTER_SECONDS) },
    },
  );
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as LoginBody;
    const email = typeof body.email === 'string'
      ? body.email.trim().toLowerCase()
      : '';
    const password = typeof body.password === 'string' ? body.password : '';
    const mfaCode = typeof body.mfaCode === 'string' ? body.mfaCode.trim() : '';
    const organizationSlug = typeof body.organizationSlug === 'string'
      ? body.organizationSlug.trim().toLowerCase()
      : '';

    if (
      !email
      || !password
      || email.length > 255
      || new TextEncoder().encode(password).length > 72
    ) {
      return NextResponse.json(
        { success: false, error: '请输入有效的邮箱和密码' },
        { status: 400 },
      );
    }
    if (!organizationSlug) {
      return NextResponse.json(
        { success: false, error: '请选择组织' },
        { status: 400 },
      );
    }
    if (await isLoginRateLimited(request, email)) {
      return rateLimited();
    }

    const supabase = getSupabaseServiceClient();
    const { data: user, error } = await supabase
      .from('users')
      .select('id, organization_id, email, password_hash, name, company, avatar_url, is_active, must_change_password, auth_version, failed_login_attempts, locked_until, mfa_enabled, mfa_secret_encrypted, mfa_recovery_codes')
      .eq('email', email)
      .single();

    if (error || !user || user.is_active === false) {
      await bcrypt.compare(password, DUMMY_PASSWORD_HASH);
      await recordLoginFailure(request, email);
      return invalidCredentials();
    }
    if (isAccountLocked(user.locked_until)) {
      await recordLoginFailure(request, email);
      return rateLimited();
    }

    const isValidPassword = await bcrypt.compare(password, user.password_hash);
    if (!isValidPassword) {
      await recordLoginFailure(request, email, user.id);
      return invalidCredentials();
    }

    // 多组织模型：租户身份来自登录时所选组织的 organization_members 记录，
    // 不再依赖 users.organization_id（该字段仅作主组织兼容用途）
    const { data: organization } = await supabase
      .from('organizations')
      .select('id, name, is_active')
      .eq('slug', organizationSlug)
      .eq('is_active', true)
      .maybeSingle();

    const { data: membership } = organization
      ? await supabase
          .from('organization_members')
          .select('organization_id, role, is_active')
          .eq('user_id', user.id)
          .eq('organization_id', organization.id)
          .eq('is_active', true)
          .maybeSingle()
      : { data: null };

    // 组织不存在/已停用或账号非该组织有效成员时，统一按凭据错误返回，
    // 避免泄露"该邮箱属于哪些组织"的成员关系信息
    if (!organization || !membership) {
      await recordLoginFailure(request, email, user.id);
      return invalidCredentials();
    }

    if (user.mfa_enabled === true) {
      if (!mfaCode) {
        return NextResponse.json({
          success: false,
          mfaRequired: true,
          error: '请输入身份验证器验证码或恢复码',
        });
      }

      const encryptedSecret = typeof user.mfa_secret_encrypted === 'string'
        ? user.mfa_secret_encrypted
        : '';
      const secret = decryptField(encryptedSecret);
      let mfaValid = false;
      if (secret && secret !== '[解密失败]') {
        const matchedStep = verifyTotp(secret, mfaCode);
        if (matchedStep !== null) {
          const { data: updated, error: updateError } = await supabase
            .from('users')
            .update({ mfa_last_used_step: matchedStep })
            .eq('id', user.id)
            .eq('mfa_enabled', true)
            .lt('mfa_last_used_step', matchedStep)
            .select('id')
            .maybeSingle();
          if (updateError) {
            throw new Error(`更新 MFA 状态失败: ${updateError.message}`);
          }
          mfaValid = Boolean(updated);
        }
      }

      if (!mfaValid && Array.isArray(user.mfa_recovery_codes)) {
        const recoveryHash = hashRecoveryCode(mfaCode);
        const storedCodes = user.mfa_recovery_codes.filter(
          (code: unknown): code is string => typeof code === 'string',
        );
        if (storedCodes.includes(recoveryHash)) {
          const { data: updated, error: updateError } = await supabase
            .from('users')
            .update({
              mfa_recovery_codes: storedCodes.filter(code => code !== recoveryHash),
            })
            .eq('id', user.id)
            .contains('mfa_recovery_codes', [recoveryHash])
            .select('id')
            .maybeSingle();
          if (updateError) {
            throw new Error(`使用 MFA 恢复码失败: ${updateError.message}`);
          }
          mfaValid = Boolean(updated);
        }
      }

      if (!mfaValid) {
        await recordLoginFailure(request, email, user.id);
        return NextResponse.json(
          { success: false, mfaRequired: true, error: '验证码或恢复码错误' },
          { status: 401 },
        );
      }
    }

    await recordLoginSuccess(
      request,
      email,
      user.id,
      membership.organization_id,
    );
    const mustChangePassword = user.must_change_password === true;
    const { token } = await createAuthenticatedSession({
      id: user.id,
      email: user.email,
      name: user.name,
      appRole: membership.role,
      organizationId: membership.organization_id,
      mustChangePassword,
      authVersion: user.auth_version,
    });

    const response = NextResponse.json({
      success: true,
      data: {
        user: {
          id: user.id,
          organization_id: membership.organization_id,
          email: user.email,
          name: user.name,
          company: organization.name,
          avatar_url: user.avatar_url,
          role: membership.role,
          is_active: user.is_active,
          mfa_enabled: user.mfa_enabled === true,
        },
        token,
        passwordChangeRequired: mustChangePassword,
      },
    });
    setAuthCookies(response, request, token);
    return response;
  } catch {
    return NextResponse.json(
      { success: false, error: '登录失败，请稍后重试' },
      { status: 500 },
    );
  }
}
