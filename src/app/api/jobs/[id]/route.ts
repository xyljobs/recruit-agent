import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getTenantRequestContext } from '@/lib/auth-server';
import { JD_JSON_BODY_LIMIT, MAX_JD_LENGTH, parseLimitedJson } from '@/lib/api-limits';
import { apiErrorResponse } from '@/lib/api-response';
import { screeningRubricSchema } from '@/lib/matching/screening-rubric';

const jobUpdateBodySchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  department: z.string().trim().max(100).optional(),
  location: z.string().trim().max(100).optional(),
  salary_range: z.string().trim().max(100).optional(),
  experience_required: z.string().trim().max(1000).optional(),
  education_required: z.string().trim().max(100).optional(),
  skills_required: z.array(z.string().trim().min(1).max(100)).max(50).optional(),
  bonus_skills: z.array(z.string().trim().min(1).max(100)).max(50).optional(),
  responsibilities: z.array(z.string().trim().min(1).max(500)).max(50).optional(),
  benefits: z.array(z.string().trim().min(1).max(100)).max(50).optional(),
  raw_jd: z.string().trim().min(1).max(MAX_JD_LENGTH).optional(),
  screening_rubric: screeningRubricSchema.optional(),
}).strict().refine(value => Object.keys(value).length > 0, {
  message: '请提供要更新的字段',
});

// GET /api/jobs/[id] - 查询单个职位
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const { supabase, user } = await getTenantRequestContext(request);
    const { data, error } = await supabase
      .from('job_requirements')
      .select('*')
      .eq('id', id)
      .eq('organization_id', user.organizationId)
      .maybeSingle();
    if (error) throw new Error(`查询职位失败: ${error.message}`);
    if (!data) {
      return NextResponse.json({ success: false, error: '职位不存在' }, { status: 404 });
    }
    return NextResponse.json({ success: true, data });
  } catch (error) {
    console.error('查询职位失败:', error);
    return apiErrorResponse(error, '查询职位失败');
  }
}

// PATCH /api/jobs/[id] - 编辑职位（部分更新）
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const body = await parseLimitedJson(request, jobUpdateBodySchema, JD_JSON_BODY_LIMIT);
    const { supabase, user } = await getTenantRequestContext(request);
    const { data, error } = await supabase
      .from('job_requirements')
      .update({ ...body, updated_at: new Date().toISOString() })
      .eq('id', id)
      .eq('organization_id', user.organizationId)
      .select('*')
      .single();
    if (error) {
      if (error.code === 'PGRST116') {
        return NextResponse.json({ success: false, error: '职位不存在' }, { status: 404 });
      }
      throw new Error(`更新职位失败: ${error.message}`);
    }
    return NextResponse.json({ success: true, data });
  } catch (error) {
    console.error('更新职位失败:', error);
    return apiErrorResponse(error, '更新职位失败');
  }
}

// DELETE /api/jobs/[id] - 删除职位（仅管理员；级联删除关联匹配记录与短名单）
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const { supabase, user } = await getTenantRequestContext(request);
    if (user.role !== 'admin') {
      return NextResponse.json(
        { success: false, error: '权限不足，仅管理员可删除职位' },
        { status: 403 },
      );
    }
    const { data, error } = await supabase
      .from('job_requirements')
      .delete()
      .eq('id', id)
      .eq('organization_id', user.organizationId)
      .select('id');
    if (error) throw new Error(`删除职位失败: ${error.message}`);
    if (!data || data.length === 0) {
      return NextResponse.json({ success: false, error: '职位不存在' }, { status: 404 });
    }
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('删除职位失败:', error);
    return apiErrorResponse(error, '删除职位失败');
  }
}
