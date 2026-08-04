import { NextRequest, NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getAdminRequestContext } from '@/lib/auth-server';
import { credentialEndpointHost, DEFAULT_RESUME_STYLE_SAMPLE } from '@/lib/resume-batch';
import { decrypt, encrypt } from '@/lib/encryption';
import { loadEnv } from '@/storage/database/supabase-client';

interface AdminActionBody {
  action?: string;
  id?: string;
  name?: string;
  mcpUrl?: string;
  sheetUrl?: string;
  worksheetId?: string;
  credentialId?: string;
  apiKey?: string;
  baseUrl?: string;
  textModel?: string;
  visionModel?: string;
  workers?: string;
  styleSample?: string;
}

interface ResumeBatchSettingsRow {
  llm_api_key_encrypted: string | null;
  llm_base_url: string | null;
  text_model: string | null;
  vision_model: string | null;
  workers: number | null;
  style_sample: string | null;
}

interface ChatCompletionResponse {
  choices?: Array<{
    message?: {
      content?: unknown;
    };
  }>;
}

async function loadSettings(
  supabase: SupabaseClient,
  organizationId: string,
): Promise<ResumeBatchSettingsRow | null> {
  const { data, error } = await supabase
    .from('resume_batch_settings')
    .select('llm_api_key_encrypted, llm_base_url, text_model, vision_model, workers, style_sample')
    .eq('organization_id', organizationId)
    .maybeSingle();
  if (error) {
    throw new Error(error.message);
  }
  return data as ResumeBatchSettingsRow | null;
}

function validateLlmBaseUrl(value: string): string | null {
  const input = value.trim();
  if (!input) return null;
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new Error('模型 Base URL 格式不正确');
  }
  const localHttp = url.protocol === 'http:'
    && ['127.0.0.1', 'localhost', '::1'].includes(url.hostname);
  if (url.protocol !== 'https:' && !localHttp) {
    throw new Error('模型 Base URL 必须使用 HTTPS（本机地址除外）');
  }
  return url.toString().replace(/\/$/, '');
}

function effectiveLlm(settings: ResumeBatchSettingsRow | null) {
  const hasTenantEndpoint = Boolean(settings?.llm_base_url);
  const environmentKey = process.env.LLM_API_KEY?.trim()
    || process.env.DASHSCOPE_API_KEY?.trim()
    || '';
  const mayUseEnvironmentKey = !hasTenantEndpoint;
  return {
    configured: Boolean(
      settings?.llm_api_key_encrypted
      || (mayUseEnvironmentKey && environmentKey),
    ),
    apiKeySource: settings?.llm_api_key_encrypted
      ? 'database'
      : mayUseEnvironmentKey && environmentKey ? 'environment' : 'none',
    resumeAnalysisAllowed: process.env.ALLOW_EXTERNAL_RESUME_BATCH_ANALYSIS === 'true',
    baseUrl: settings?.llm_base_url
      || process.env.LLM_BASE_URL
      || 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    textModel: settings?.text_model || process.env.LLM_MODEL || 'qwen-plus',
    visionModel: settings?.vision_model
      || process.env.RESUME_VL_MODEL
      || process.env.VL_MODEL
      || 'qwen-vl-max',
    workers: settings?.workers || Number(process.env.PIPELINE_WORKERS) || 8,
    styleSample: settings?.style_sample || DEFAULT_RESUME_STYLE_SAMPLE,
    customStyleSample: Boolean(settings?.style_sample),
  };
}

function validateMcpUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('MCP URL 格式不正确');
  }
  if (url.protocol !== 'https:') {
    throw new Error('MCP URL 必须使用 HTTPS');
  }
  return url.toString();
}

function validateSheetTarget(value: string): string {
  const target = value.trim();
  if (!target) {
    throw new Error('请填写钉钉表格链接或 nodeId');
  }
  if (/^https:\/\//i.test(target) || /^[A-Za-z0-9_-]{8,}$/.test(target)) {
    return target;
  }
  throw new Error('钉钉表格链接或 nodeId 格式不正确');
}

export async function GET(request: NextRequest) {
  try {
    const { supabase, user } = await getAdminRequestContext(request);
    loadEnv();
    const [
      { data: credentials, error: credentialError },
      { data: sheets, error: sheetError },
      settings,
    ] = await Promise.all([
      supabase
        .from('resume_batch_credentials')
        .select('id, name, mcp_url_encrypted, created_at, updated_at')
        .eq('organization_id', user.organizationId)
        .order('created_at', { ascending: false }),
      supabase
        .from('resume_batch_sheets')
        .select('id, name, sheet_url, worksheet_id, credential_id, created_at, updated_at')
        .eq('organization_id', user.organizationId)
        .order('created_at', { ascending: false }),
      loadSettings(supabase, user.organizationId),
    ]);

    if (credentialError) {
      throw new Error(credentialError.message);
    }
    if (sheetError) {
      throw new Error(sheetError.message);
    }

    const credentialNames = new Map(
      (credentials || []).map(credential => [credential.id, credential.name]),
    );

    return NextResponse.json({
      success: true,
      data: {
        credentials: (credentials || []).map(credential => {
          const mcpUrl = decrypt(credential.mcp_url_encrypted);
          return {
            id: credential.id,
            name: credential.name,
            endpointHost: credentialEndpointHost(mcpUrl || ''),
            createdAt: credential.created_at,
            updatedAt: credential.updated_at,
          };
        }),
        sheets: (sheets || []).map(sheet => ({
          id: sheet.id,
          name: sheet.name,
          sheetUrl: sheet.sheet_url,
          worksheetId: sheet.worksheet_id,
          credentialId: sheet.credential_id,
          credentialName: credentialNames.get(sheet.credential_id) || '凭证已删除',
          createdAt: sheet.created_at,
          updatedAt: sheet.updated_at,
        })),
        llm: effectiveLlm(settings),
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : '未知错误';
    const status = message === '权限不足' ? 403 : message === '未登录' ? 401 : 500;
    return NextResponse.json(
      { success: false, error: `读取简历批处理配置失败: ${message}` },
      { status },
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const { supabase, user } = await getAdminRequestContext(request);
    loadEnv();
    const body = await request.json() as AdminActionBody;
    const now = new Date().toISOString();
    let responseMessage = '配置已保存';

    switch (body.action) {
      case 'save_settings': {
        const baseUrl = validateLlmBaseUrl(body.baseUrl || '');
        const textModel = body.textModel?.trim() || null;
        const visionModel = body.visionModel?.trim() || null;
        if ((textModel?.length || 0) > 200 || (visionModel?.length || 0) > 200) {
          throw new Error('模型名称不能超过 200 个字符');
        }
        const workersText = body.workers?.trim() || '';
        const workers = workersText ? Number(workersText) : null;
        if (workers !== null && (!Number.isInteger(workers) || workers < 1 || workers > 32)) {
          throw new Error('并发数必须是 1-32 的整数');
        }
        const styleSample = body.styleSample?.trim() || '';
        if (styleSample.length < 20) {
          throw new Error('参考范例至少需要 20 个字符');
        }

        const values: Record<string, string | number | null> = {
          organization_id: user.organizationId,
          llm_base_url: baseUrl,
          text_model: textModel,
          vision_model: visionModel,
          workers,
          style_sample: styleSample,
          updated_by: user.userId,
          updated_at: now,
        };
        if (body.apiKey?.trim()) {
          values.llm_api_key_encrypted = encrypt(body.apiKey.trim());
        }
        const { error } = await supabase
          .from('resume_batch_settings')
          .upsert(values, { onConflict: 'organization_id' });
        if (error) {
          throw new Error(error.message);
        }
        responseMessage = '模型与推荐理由配置已保存';
        break;
      }

      case 'reset_style': {
        const { error } = await supabase
          .from('resume_batch_settings')
          .upsert({
            organization_id: user.organizationId,
            style_sample: null,
            updated_by: user.userId,
            updated_at: now,
          }, { onConflict: 'organization_id' });
        if (error) {
          throw new Error(error.message);
        }
        responseMessage = '已恢复内置推荐理由范例';
        break;
      }

      case 'test_llm': {
        const settings = await loadSettings(supabase, user.organizationId);
        const storedKey = settings?.llm_api_key_encrypted
          ? decrypt(settings.llm_api_key_encrypted)
          : null;
        const apiKey = storedKey
          || (!settings?.llm_base_url
            ? process.env.LLM_API_KEY?.trim()
              || process.env.DASHSCOPE_API_KEY?.trim()
            : '')
          || '';
        if (!apiKey) {
          throw new Error('未配置模型 API Key');
        }
        const effective = effectiveLlm(settings);
        const response = await fetch(
          `${effective.baseUrl.replace(/\/$/, '')}/chat/completions`,
          {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${apiKey}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              model: effective.textModel,
              messages: [{ role: 'user', content: '回复：OK' }],
            }),
            signal: AbortSignal.timeout(30_000),
          },
        );
        if (!response.ok) {
          throw new Error(`模型连通失败（HTTP ${response.status}）`);
        }
        const result = await response.json() as ChatCompletionResponse;
        const content = result.choices?.[0]?.message?.content;
        if (typeof content !== 'string' || !content.trim()) {
          throw new Error('模型连通成功，但返回内容格式不正确');
        }
        responseMessage = `模型连通正常：${effective.textModel}`;
        break;
      }

      case 'save_credential': {
        const name = body.name?.trim() || '';
        if (!name) {
          throw new Error('请填写凭证名称');
        }

        if (body.id) {
          const updates: Record<string, string> = { name, updated_at: now };
          if (body.mcpUrl?.trim()) {
            updates.mcp_url_encrypted = encrypt(validateMcpUrl(body.mcpUrl.trim())) || '';
          }
          const { error } = await supabase
            .from('resume_batch_credentials')
            .update(updates)
            .eq('id', body.id)
            .eq('organization_id', user.organizationId);
          if (error) {
            throw new Error(error.message);
          }
        } else {
          if (!body.mcpUrl?.trim()) {
            throw new Error('请填写 MCP URL');
          }
          const { error } = await supabase
            .from('resume_batch_credentials')
            .insert({
              organization_id: user.organizationId,
              name,
              mcp_url_encrypted: encrypt(validateMcpUrl(body.mcpUrl.trim())),
              created_by: user.userId,
            });
          if (error) {
            throw new Error(error.message);
          }
        }
        break;
      }

      case 'delete_credential': {
        if (!body.id) {
          throw new Error('缺少凭证 ID');
        }
        const { count, error: countError } = await supabase
          .from('resume_batch_sheets')
          .select('id', { count: 'exact', head: true })
          .eq('credential_id', body.id)
          .eq('organization_id', user.organizationId);
        if (countError) {
          throw new Error(countError.message);
        }
        if ((count || 0) > 0) {
          throw new Error('该凭证仍被表格预设使用，请先删除或调整表格预设');
        }
        const { error } = await supabase
          .from('resume_batch_credentials')
          .delete()
          .eq('id', body.id)
          .eq('organization_id', user.organizationId);
        if (error) {
          throw new Error(error.message);
        }
        break;
      }

      case 'save_sheet': {
        const name = body.name?.trim() || '';
        const credentialId = body.credentialId?.trim() || '';
        if (!name) {
          throw new Error('请填写表格名称');
        }
        if (!credentialId) {
          throw new Error('请选择 MCP 凭证');
        }
        const sheetUrl = validateSheetTarget(body.sheetUrl || '');
        const worksheetId = body.worksheetId?.trim() || null;
        const { data: credential, error: credentialError } = await supabase
          .from('resume_batch_credentials')
          .select('id')
          .eq('id', credentialId)
          .eq('organization_id', user.organizationId)
          .single();
        if (credentialError || !credential) {
          throw new Error('选择的 MCP 凭证不存在');
        }

        if (body.id) {
          const { error } = await supabase
            .from('resume_batch_sheets')
            .update({
              name,
              sheet_url: sheetUrl,
              worksheet_id: worksheetId,
              credential_id: credentialId,
              updated_at: now,
            })
            .eq('id', body.id)
            .eq('organization_id', user.organizationId);
          if (error) {
            throw new Error(error.message);
          }
        } else {
          const { error } = await supabase
            .from('resume_batch_sheets')
            .insert({
              organization_id: user.organizationId,
              name,
              sheet_url: sheetUrl,
              worksheet_id: worksheetId,
              credential_id: credentialId,
              created_by: user.userId,
            });
          if (error) {
            throw new Error(error.message);
          }
        }
        break;
      }

      case 'delete_sheet': {
        if (!body.id) {
          throw new Error('缺少表格预设 ID');
        }
        const { count, error: countError } = await supabase
          .from('resume_batch_tasks')
          .select('id', { count: 'exact', head: true })
          .eq('sheet_preset_id', body.id)
          .eq('organization_id', user.organizationId)
          .in('status', ['uploading', 'pending', 'running']);
        if (countError) {
          throw new Error(countError.message);
        }
        if ((count || 0) > 0) {
          throw new Error('该表格仍有进行中的任务，暂时不能删除');
        }
        const { error } = await supabase
          .from('resume_batch_sheets')
          .delete()
          .eq('id', body.id)
          .eq('organization_id', user.organizationId);
        if (error) {
          throw new Error(error.message);
        }
        break;
      }

      default:
        throw new Error('不支持的配置操作');
    }

    return NextResponse.json({ success: true, data: { message: responseMessage } });
  } catch (error) {
    const message = error instanceof Error ? error.message : '未知错误';
    const status = message === '权限不足'
      ? 403
      : message === '未登录'
        ? 401
        : /请填写|请选择|缺少|格式|不支持|仍被|进行中|不能超过|必须是|至少需要|未配置模型/.test(message)
          ? 400
          : 500;
    return NextResponse.json(
      { success: false, error: message },
      { status },
    );
  }
}
