import { randomBytes } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getAdminRequestContext, getTenantRequestContext } from '@/lib/auth-server';
import { INTEGRATION_BODY_LIMIT } from '@/lib/integrations/webhook';
import { parseLimitedJson } from '@/lib/api-limits';
import { apiErrorResponse } from '@/lib/api-response';
import { encrypt } from '@/lib/encryption';
import { getSupabaseServiceClient } from '@/storage/database/supabase-client';
import { AiExecutionPolicy } from '@/lib/ai/execution-policy';

const capabilitySchema = z.enum(['inbound_jobs', 'inbound_candidates', 'inbound_outcomes', 'outbound_outcomes']);
const connectionFields = {
  name: z.string().trim().min(1).max(200),
  connector_type: z.enum(['csv_json', 'generic_ats', 'authorized_resume_source']),
  status: z.enum(['disabled', 'enabled', 'error']).default('disabled'),
  capabilities: z.array(capabilitySchema).max(4).default([]),
  data_boundary_mode: z.enum(['tenant_private', 'customer_network', 'approved_external']).default('tenant_private'),
  model_endpoint_classification: z.enum(['none', 'private', 'approved_cloud']).default('none'),
  external_processors: z.array(z.string().trim().min(1).max(200)).max(20).default([]),
  configuration: z.record(z.string(), z.unknown()).optional(),
  webhook_secret: z.string().min(32).max(512).optional(),
};
const createSchema = z.object({ action: z.literal('create'), ...connectionFields }).strict();
const updateSchema = z.object({
  action: z.literal('update'),
  connection_id: z.string().uuid(),
  name: connectionFields.name.optional(),
  connector_type: connectionFields.connector_type.optional(),
  status: connectionFields.status.optional(),
  capabilities: connectionFields.capabilities.optional(),
  data_boundary_mode: connectionFields.data_boundary_mode.optional(),
  model_endpoint_classification: connectionFields.model_endpoint_classification.optional(),
  external_processors: connectionFields.external_processors.optional(),
  configuration: connectionFields.configuration.optional(),
  webhook_secret: connectionFields.webhook_secret.optional(),
}).strict();
const aiPolicySchema = z.object({
  action: z.literal('set_ai_policy'),
  ai_execution_mode: z.enum(['rules_only', 'private_endpoint', 'approved_cloud']),
  approved_cloud_processors: z.array(z.string().trim().min(1).max(200)).max(20).default([]),
}).strict();
const bodySchema = z.discriminatedUnion('action', [createSchema, updateSchema, aiPolicySchema]);

export async function GET(request: NextRequest) {
  try {
    const { supabase, user } = await getTenantRequestContext(request);
    const [
      { data: connections, error },
      { data: syncRuns, error: syncError },
      { data: organization, error: organizationError },
    ] = await Promise.all([
      supabase
        .from('integration_connections')
        .select('id, name, connector_type, status, capabilities, data_boundary_mode, model_endpoint_classification, external_processors, last_sync_at, created_at, updated_at')
        .eq('organization_id', user.organizationId)
        .order('created_at', { ascending: false }),
      supabase
        .from('integration_sync_runs')
        .select('id, integration_id, direction, status, cursor_after, processed_count, succeeded_count, failed_count, error_summary, finished_at, created_at')
        .eq('organization_id', user.organizationId)
        .order('created_at', { ascending: false })
        .limit(100),
      supabase
        .from('organizations')
        .select('ai_execution_mode, approved_cloud_processors')
        .eq('id', user.organizationId)
        .maybeSingle(),
    ]);
    if (error || syncError || organizationError || !organization) {
      throw new Error(`读取数据源失败: ${error?.message ?? syncError?.message ?? organizationError?.message ?? '组织不存在'}`);
    }
    const latestSyncByConnection = new Map<string, Record<string, unknown>>();
    for (const run of (syncRuns ?? []) as Record<string, unknown>[]) {
      const integrationId = String(run.integration_id);
      if (!latestSyncByConnection.has(integrationId)) latestSyncByConnection.set(integrationId, run);
    }
    return NextResponse.json({
      success: true,
      data: {
        connections: ((connections ?? []) as Record<string, unknown>[]).map(connection => ({
          ...connection,
          latest_sync: latestSyncByConnection.get(String(connection.id)) ?? null,
        })),
        ai_policy: (() => {
          const policy = AiExecutionPolicy.fromEnvironment();
          const deploymentProcessors = parseApprovedProcessors();
          const tenantProcessors = Array.isArray(organization.approved_cloud_processors)
            ? organization.approved_cloud_processors
            : [];
          return {
            ai_mode: organization.ai_execution_mode,
            deployment_mode: policy.mode,
            effective_mode: policy.mode === organization.ai_execution_mode
              && (policy.mode !== 'approved_cloud'
                || (deploymentProcessors.length > 0
                  && deploymentProcessors.every(processor => tenantProcessors.includes(processor))))
              ? policy.mode
              : 'rules_only',
            model_endpoint_classification: policy.mode === 'private_endpoint'
              ? 'private'
              : policy.mode === 'approved_cloud' ? 'approved_cloud' : 'none',
            external_processors: tenantProcessors,
            deployment_processors: deploymentProcessors,
          };
        })(),
      },
    });
  } catch (error) {
    return apiErrorResponse(error, '获取数据源失败');
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await parseLimitedJson(request, bodySchema, INTEGRATION_BODY_LIMIT);
    const { user, supabase } = await getAdminRequestContext(request);
    if (body.action === 'set_ai_policy') {
      const deploymentMode = AiExecutionPolicy.fromEnvironment().mode;
      const deploymentProcessors = parseApprovedProcessors();
      const requestedProcessors = [...new Set(body.approved_cloud_processors)];
      if (body.ai_execution_mode !== 'rules_only' && body.ai_execution_mode !== deploymentMode) {
        return NextResponse.json(
          { success: false, error: `部署边界只允许 ${deploymentMode} 模式` },
          { status: 409 },
        );
      }
      if (body.ai_execution_mode === 'approved_cloud' && (
        deploymentProcessors.length === 0
        || requestedProcessors.length !== deploymentProcessors.length
        || !deploymentProcessors.every(processor => requestedProcessors.includes(processor))
      )) {
        return NextResponse.json(
          { success: false, error: '必须逐项批准部署声明的全部云端处理方' },
          { status: 400 },
        );
      }
      if (body.ai_execution_mode !== 'approved_cloud' && requestedProcessors.length > 0) {
        return NextResponse.json(
          { success: false, error: '仅 approved_cloud 模式可配置外部处理方' },
          { status: 400 },
        );
      }
      const { data, error } = await supabase.rpc('set_organization_ai_policy', {
        p_mode: body.ai_execution_mode,
        p_approved_cloud_processors: requestedProcessors,
      });
      if (error) throw new Error(`保存企业 AI 策略失败: ${error.message}`);
      return NextResponse.json({ success: true, data });
    }
    const service = getSupabaseServiceClient();
    const generatedSecret = body.action === 'create' && !body.webhook_secret
      ? randomBytes(32).toString('hex')
      : undefined;
    const values: Record<string, unknown> = {
      ...(body.action === 'create' ? { organization_id: user.organizationId, created_by: user.userId } : {}),
      ...Object.fromEntries(Object.entries(body).filter(([key, value]) => (
        !['action', 'connection_id', 'configuration', 'webhook_secret'].includes(key) && value !== undefined
      ))),
      ...(body.configuration !== undefined
        ? { configuration_encrypted: encrypt(JSON.stringify(body.configuration)) }
        : {}),
      ...(body.webhook_secret || generatedSecret
        ? { webhook_secret_encrypted: encrypt(body.webhook_secret ?? generatedSecret) }
        : {}),
      updated_at: new Date().toISOString(),
    };
    const query = body.action === 'create'
      ? service.from('integration_connections').insert(values)
      : service.from('integration_connections').update(values)
        .eq('id', body.connection_id).eq('organization_id', user.organizationId);
    const { data, error } = await query
      .select('id, name, connector_type, status, capabilities, data_boundary_mode, model_endpoint_classification, external_processors, last_sync_at, created_at, updated_at')
      .single();
    if (error) throw new Error(`保存数据源失败: ${error.message}`);
    return NextResponse.json({
      success: true,
      data: { connection: data, ...(generatedSecret ? { webhook_secret_once: generatedSecret } : {}) },
    });
  } catch (error) {
    return apiErrorResponse(error, '保存数据源失败');
  }
}

function parseApprovedProcessors(): string[] {
  return [...new Set((process.env.APPROVED_CLOUD_PROCESSORS ?? '')
    .split(',')
    .map(value => value.trim())
    .filter(Boolean))];
}
