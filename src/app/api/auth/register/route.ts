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
      const invalidInvite = /invitation|邀请|expired|used/i.test(error.message);
      return NextResponse.json(
        { error: invalidInvite ? '邀请码无效、已使用或已过期' : '注册失败，请稍后重试' },
        { status: invalidInvite ? 400 : 500 },
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
