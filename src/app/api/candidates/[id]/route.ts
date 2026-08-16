import { NextRequest, NextResponse } from 'next/server';
import { getTenantRequestContext } from '@/lib/auth-server';
import { getSupabaseServiceClient } from '@/storage/database/supabase-client';
import { apiErrorResponse } from '@/lib/api-response';

interface CandidateRow {
  id: string;
  resume_file_path: string | null;
}

// DELETE /api/candidates/[id] - 条件删除候选人（仅管理员）
// 仅允许删除尚未产生决策留痕的候选人（如误录入数据；pending 匹配记录随候选人级联清理）；
// 已产生决策留痕（匹配已推进 / 短名单 / 复盘）的候选人拒绝硬删，引导走「撤回授权」，
// 避免破坏匹配历史、短名单决策与结果复盘的审计链。
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: candidateId } = await params;
    const { supabase, user } = await getTenantRequestContext(request);

    if (user.role !== 'admin') {
      return NextResponse.json(
        { success: false, error: '权限不足，仅管理员可删除候选人' },
        { status: 403 },
      );
    }

    const { data: candidateRow, error: candidateError } = await supabase
      .from('candidates')
      .select('id, resume_file_path')
      .eq('id', candidateId)
      .eq('organization_id', user.organizationId)
      .maybeSingle();
    if (candidateError) {
      throw new Error(`查询候选人失败: ${candidateError.message}`);
    }
    const candidate = candidateRow as CandidateRow | null;
    if (!candidate) {
      return NextResponse.json(
        { success: false, error: '候选人不存在' },
        { status: 404 },
      );
    }

    const [matchResult, shortlistResult, outcomeResult] = await Promise.all([
      supabase
        .from('match_records')
        .select('id', { count: 'exact', head: true })
        .eq('candidate_id', candidateId)
        .neq('status', 'pending'),
      supabase
        .from('shortlist_entries')
        .select('id', { count: 'exact', head: true })
        .eq('candidate_id', candidateId),
      supabase
        .from('recruiting_outcome_events')
        .select('id', { count: 'exact', head: true })
        .eq('candidate_id', candidateId),
    ]);
    for (const countResult of [matchResult, shortlistResult, outcomeResult]) {
      if (countResult.error) {
        throw new Error(`校验候选人关联数据失败: ${countResult.error.message}`);
      }
    }
    const matchCount = matchResult.count ?? 0;
    const shortlistCount = shortlistResult.count ?? 0;
    const outcomeCount = outcomeResult.count ?? 0;
    if (matchCount > 0 || shortlistCount > 0 || outcomeCount > 0) {
      return NextResponse.json(
        {
          success: false,
          error:
            `该候选人已产生决策留痕（已推进匹配 ${matchCount} 条、短名单 ${shortlistCount} 条、复盘事件 ${outcomeCount} 条），` +
            '为保留审计链不可直接删除，请改用「撤回授权」（个人信息脱敏，统计事实保留）',
        },
        { status: 409 },
      );
    }

    // 删除前读取简历文件路径，删除后一并清理存储（尽力而为，行删除以数据库为准）
    if (candidate.resume_file_path) {
      try {
        const serviceSupabase = getSupabaseServiceClient();
        await serviceSupabase.storage
          .from('candidate-resumes')
          .remove([candidate.resume_file_path]);
      } catch {
        // 原始简历文件清理尽力而为，不阻塞候选人删除
      }
    }

    // 关联数据（authorization_records / outreach_tasks / interview_guides 等）由外键级联清理
    const { data: deleted, error: deleteError } = await supabase
      .from('candidates')
      .delete()
      .eq('id', candidateId)
      .eq('organization_id', user.organizationId)
      .select('id');
    if (deleteError) {
      throw new Error(`删除候选人失败: ${deleteError.message}`);
    }
    if (!deleted || deleted.length === 0) {
      return NextResponse.json(
        { success: false, error: '候选人不存在' },
        { status: 404 },
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('删除候选人失败:', error);
    return apiErrorResponse(error, '删除候选人失败');
  }
}
