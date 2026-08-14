import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { createHash } from 'crypto';
import { getSupabaseServiceClient } from '@/storage/database/supabase-client';
import { getPasswordValidationError } from '@/lib/password-policy';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
    const password = typeof body.password === 'string' ? body.password : '';
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    const inviteToken = typeof body.inviteToken === 'string' ? body.inviteToken.trim() : '';

    if (!email || !password || !name || !inviteToken) {
      return NextResponse.json(
        { error: '请填写完整信息和邀请码' },
        { status: 400 }
      );
    }
    const passwordError = getPasswordValidationError(password);
    if (passwordError) {
      return NextResponse.json(
        { error: passwordError },
        { status: 400 },
      );
    }

    const supabase = getSupabaseServiceClient();

    // 预检邮箱是否已注册，避免受邀人重复注册后才在唯一约束处报错
    const { data: existingUser } = await supabase
      .from('users')
      .select('id')
      .eq('email', email)
      .maybeSingle();
    if (existingUser) {
      return NextResponse.json(
        { error: '该邮箱已注册，请直接登录' },
        { status: 400 },
      );
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const tokenHash = createHash('sha256').update(inviteToken).digest('hex');
    const { data: user, error } = await supabase.rpc(
      'accept_organization_invitation',
      {
        p_token_hash: tokenHash,
        p_email: email,
        p_password_hash: passwordHash,
        p_name: name,
      },
    );

    if (error) {
      // 预检存在竞态窗口，仍可能撞上 users.email 唯一约束，兜底提示
      const invalidInvite = /invitation|邀请|expired|used/i.test(error.message);
      const duplicateEmail = /duplicate|unique/i.test(error.message);
      return NextResponse.json(
        {
          error: invalidInvite
            ? '邀请码无效、已使用或已过期'
            : duplicateEmail
              ? '该邮箱已注册，请直接登录'
              : '注册失败，请稍后重试',
        },
        { status: invalidInvite || duplicateEmail ? 400 : 500 },
      );
    }

    return NextResponse.json({
      success: true,
      data: user,
      message: '注册成功，请登录'
    });
  } catch (error) {
    console.error('注册错误:', error);
    return NextResponse.json(
      { error: '注册失败，请稍后重试' },
      { status: 500 }
    );
  }
}
