import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseServiceClient } from '@/storage/database/supabase-client';

// 登录页组织下拉的公开接口：仅返回启用中组织的 slug 与名称。
// 私有部署场景下公开租户名称清单可接受；公网多租户部署如需隐藏租户名，
// 应改为"邮箱优先、认证后再列组织"的两步登录。
const WINDOW_MS = 60_000;
const MAX_REQUESTS_PER_WINDOW = 30;
const requestHits = new Map<string, number[]>();

function getClientIp(request: NextRequest): string {
  const forwarded = request.headers.get('x-forwarded-for');
  return forwarded ? forwarded.split(',')[0].trim() : 'unknown';
}

function isIpRateLimited(ip: string): boolean {
  const now = Date.now();
  const hits = (requestHits.get(ip) ?? []).filter((timestamp) => now - timestamp < WINDOW_MS);
  if (hits.length >= MAX_REQUESTS_PER_WINDOW) {
    requestHits.set(ip, hits);
    return true;
  }
  hits.push(now);
  requestHits.set(ip, hits);
  // 顺手清理过期条目，避免长运行时内存无限增长
  if (requestHits.size > 500) {
    for (const [key, value] of requestHits) {
      if (value.length === 0 || now - value[value.length - 1] >= WINDOW_MS) {
        requestHits.delete(key);
      }
    }
  }
  return false;
}

export async function GET(request: NextRequest) {
  if (isIpRateLimited(getClientIp(request))) {
    return NextResponse.json(
      { success: false, error: '请求过于频繁，请稍后重试' },
      { status: 429 },
    );
  }
  try {
    const supabase = getSupabaseServiceClient();
    const { data, error } = await supabase
      .from('organizations')
      .select('slug, name')
      .eq('is_active', true)
      // 排除 migrate.sql 迁移产生的系统隔离区（legacy-quarantine / legacy-company-* / legacy-user-*），
      // 它们仅用于兜底历史数据归属，不是可登录租户
      .not('slug', 'like', 'legacy-%')
      .order('name', { ascending: true });
    if (error) {
      throw new Error(`查询组织列表失败: ${error.message}`);
    }
    return NextResponse.json({ success: true, data: data ?? [] });
  } catch (error) {
    const message = error instanceof Error ? error.message : '未知错误';
    return NextResponse.json(
      { success: false, error: `获取组织列表失败: ${message}` },
      { status: 500 },
    );
  }
}
