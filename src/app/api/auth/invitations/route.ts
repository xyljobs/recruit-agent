import { createHash, randomBytes } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { getAdminRequestContext } from '@/lib/auth-server';

interface InvitationBody {
  email?: string;
  role?: string;
  expiresInDays?: number;
}

function invitationError(error: unknown): NextResponse {
  const message = error instanceof Error ? error.message : '未知错误';
  const status = message === '未登录' || message === '登录信息无效'
    ? 401
    : message === '权限不足'
      ? 403
      : 500;
  return NextResponse.json({ success: false, error: message }, { status });
}

export async function GET(request: NextRequest) {
  try {
    const { supabase, user } = await getAdminRequestContext(request);

    const { data, error } = await supabase
      .from('organization_invitations')
      .select('id, email, role, expires_at, accepted_at, created_at')
      .eq('organization_id', user.organizationId)
      .order('created_at', { ascending: false });

    if (error) {
      throw new Error(error.message);
    }
    return NextResponse.json({ success: true, data: data || [] });
  } catch (error) {
    return invitationError(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const { supabase, user } = await getAdminRequestContext(request);

    const body = await request.json() as InvitationBody;
    const email = body.email?.trim().toLowerCase() || '';
    const role = body.role === 'admin' ? 'admin' : 'hr';
    const expiresInDays = Math.min(Math.max(body.expiresInDays || 7, 1), 30);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return NextResponse.json(
        { success: false, error: '请输入有效邮箱' },
        { status: 400 },
      );
    }

    const token = randomBytes(32).toString('base64url');
    const tokenHash = createHash('sha256').update(token).digest('hex');
    const expiresAt = new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000).toISOString();
    const { data, error } = await supabase
      .from('organization_invitations')
      .insert({
        organization_id: user.organizationId,
        email,
        role,
        token_hash: tokenHash,
        invited_by: user.userId,
        expires_at: expiresAt,
      })
      .select('id, email, role, expires_at, created_at')
      .single();

    if (error) {
      throw new Error(error.message);
    }
    return NextResponse.json({
      success: true,
      data: {
        ...data,
        inviteToken: token,
      },
    });
  } catch (error) {
    return invitationError(error);
  }
}
