import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getTenantRequestContext } from '@/lib/auth-server';
import { SCORE_WEIGHTS } from '@/lib/matching/scorer';

const decisionRightsRequestSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('request_explanation'),
    job_id: z.string().trim().min(1),
    request_reference: z.string().trim().min(1).max(500),
  }),
  z.object({
    action: z.literal('object_to_automated_decision'),
    request_reference: z.string().trim().min(1).max(500),
  }),
]);

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id: candidateId } = await params;
    const parsedRequest = decisionRightsRequestSchema.safeParse(
      await request.json(),
    );
    if (!parsedRequest.success) {
      return NextResponse.json(
        {
          success: false,
          error: parsedRequest.error.issues[0]?.message
            ?? '自动化决策权利请求无效',
        },
        { status: 400 },
      );
    }

    const { supabase, user } = await getTenantRequestContext(request);
    const { data: candidate, error: candidateError } = await supabase
      .from('candidates')
      .select('id')
      .eq('id', candidateId)
      .eq('organization_id', user.organizationId)
      .maybeSingle();
    if (candidateError) {
      throw new Error(`查询候选人失败: ${candidateError.message}`);
    }
    if (!candidate) {
      return NextResponse.json(
        { success: false, error: '候选人不存在' },
        { status: 404 },
      );
    }

    if (parsedRequest.data.action === 'object_to_automated_decision') {
      const { data, error } = await supabase.rpc(
        'record_automated_decision_objection',
        {
          p_candidate_id: candidateId,
          p_request_reference: parsedRequest.data.request_reference,
        },
      );
      if (error?.code === 'P0002') {
        return NextResponse.json(
          { success: false, error: '没有可更新的已核验授权记录' },
          { status: 404 },
        );
      }
      if (error) {
        throw new Error(`记录自动化决策拒绝失败: ${error.message}`);
      }
      return NextResponse.json({
        success: true,
        data,
        message: '已记录候选人的拒绝选择，后续自动化匹配已被阻止',
      });
    }

    const { data: matchRecord, error: matchError } = await supabase
      .from('match_records')
      .select(
        'id, overall_score, skill_score, experience_score, education_score, salary_score, location_score, availability_score, stability_score, match_details, scoring_model, llm_model, created_at, updated_at',
      )
      .eq('candidate_id', candidateId)
      .eq('job_id', parsedRequest.data.job_id)
      .eq('organization_id', user.organizationId)
      .maybeSingle();
    if (matchError) {
      throw new Error(`查询匹配说明失败: ${matchError.message}`);
    }
    if (!matchRecord) {
      return NextResponse.json(
        { success: false, error: '没有可说明的自动化匹配记录' },
        { status: 404 },
      );
    }

    const { error: auditError } = await supabase
      .from('audit_logs')
      .insert({
        organization_id: user.organizationId,
        user_id: user.userId,
        action: 'provide_automated_decision_explanation',
        target_type: 'candidate',
        target_id: candidateId,
        details: {
          match_record_id: matchRecord.id,
          request_reference: parsedRequest.data.request_reference,
          personal_identifiers_logged: false,
        },
      });
    if (auditError) {
      throw new Error(`自动化决策说明审计失败: ${auditError.message}`);
    }

    return NextResponse.json({
      success: true,
      data: {
        request_reference: parsedRequest.data.request_reference,
        match_record_id: matchRecord.id,
        decision_role:
          '匹配评分和AI说明仅作为招聘人员的辅助信息，不能直接作出录用或拒绝决定',
        human_review_required: true,
        main_factors: SCORE_WEIGHTS,
        scores: {
          overall: matchRecord.overall_score,
          skill: matchRecord.skill_score,
          experience: matchRecord.experience_score,
          education: matchRecord.education_score,
          salary: matchRecord.salary_score,
          location: matchRecord.location_score,
          availability: matchRecord.availability_score,
          stability: matchRecord.stability_score,
        },
        explanation: matchRecord.match_details,
        models: {
          scoring: matchRecord.scoring_model,
          supplement: matchRecord.llm_model,
        },
        generated_at: matchRecord.updated_at ?? matchRecord.created_at,
        rights: [
          '要求招聘人员进行人工复核',
          '提供补充材料并要求更正',
          '拒绝仅通过自动化决策作出重大影响决定',
          '撤回同意或申请删除个人信息',
        ],
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : '服务器内部错误';
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 },
    );
  }
}
