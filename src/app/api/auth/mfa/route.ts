import bcrypt from 'bcryptjs';
import { NextRequest, NextResponse } from 'next/server';
import { setAuthCookies } from '@/lib/auth-cookie';
import {
  createAuthenticatedSession,
  getRequestUser,
  revokeAllAuthSessions,
} from '@/lib/auth-server';
import { decryptField, encryptField } from '@/lib/encryption';
import {
  createTotpUri,
  generateRecoveryCodes,
  generateTotpSecret,
  hashRecoveryCode,
  verifyTotp,
} from '@/lib/totp';
import { getSupabaseServiceClient } from '@/storage/database/supabase-client';

interface MfaBody {
  action?: unknown;
  currentPassword?: unknown;
  code?: unknown;
}

function invalidRequest(error: string, status = 400): NextResponse {
  return NextResponse.json({ success: false, error }, { status });
}

export async function GET(request: NextRequest) {
  try {
    const requestUser = await getRequestUser(request);
    const { data: user, error } = await getSupabaseServiceClient()
      .from('users')
      .select('mfa_enabled, mfa_recovery_codes')
      .eq('id', requestUser.userId)
      .eq('organization_id', requestUser.organizationId)
      .single();
    if (error || !user) {
      return invalidRequest('用户不存在或已停用', 401);
    }
    return NextResponse.json({
      success: true,
      data: {
        enabled: user.mfa_enabled === true,
        recoveryCodesRemaining: Array.isArray(user.mfa_recovery_codes)
          ? user.mfa_recovery_codes.length
          : 0,
      },
    });
  } catch {
    return invalidRequest('登录已过期', 401);
  }
}

export async function POST(request: NextRequest) {
  try {
    const requestUser = await getRequestUser(request);
    const body = await request.json() as MfaBody;
    const action = typeof body.action === 'string' ? body.action : '';
    const currentPassword = typeof body.currentPassword === 'string'
      ? body.currentPassword
      : '';
    const code = typeof body.code === 'string' ? body.code.trim() : '';
    if (!['begin', 'enable', 'disable'].includes(action)) {
      return invalidRequest('MFA 操作无效');
    }

    const supabase = getSupabaseServiceClient();
    const { data: user, error: userError } = await supabase
      .from('users')
      .select('id, email, name, password_hash, is_active, must_change_password, auth_version, mfa_enabled, mfa_secret_encrypted, mfa_pending_secret_encrypted, mfa_recovery_codes')
      .eq('id', requestUser.userId)
      .eq('organization_id', requestUser.organizationId)
      .single();
    if (userError || !user || user.is_active === false) {
      return invalidRequest('用户不存在或已停用', 401);
    }

    if (action === 'begin') {
      if (!currentPassword) {
        return invalidRequest('请输入当前密码');
      }
      if (!await bcrypt.compare(currentPassword, user.password_hash)) {
        return invalidRequest('当前密码错误', 401);
      }
      if (user.mfa_enabled === true) {
        return invalidRequest('MFA 已启用');
      }

      const secret = generateTotpSecret();
      const encryptedSecret = encryptField(secret);
      if (!encryptedSecret) {
        throw new Error('MFA 密钥加密失败');
      }
      const { error } = await supabase
        .from('users')
        .update({
          mfa_pending_secret_encrypted: encryptedSecret,
          updated_at: new Date().toISOString(),
        })
        .eq('id', user.id)
        .eq('organization_id', requestUser.organizationId);
      if (error) {
        throw new Error(`保存 MFA 设置失败: ${error.message}`);
      }
      return NextResponse.json({
        success: true,
        data: {
          secret,
          otpauthUri: createTotpUri(secret, user.email),
        },
      });
    }

    if (action === 'enable') {
      if (user.mfa_enabled === true) {
        return invalidRequest('MFA 已启用');
      }
      const pendingSecret = decryptField(user.mfa_pending_secret_encrypted);
      if (!pendingSecret || pendingSecret === '[解密失败]') {
        return invalidRequest('请先开始 MFA 设置');
      }
      const matchedStep = verifyTotp(pendingSecret, code);
      if (matchedStep === null) {
        return invalidRequest('验证码错误');
      }

      const recoveryCodes = generateRecoveryCodes();
      const { data: updatedUser, error } = await supabase
        .from('users')
        .update({
          mfa_enabled: true,
          mfa_secret_encrypted: user.mfa_pending_secret_encrypted,
          mfa_pending_secret_encrypted: null,
          mfa_recovery_codes: recoveryCodes.map(hashRecoveryCode),
          mfa_last_used_step: matchedStep,
          updated_at: new Date().toISOString(),
        })
        .eq('id', user.id)
        .eq('organization_id', requestUser.organizationId)
        .eq('mfa_enabled', false)
        .select('auth_version')
        .single();
      if (error || !updatedUser) {
        throw new Error(`启用 MFA 失败: ${error?.message ?? '状态已变化'}`);
      }

      await revokeAllAuthSessions(user.id);
      const { token } = await createAuthenticatedSession({
        id: user.id,
        email: user.email,
        name: user.name,
        appRole: requestUser.role,
        organizationId: requestUser.organizationId,
        mustChangePassword: user.must_change_password === true,
        authVersion: updatedUser.auth_version,
      });
      const response = NextResponse.json({
        success: true,
        data: { token, recoveryCodes },
        message: 'MFA 已启用',
      });
      setAuthCookies(response, request, token);
      return response;
    }

    if (user.mfa_enabled !== true) {
      return invalidRequest('MFA 尚未启用');
    }
    if (!currentPassword || !await bcrypt.compare(currentPassword, user.password_hash)) {
      return invalidRequest('当前密码错误', 401);
    }
    const secret = decryptField(user.mfa_secret_encrypted);
    const recoveryHash = hashRecoveryCode(code);
    const storedRecoveryCodes = Array.isArray(user.mfa_recovery_codes)
      ? user.mfa_recovery_codes.filter(
        (value: unknown): value is string => typeof value === 'string',
      )
      : [];
    const secondFactorValid = (
      Boolean(secret && secret !== '[解密失败]' && verifyTotp(secret, code) !== null)
      || storedRecoveryCodes.includes(recoveryHash)
    );
    if (!secondFactorValid) {
      return invalidRequest('验证码或恢复码错误', 401);
    }

    const { data: updatedUser, error } = await supabase
      .from('users')
      .update({
        mfa_enabled: false,
        mfa_secret_encrypted: null,
        mfa_pending_secret_encrypted: null,
        mfa_recovery_codes: [],
        mfa_last_used_step: -1,
        updated_at: new Date().toISOString(),
      })
      .eq('id', user.id)
      .eq('organization_id', requestUser.organizationId)
      .eq('mfa_enabled', true)
      .select('auth_version')
      .single();
    if (error || !updatedUser) {
      throw new Error(`停用 MFA 失败: ${error?.message ?? '状态已变化'}`);
    }

    await revokeAllAuthSessions(user.id);
    const { token } = await createAuthenticatedSession({
      id: user.id,
      email: user.email,
      name: user.name,
      appRole: requestUser.role,
      organizationId: requestUser.organizationId,
      mustChangePassword: user.must_change_password === true,
      authVersion: updatedUser.auth_version,
    });
    const response = NextResponse.json({
      success: true,
      data: { token },
      message: 'MFA 已停用',
    });
    setAuthCookies(response, request, token);
    return response;
  } catch {
    return invalidRequest('MFA 设置失败，请稍后重试', 500);
  }
}
