import { createHash } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { getRequestUser } from '@/lib/auth-server';
import { getSupabaseServiceClient } from '@/storage/database/supabase-client';

interface AcceptBody {
  inviteToken?: unknown;
}

export async function POST(request: NextRequest) {
  try {
    const user = await getRequestUser(request);
    const body = await request.json() as AcceptBody;
    const inviteToken = typeof body.inviteToken === 'string' ? body.inviteToken.trim() : '';
    if (!inviteToken) {
      return NextResponse.json(
        { success: false, error: '请输入邀请码' },
        { status: 400 },
      );
    }

    const tokenHash = createHash('sha256').update(inviteToken).digest('hex');
    const supabase = getSupabaseServiceClient();
    const { data, error } = await supabase.rpc('join_organization_by_invitation', {
      p_token_hash: tokenHash,
      p_user_id: user.userId,
    });

    if (error) {
      const message = error.message;
      const friendlyError = /invalid|expired|used/i.test(message)
        ? '邀请码无效、已使用或已过期'
        : /email does not match/i.test(message)
          ? '该邀请码绑定的邮箱与当前登录账号不一致'
          : /already a member/i.test(message)
            ? '您已是该组织成员，无需重复加入'
            : /inactive/i.test(message)
              ? '目标组织已停用，无法加入'
              : '加入组织失败，请稍后重试';
      return NextResponse.json(
        { success: false, error: friendlyError },
        { status: 400 },
      );
    }

    return NextResponse.json({ success: true, data });
  } catch (error) {
    const message = error instanceof Error ? error.message : '未知错误';
    const status = message === '未登录' || message === '登录信息无效' ? 401 : 500;
    return NextResponse.json(
      { success: false, error: status === 401 ? '登录已过期，请重新登录' : '加入组织失败，请稍后重试' },
      { status },
    );
  }
}
