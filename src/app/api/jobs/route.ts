import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getTenantRequestContext } from '@/lib/auth-server';
import { SMALL_JSON_BODY_LIMIT, parseLimitedJson } from '@/lib/api-limits';
import { apiErrorResponse } from '@/lib/api-response';

const bodySchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('create'),
    title: z.string().trim().min(1).max(200),
    department: z.string().trim().max(100).optional(),
    location: z.string().trim().max(100).optional(),
    salary_range: z.string().trim().max(100).optional(),
    experience_required: z.string().trim().max(1000).optional(),
    education_required: z.string().trim().max(100).optional(),
    skills_required: z.array(z.string().trim().min(1).max(100)).max(50).default([]),
    responsibilities: z.array(z.string().trim().min(1).max(500)).max(50).default([]),
  }).strict(),
  z.object({ action: z.enum(['activate', 'close']), job_id: z.string().uuid() }).strict(),
]);

// GET - 获取职位列表
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status') || '';
    if (status && !['draft', 'active', 'closed'].includes(status)) {
      return NextResponse.json({ success: false, error: '职位状态无效' }, { status: 400 });
    }

    const { supabase, user } = await getTenantRequestContext(request);
    
    let query = supabase
      .from('job_requirements')
      .select('*')
      .eq('organization_id', user.organizationId)
      .order('created_at', { ascending: false });

    if (status) {
      query = query.eq('status', status);
    }

    const { data, error } = await query;

    if (error) {
      throw new Error(`查询失败: ${error.message}`);
    }

    return NextResponse.json({
      success: true,
      data: data || []
    });

  } catch (error) {
    console.error('获取职位列表失败:', error);
    return NextResponse.json(
      { error: '获取职位列表失败' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await parseLimitedJson(request, bodySchema, SMALL_JSON_BODY_LIMIT);
    const { supabase, user } = await getTenantRequestContext(request);
    if (body.action !== 'create') {
      const { data, error } = await supabase.rpc('set_job_lifecycle', {
        p_job_id: body.job_id,
        p_action: body.action,
      });
      if (error) throw new Error(`更新职位状态失败: ${error.message}`);
      return NextResponse.json({ success: true, data });
    }
    const completedFields = [body.title, body.department, body.location, body.experience_required, body.education_required, body.skills_required.length > 0]
      .filter(value => Boolean(value)).length;
    const missingFields = [
      ['department', body.department],
      ['location', body.location],
      ['experience_required', body.experience_required],
      ['education_required', body.education_required],
      ['skills_required', body.skills_required.length > 0],
    ].filter(([, value]) => !value).map(([field]) => field);
    const { data, error } = await supabase
      .from('job_requirements')
      .insert({
        organization_id: user.organizationId,
        owner_user_id: user.userId,
        title: body.title,
        department: body.department ?? null,
        location: body.location ?? null,
        salary_range: body.salary_range ?? null,
        experience_required: body.experience_required ?? null,
        education_required: body.education_required ?? null,
        skills_required: body.skills_required,
        responsibilities: body.responsibilities,
        completeness: Math.round((completedFields / 6) * 100),
        missing_fields: missingFields,
        status: 'draft',
      })
      .select('*')
      .single();
    if (error) throw new Error(`创建职位标准失败: ${error.message}`);
    return NextResponse.json({ success: true, data }, { status: 201 });
  } catch (error) {
    return apiErrorResponse(error, '保存职位标准失败');
  }
}
