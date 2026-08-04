import { NextRequest, NextResponse } from 'next/server';
import { getTenantRequestContext } from '@/lib/auth-server';

interface RevokeTransactionResult {
  match_records: number;
  authorization_records: number;
  revoked_at: string;
}

function parseRevokeResult(value: unknown): RevokeTransactionResult {
  if (
    typeof value !== 'object'
    || value === null
    || typeof Reflect.get(value, 'match_records') !== 'number'
    || typeof Reflect.get(value, 'authorization_records') !== 'number'
    || typeof Reflect.get(value, 'revoked_at') !== 'string'
  ) {
    throw new Error('撤回事务未返回有效结果');
  }

  return {
    match_records: Reflect.get(value, 'match_records') as number,
    authorization_records: Reflect.get(value, 'authorization_records') as number,
    revoked_at: Reflect.get(value, 'revoked_at') as string,
  };
}

/**
 * 候选人授权撤回API
 * DELETE /api/candidates/[id]/revoke
 * 候选人可随时撤回简历授权。数据库事务会删除可识别主体，
 * 取消未完成处理，并仅保留与随机分析主体关联的不可变统计事实。
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: candidateId } = await params;
    const { supabase } = await getTenantRequestContext(request);
    const { data, error } = await supabase.rpc(
      'revoke_candidate_authorization',
      {
        p_candidate_id: candidateId,
        p_anonymized_candidate: {},
      },
    );

    if (error?.code === 'P0002') {
      return NextResponse.json(
        { error: '候选人不存在' },
        { status: 404 }
      );
    }
    if (error?.code === 'P0001') {
      return NextResponse.json(
        { error: '该候选人已撤回授权' },
        { status: 400 }
      );
    }
    if (error) {
      throw new Error(`撤回授权失败: ${error.message}`);
    }

    const transactionResult = parseRevokeResult(data);
    const deletionResults = {
      match_records: transactionResult.match_records,
      authorization_records: transactionResult.authorization_records,
    };

    // 生成删除确认回执
    const receipt = {
      receipt_id: `RCP-${Date.now()}-${candidateId.slice(0, 8)}`,
      candidate_id: candidateId,
      revoked_at: transactionResult.revoked_at,
      data_deleted: deletionResults,
      message: '授权已撤回；可识别候选人主体、关联匹配和待处理载荷已清理，仅保留无法回连直接身份的随机统计主体事实。',
      legal_notice: '如需核实处理结果或继续行使删除、解释、异议等权利，请联系本组织的数据负责人。',
    };

    return NextResponse.json({
      success: true,
      data: receipt,
    });

  } catch (error) {
    console.error('授权撤回API错误:', error);
    return NextResponse.json(
      { error: '服务器内部错误' },
      { status: 500 }
    );
  }
}
