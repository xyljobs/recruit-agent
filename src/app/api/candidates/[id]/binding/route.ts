import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getTenantRequestContext } from '@/lib/auth-server';
import { decryptField } from '@/lib/encryption';
import { apiErrorResponse } from '@/lib/api-response';

const rebindBodySchema = z
  .object({
    source_job_id: z.string().trim().max(36).nullable(),
  })
  .strict();

// 解密候选人记录中的加密字段（与列表接口一致）
function decryptCandidate(c: Record<string, unknown>): Record<string, unknown> {
  if (!c) return c;
  return {
    ...c,
    name: decryptField(c.name as string | null),
    email: decryptField(c.email as string | null),
    phone: decryptField(c.phone as string | null),
    resume_text: decryptField(c.resume_text as string | null),
    current_company: decryptField(c.current_company as string | null),
    current_position: decryptField(c.current_position as string | null),
  };
}

/**
 * 候选人关联职位重绑定API
 * PATCH /api/candidates/[id]/binding
 * 职位-候选人绑定有时效性：职位关闭或该职位招聘定论（录用/拒绝/撤回）后
 * 绑定自动置为 expired；HR 可在此将候选人重新绑定到新职位，绑定重新生效。
 * source_job_id 传 null 表示解除绑定（退回纯资源库状态）。
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id: candidateId } = await params;
    const body = await request.json().catch(() => null);
    const parsed = rebindBodySchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        {
          success: false,
          error: parsed.error.issues[0]?.message || '请求参数无效',
        },
        { status: 400 },
      );
    }

    const { supabase } = await getTenantRequestContext(request);
    const { data, error } = await supabase.rpc(
      'update_candidate_source_job',
      {
        p_candidate_id: candidateId,
        p_source_job_id: parsed.data.source_job_id,
      },
    );

    if (error?.code === 'P0002') {
      return NextResponse.json(
        { success: false, error: '候选人不存在或职位不属于当前组织' },
        { status: 404 },
      );
    }
    if (error) {
      throw new Error(`更新绑定职位失败: ${error.message}`);
    }
    if (!data) {
      throw new Error('未返回候选人');
    }

    return NextResponse.json({
      success: true,
      data: decryptCandidate(data),
    });
  } catch (error) {
    return apiErrorResponse(error, '更新绑定职位失败');
  }
}
