import { NextRequest, NextResponse } from 'next/server';
import { apiErrorResponse } from '@/lib/api-response';
import { getTenantRequestContext } from '@/lib/auth-server';
import { enforceRateLimit, RATE_LIMITS } from '@/lib/rate-limit';

interface InterviewEventRow {
  metadata: Record<string, unknown> | null;
}

/** 计算指定时区「今天 00:00」对应的 UTC 时刻（与前端 zonedMidnight 逻辑一致） */
function startOfTodayInTimeZone(timeZone: string): Date {
  const todayParts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const year = Number(todayParts.find(part => part.type === 'year')?.value);
  const month = Number(todayParts.find(part => part.type === 'month')?.value);
  const day = Number(todayParts.find(part => part.type === 'day')?.value);
  const target = Date.UTC(year, month - 1, day);
  let instant = target;
  for (let iteration = 0; iteration < 2; iteration += 1) {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(new Date(instant));
    const part = (type: Intl.DateTimeFormatPartTypes) => Number(
      parts.find(item => item.type === type)?.value,
    );
    const representedAsUtc = Date.UTC(
      part('year'),
      part('month') - 1,
      part('day'),
      part('hour'),
      part('minute'),
      part('second'),
    );
    instant = target - (representedAsUtc - instant);
  }
  return new Date(instant);
}

/**
 * 今日待办聚合 - 看板顶部三卡数据源
 * pending_decisions: 未审短名单条目数 → /shortlists
 * outreach_due: 到期/逾期待办数（未关闭且截止时间已到今日结束前）→ /outcomes
 * interviews_today: 今日面试安排数（metadata.scheduled_at 落在今日）→ /outcomes
 */
export async function GET(request: NextRequest) {
  try {
    const { supabase, user } = await getTenantRequestContext(request);
    await enforceRateLimit(supabase, RATE_LIMITS.todayTodosRead);

    const { data: organization, error: organizationError } = await supabase
      .from('organizations')
      .select('timezone')
      .eq('id', user.organizationId)
      .single();
    if (organizationError || !organization) {
      throw new Error('无法读取组织时区配置');
    }
    const timeZone = organization.timezone || 'Asia/Shanghai';
    const todayStart = startOfTodayInTimeZone(timeZone);
    const todayStartIso = todayStart.toISOString();
    const tomorrowStartIso = new Date(todayStart.getTime() + 86_400_000).toISOString();

    const [
      { count: pendingDecisions, error: pendingError },
      { count: outreachDue, error: outreachError },
      { data: interviewEvents, error: interviewError },
    ] = await Promise.all([
      supabase
        .from('shortlist_entries')
        .select('id', { count: 'exact', head: true })
        .eq('organization_id', user.organizationId)
        .eq('human_decision', 'unreviewed'),
      supabase
        .from('outreach_tasks')
        .select('id', { count: 'exact', head: true })
        .eq('organization_id', user.organizationId)
        .neq('status', 'closed')
        .lt('due_at', tomorrowStartIso),
      supabase
        .from('recruiting_outcome_events')
        .select('metadata')
        .eq('organization_id', user.organizationId)
        .eq('event_type', 'interview_scheduled')
        .limit(1000),
    ]);
    if (pendingError) {
      throw new Error(`统计待审短名单失败: ${pendingError.message}`);
    }
    if (outreachError) {
      throw new Error(`统计触达待办失败: ${outreachError.message}`);
    }
    if (interviewError) {
      throw new Error(`统计今日面试失败: ${interviewError.message}`);
    }

    const interviewsToday = ((interviewEvents ?? []) as unknown as InterviewEventRow[])
      .filter((event) => {
        const scheduledAt = event.metadata?.scheduled_at;
        if (typeof scheduledAt !== 'string' || !scheduledAt) return false;
        return scheduledAt >= todayStartIso && scheduledAt < tomorrowStartIso;
      }).length;

    return NextResponse.json({
      success: true,
      data: {
        pending_decisions: { count: pendingDecisions ?? 0, path: '/shortlists' },
        outreach_due: { count: outreachDue ?? 0, path: '/outcomes' },
        interviews_today: { count: interviewsToday, path: '/outcomes' },
        timezone: timeZone,
      },
    });
  } catch (error) {
    return apiErrorResponse(error, '获取今日待办失败');
  }
}
