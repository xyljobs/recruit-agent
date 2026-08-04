import { NextRequest, NextResponse } from 'next/server';
import { createTenantAiExecutionGateway } from '@/lib/ai/gateway';
import { decryptField } from '@/lib/encryption';
import { getTenantRequestContext } from '@/lib/auth-server';
import { loadProcessableCandidateIds } from '@/lib/privacy/authorization-access';
import {
  candidateSearchBodySchema,
  parseLimitedJson,
  SMALL_JSON_BODY_LIMIT,
} from '@/lib/api-limits';
import { enforceRateLimit } from '@/lib/rate-limit';

/** Sanitize user input for safe use in Supabase .or() queries — strip quotes and special chars */
function sanitizeQueryParam(value: string): string {
  return value.replace(/["'\\{}\[\]();]/g, '').trim();
}

/**
 * 简历搜索API - 内部候选人库智能检索
 * 基于职位需求在已授权候选人库中搜索匹配人选
 * 合规前提：仅返回授权证据已核验且仍在处理期限内的候选人
 * 安全：敏感字段AES-256加密存储，支持HMAC签名精确检索
 */
export async function POST(request: NextRequest) {
  try {
    const { jobId, keywords, skills, location, salaryRange, experienceRange, limit } = await parseLimitedJson(
      request,
      candidateSearchBodySchema,
      SMALL_JSON_BODY_LIMIT,
    );

    const { supabase, user } = await getTenantRequestContext(request);
    await enforceRateLimit(supabase, { scope: 'candidates:search' });
    // 构建搜索条件
    const searchQuery: {
      keywords?: string[];
      skills?: string[];
      location?: string;
      salary_range?: string;
      experience_range?: string;
    } = {};

    // 如果提供了jobId，从职位需求中提取搜索条件
    if (jobId) {
      const { data: job } = await supabase
        .from('job_requirements')
        .select('*')
        .eq('id', jobId)
        .eq('organization_id', user.organizationId)
        .single();

      if (job) {
        searchQuery.skills = job.skills_required || [];
        searchQuery.location = job.location;
        searchQuery.keywords = [job.title];
        
        // 使用LLM扩展搜索关键词
        const aiGateway = await createTenantAiExecutionGateway(
          supabase,
          user.organizationId,
          request.headers,
        );
        
        if (aiGateway.canUseModel) {
          try {
            const expandPrompt = `根据以下职位需求，生成搜索候选人的关键词（用于在简历中搜索）：
职位：${job.title}
技能要求：${JSON.stringify(job.skills_required)}
经验要求：${job.experience_required}
地点：${job.location}

请返回一个JSON数组，包含5-10个搜索关键词（包括职位别名、相关技能、同义词等）：
["关键词1", "关键词2", ...]`;

            let expandedKeywords: string[] = [];
            const stream = aiGateway.stream([{ role: 'user', content: expandPrompt }], {
              model: aiGateway.policy.modelName ?? undefined,
              temperature: 0.5,
            });

            let response = '';
            for await (const chunk of stream) {
              if (chunk.content) {
                response += chunk.content.toString();
              }
            }

            const jsonMatch = response.match(/\[[\s\S]*\]/);
            if (jsonMatch) {
              expandedKeywords = JSON.parse(jsonMatch[0]);
              searchQuery.keywords = [...(searchQuery.keywords || []), ...expandedKeywords];
            }
          } catch (e) {
            console.warn('关键词扩展失败:', e);
          }
        }
      }
    } else {
      // 使用传入的搜索条件
      searchQuery.keywords = keywords;
      searchQuery.skills = skills;
      searchQuery.location = location;
    }

    const processableCandidateIds = await loadProcessableCandidateIds(
      supabase,
      user.organizationId,
    );
    const candidateIdsForQuery = processableCandidateIds.length > 0
      ? processableCandidateIds
      : ['00000000-0000-0000-0000-000000000000'];

    // 仅检索证据已核验且仍在处理期限内的候选人。
    let query = supabase
      .from('candidates')
      .select('*', { count: 'exact' })
      .eq('organization_id', user.organizationId)
      .eq('is_authorized', true)
      .in('id', candidateIdsForQuery);

    // 技能匹配（使用数组重叠）
    if (searchQuery.skills && searchQuery.skills.length > 0) {
      // 使用文本搜索匹配技能，sanitize 防注入
      query = query.or(
        searchQuery.skills.map(skill => `skills.cs.["${sanitizeQueryParam(skill)}"]`).join(',')
      );
    }

    // 地点筛选
    if (searchQuery.location) {
      const safeLocation = sanitizeQueryParam(searchQuery.location);
      query = query.or(`current_city.ilike.%${safeLocation}%,preferred_locations.cs.["${safeLocation}"]`);
    }

    // 执行查询
    const { data: candidates, error, count } = await query
      .limit(limit)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('搜索候选人失败:', error);
      return NextResponse.json(
        { error: '搜索候选人失败' },
        { status: 500 }
      );
    }

    // 保存搜索记录
    if (jobId) {
      await supabase
        .from('search_records')
        .insert({
          organization_id: user.organizationId,
          job_id: jobId,
          search_query: searchQuery,
          results_count: count || 0,
          candidates_found: candidates?.map(c => c.id) || [],
        });
    }

    // 解密加密字段后再脱敏处理
    const desensitizedCandidates = candidates?.map(c => {
      const decrypted = {
        ...c,
        name: decryptField(c.name),
        phone: decryptField(c.phone),
        email: decryptField(c.email),
        resume_text: decryptField(c.resume_text),
        current_company: decryptField(c.current_company) || c.current_company,
        current_position: decryptField(c.current_position) || c.current_position,
      };
      return {
        ...decrypted,
        name: maskName(decrypted.name),
        phone: maskPhone(decrypted.phone),
        email: maskEmail(decrypted.email),
      };
    });

    return NextResponse.json({
      success: true,
      data: {
        candidates: desensitizedCandidates,
        total: count,
        search_query: searchQuery,
      }
    });

  } catch (error) {
    console.error('简历搜索API错误:', error);
    return NextResponse.json(
      { error: '服务器内部错误' },
      { status: 500 }
    );
  }
}

// 数据脱敏函数
function maskName(name: string | null): string {
  if (!name) return '未知';
  if (name.length <= 1) return name;
  if (name.length === 2) return name[0] + '*';
  return name[0] + '*'.repeat(name.length - 2) + name[name.length - 1];
}

function maskPhone(phone: string | null): string {
  if (!phone) return '未填写';
  return phone.replace(/(\d{3})\d{4}(\d{4})/, '$1****$2');
}

function maskEmail(email: string | null): string {
  if (!email) return '未填写';
  const [name, domain] = email.split('@');
  if (!domain) return email;
  const maskedName = name.length > 2 
    ? name[0] + '*'.repeat(name.length - 2) + name[name.length - 1]
    : name[0] + '*';
  return `${maskedName}@${domain}`;
}
