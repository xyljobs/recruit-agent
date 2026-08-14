import { NextRequest, NextResponse } from 'next/server';
import { decryptField } from '@/lib/encryption';
import { getTenantRequestContext } from '@/lib/auth-server';
import {
  parseLimitedJson,
  SMALL_JSON_BODY_LIMIT,
} from '@/lib/api-limits';
import { apiErrorResponse } from '@/lib/api-response';
import { enforceRateLimit } from '@/lib/rate-limit';
import {
  normalizeRecruitingApiError,
  parseStrictSearchParams,
  rpcErrorToRequestError,
  shortlistCreateBodySchema,
  shortlistListQuerySchema,
} from '@/lib/recruiting/api-contracts';

const RUN_FIELDS = 'id,job_id,requested_by,source_match_batch_task_id,status,candidate_count,top_n,scoring_schema_version,scoring_weights_version,confidence_formula_version,requested_at,completed_at,review_started_at,qualified_at,qualified_by,error_message' as const;

const ENTRY_FIELDS = 'id,shortlist_run_id,match_record_id,candidate_id,rank,recommendation_band,confidence_score,confidence_breakdown,evidence_snapshot,missing_information,human_decision,override_reason_code,override_note,reviewed_by,reviewed_at,created_at,candidate:candidates(id,name,current_company,current_position,data_source,is_authorized,updated_at,experience_years,verified_experience_years,experience_years_status,education,skills),match_record:match_records(overall_score,skill_score,experience_score,education_score,salary_score,location_score,availability_score,stability_score,match_details)' as const;

export async function POST(request: NextRequest) {
  try {
    const { supabase } = await getTenantRequestContext(request);
    await enforceRateLimit(supabase, { scope: 'shortlists:create' });
    const body = await parseLimitedJson(
      request,
      shortlistCreateBodySchema,
      SMALL_JSON_BODY_LIMIT,
    );
    const { data, error } = await supabase.rpc('create_shortlist_batch', {
      p_job_id: body.job_id,
      p_candidate_ids: body.candidate_ids ?? null,
      p_top_n: body.top_n,
      p_client_event_id: body.client_event_id,
    });
    if (error) throw rpcErrorToRequestError(error, '创建短名单失败');

    return NextResponse.json({ success: true, data }, { status: 202 });
  } catch (error) {
    return apiErrorResponse(
      normalizeRecruitingApiError(error, '创建短名单失败'),
      '创建短名单失败',
    );
  }
}

export async function GET(request: NextRequest) {
  try {
    const query = parseStrictSearchParams(
      request.nextUrl.searchParams,
      shortlistListQuerySchema,
    );
    const { supabase, user } = await getTenantRequestContext(request);
    await enforceRateLimit(supabase, { scope: 'shortlists:read' });
    let runsQuery = supabase
      .from('shortlist_runs')
      .select(RUN_FIELDS)
      .eq('organization_id', user.organizationId)
      .order('created_at', { ascending: false })
      .limit(query.limit);
    if (query.runId) runsQuery = runsQuery.eq('id', query.runId);
    if (query.jobId) runsQuery = runsQuery.eq('job_id', query.jobId);
    if (query.status) runsQuery = runsQuery.eq('status', query.status);

    const { data: runs, error: runsError } = await runsQuery;
    if (runsError) throw new Error('shortlist read failed');
    if (query.runId && (runs?.length ?? 0) === 0) {
      return NextResponse.json(
        { success: false, error: '短名单不存在' },
        { status: 404 },
      );
    }

    const runIds = (runs ?? []).map(run => run.id);
    if (runIds.length === 0) {
      return NextResponse.json({ success: true, data: [] });
    }
    const { data: entries, error: entriesError } = await supabase
      .from('shortlist_entries')
      .select(ENTRY_FIELDS)
      .eq('organization_id', user.organizationId)
      .in('shortlist_run_id', runIds)
      .order('rank', { ascending: true });
    if (entriesError) throw new Error('shortlist entries read failed');

    const candidateIds = [...new Set((entries ?? []).map(entry => entry.candidate_id))];
    const authorizationByCandidate = new Map<string, Record<string, unknown>>();
    if (candidateIds.length > 0) {
      const { data: authorizations, error: authorizationError } = await supabase
        .from('authorization_records')
        .select('candidate_id,source_type,authorized_at,processing_expires_at,is_active,evidence_status,automated_decision_objected_at')
        .eq('organization_id', user.organizationId)
        .in('candidate_id', candidateIds)
        .order('authorized_at', { ascending: false });
      if (authorizationError) throw new Error('shortlist authorization read failed');
      for (const authorization of (authorizations ?? []) as Record<string, unknown>[]) {
        const candidateId = String(authorization.candidate_id);
        if (!authorizationByCandidate.has(candidateId)) authorizationByCandidate.set(candidateId, authorization);
      }
    }

    const entriesByRun = new Map<string, Array<Record<string, unknown>>>();
    for (const rawEntry of entries ?? []) {
      const entry = rawEntry as Record<string, unknown>;
      const candidate = entry.candidate as Record<string, unknown> | null;
      if (candidate) {
        candidate.name = decryptField(candidate.name as string) ?? candidate.name;
        candidate.current_company = decryptField(candidate.current_company as string)
          ?? candidate.current_company;
        candidate.current_position = decryptField(candidate.current_position as string)
          ?? candidate.current_position;
        candidate.authorization = authorizationByCandidate.get(String(entry.candidate_id)) ?? null;
      }
      const matchRecord = entry.match_record as Record<string, unknown> | null;
      if (matchRecord) {
        entry.overall_score = matchRecord.overall_score;
        entry.score_breakdown = {
          技能: matchRecord.skill_score,
          经验: matchRecord.experience_score,
          学历: matchRecord.education_score,
          薪资: matchRecord.salary_score,
          地点: matchRecord.location_score,
          到岗: matchRecord.availability_score,
          稳定性: matchRecord.stability_score,
        };
        entry.match_details = matchRecord.match_details ?? null;
      }
      delete entry.match_record;
      const runId = entry.shortlist_run_id as string;
      const runEntries = entriesByRun.get(runId) ?? [];
      runEntries.push(entry);
      entriesByRun.set(runId, runEntries);
    }

    const data = (runs ?? []).map(run => ({
      ...run,
      entries: entriesByRun.get(run.id) ?? [],
    }));
    return NextResponse.json({ success: true, data });
  } catch (error) {
    return apiErrorResponse(
      normalizeRecruitingApiError(error, '获取短名单失败'),
      '获取短名单失败',
    );
  }
}
