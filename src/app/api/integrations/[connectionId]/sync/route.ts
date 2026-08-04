import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getAdminRequestContext } from '@/lib/auth-server';
import { parseLimitedJson } from '@/lib/api-limits';
import { apiErrorResponse } from '@/lib/api-response';
import { encryptField, generateHmac } from '@/lib/encryption';
import { parseIntegrationCsv } from '@/lib/integrations/csv';
import { INTEGRATION_BODY_LIMIT } from '@/lib/integrations/webhook';
import {
  authorizationSubmissionSchema,
  buildAuthorizationEvidence,
} from '@/lib/privacy/authorization';

const recordSchema = z.object({
  external_id: z.string().trim().min(1).max(500),
  local_entity_id: z.string().uuid().optional(),
  source_updated_at: z.string().datetime({ offset: true }).optional(),
  data: z.record(z.string(), z.unknown()).optional(),
  authorization: z.record(z.string(), z.unknown()).optional(),
}).strict().superRefine((record, context) => {
  if (Number(Boolean(record.local_entity_id)) + Number(Boolean(record.data)) !== 1) {
    context.addIssue({
      code: 'custom',
      path: ['local_entity_id'],
      message: '每条记录必须且只能提供 local_entity_id 或 data',
    });
  }
});

const jobImportSchema = z.strictObject({
  title: z.string().trim().min(1).max(200),
  department: z.string().trim().max(200).nullable().optional(),
  location: z.string().trim().max(200).nullable().optional(),
  salary_range: z.string().trim().max(100).nullable().optional(),
  salary_min: z.number().int().min(0).max(10_000_000).nullable().optional(),
  salary_max: z.number().int().min(0).max(10_000_000).nullable().optional(),
  experience_required: z.string().trim().max(500).nullable().optional(),
  education_required: z.string().trim().max(200).nullable().optional(),
  skills_required: z.array(z.string().trim().min(1).max(100)).max(100).default([]),
  responsibilities: z.array(z.string().trim().min(1).max(500)).max(100).default([]),
  benefits: z.array(z.string().trim().min(1).max(500)).max(100).default([]),
  raw_jd: z.string().max(20_000).nullable().optional(),
});

const candidateImportSchema = z.strictObject({
  name: z.string().trim().min(1).max(200),
  email: z.string().trim().email().max(320).nullable().optional(),
  phone: z.string().trim().max(50).nullable().optional(),
  resume_url: z.string().trim().max(2_000).nullable().optional(),
  skills: z.array(z.string().trim().min(1).max(100)).max(200).default([]),
  experience_years: z.number().min(0).max(100).nullable().optional(),
  education: z.string().trim().max(200).nullable().optional(),
  current_company: z.string().trim().max(500).nullable().optional(),
  current_position: z.string().trim().max(500).nullable().optional(),
  current_city: z.string().trim().max(200).nullable().optional(),
  preferred_locations: z.array(z.string().trim().min(1).max(200)).max(50).default([]),
  salary_expectation: z.string().trim().max(200).nullable().optional(),
  salary_min: z.number().int().min(0).max(10_000_000).nullable().optional(),
  salary_max: z.number().int().min(0).max(10_000_000).nullable().optional(),
  availability: z.string().trim().max(200).nullable().optional(),
  job_change_frequency: z.number().min(0).max(100).nullable().optional(),
  work_history: z.array(z.record(z.string(), z.unknown())).max(100).default([]),
  resume_text: z.string().max(200_000).nullable().optional(),
  notes: z.string().max(10_000).nullable().optional(),
});
const commonFields = {
  entity_type: z.enum(['job', 'candidate', 'outcome']),
  cursor_before: z.string().max(1000).nullable().default(null),
  cursor_after: z.string().max(1000).nullable().default(null),
};
const syncSchema = z.discriminatedUnion('format', [
  z.object({ format: z.literal('json'), records: z.array(recordSchema).min(1).max(100), ...commonFields }).strict(),
  z.object({ format: z.literal('csv'), content: z.string().min(1).max(INTEGRATION_BODY_LIMIT), ...commonFields }).strict(),
]);

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ connectionId: string }> },
) {
  try {
    const { connectionId } = await params;
    if (!z.string().uuid().safeParse(connectionId).success) {
      return NextResponse.json({ success: false, error: '数据源 ID 无效' }, { status: 400 });
    }
    const body = await parseLimitedJson(request, syncSchema, INTEGRATION_BODY_LIMIT);
    const rawRecords = body.format === 'csv' ? parseIntegrationCsv(body.content) : body.records;
    const { supabase, user } = await getAdminRequestContext(request);
    const records = rawRecords.map(record => {
      if (record.local_entity_id) return record;
      if (body.entity_type === 'outcome') {
        throw new Error('结果事件导入必须引用已由签名 webhook 或人工流程创建的 local_entity_id');
      }
      if (body.entity_type === 'job') {
        return { ...record, data: jobImportSchema.parse(record.data) };
      }
      const candidate = candidateImportSchema.parse(record.data);
      const authorization = authorizationSubmissionSchema.parse(record.authorization);
      return {
        ...record,
        data: {
          ...candidate,
          name: encryptField(candidate.name),
          email: encryptField(candidate.email ?? null),
          phone: encryptField(candidate.phone ?? null),
          email_hmac: generateHmac(candidate.email ?? null),
          phone_hmac: generateHmac(candidate.phone ?? null),
          current_company: encryptField(candidate.current_company ?? null),
          current_position: encryptField(candidate.current_position ?? null),
          resume_text: encryptField(candidate.resume_text ?? null),
          data_source: 'authorized_import',
          is_authorized: true,
        },
        authorization: buildAuthorizationEvidence(authorization, user.userId, {
          userAgent: request.headers.get('user-agent'),
          forwardedFor: request.headers.get('x-forwarded-for')
            ?? request.headers.get('x-real-ip'),
        }),
      };
    });
    const { data, error } = await supabase.rpc('import_integration_page', {
      p_connection_id: connectionId,
      p_entity_type: body.entity_type,
      p_records: records,
      p_cursor_before: body.cursor_before,
      p_cursor_after: body.cursor_after,
    });
    if (error?.code === '40001') {
      return NextResponse.json({ success: false, error: '同步游标已变化，请刷新后重试' }, { status: 409 });
    }
    if (error) throw new Error(`同步数据页失败: ${error.message}`);
    return NextResponse.json({ success: true, data });
  } catch (error) {
    return apiErrorResponse(error, '同步数据源失败');
  }
}
