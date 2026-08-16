/**
 * 演示环境共享库：演示组织标识、业务数据重置与种子基线重建。
 * 供 CLI（scripts/seed-demo.ts、scripts/reset-demo.ts）与管理 API（/api/demo/reset）共用，
 * 保证「一键重置」的删除范围与种子基线在命令行和页面上完全一致。
 */
import { getSupabaseServiceClient } from '@/storage/database/supabase-client';
import { encryptField, generateHmac } from '@/lib/encryption';
import { buildAuthorizationEvidence } from '@/lib/privacy/authorization';

// ============================================
// 演示组织标识
// ============================================

/** 演示组织 slug 集合：主演示组织 + 第二演示组织（重置与种子基线的作用范围） */
export const DEMO_ORG_SLUGS = ['drill', 'lanwan-precision'] as const;

// ============================================
// 重置范围（按外键依赖顺序排列：先删依赖方，再删被依赖方）
// 保留：组织（含 AI 审批）、账号、组织成员、登录会话、审计日志、钉钉 MCP 凭证与表格预设
// ============================================

export const DEMO_BUSINESS_TABLES = [
  'recruiting_outcome_events', // 自引用 supersedes RESTRICT，删除前需先清空指针
  'match_status_events',
  'recommendation_decision_events',
  'calibration_proposals',
  'integration_outbox',
  'external_entity_links',
  'integration_sync_runs',
  'integration_connections',
  'shortlist_entries',
  'shortlist_runs',
  'match_records',
  'match_runs',
  'match_batch_tasks',
  'search_records',
  'authorization_records',
  'candidates',
  'job_requirements',
  'job_postings',
  'candidate_rights_requests',
  'organization_invitations',
  'api_rate_limits',
  'boss_search_tasks',
  'boss_contact_requests',
  'resume_batch_tasks',
  'resume_batch_settings',
  'scoring_weight_versions',
] as const;

export interface ResetTableStat {
  table: string;
  count: number;
}

export interface ResetDemoResult {
  orgs: { id: string; name: string; slug: string }[];
  perTable: ResetTableStat[];
  totalDeleted: number;
}

/** 清空两个演示组织的全部业务数据；dryRun 时仅统计不删除 */
export async function resetDemoBusinessData(
  options: { dryRun?: boolean; supabase?: ReturnType<typeof getSupabaseServiceClient> } = {},
): Promise<ResetDemoResult> {
  const supabase = options.supabase ?? getSupabaseServiceClient();
  const { data: orgs, error: orgError } = await supabase
    .from('organizations')
    .select('id, name, slug')
    .in('slug', DEMO_ORG_SLUGS);
  if (orgError) {
    throw new Error(`查询演示组织失败: ${orgError.message}`);
  }
  if (!orgs || orgs.length === 0) {
    throw new Error(`未找到演示组织（${DEMO_ORG_SLUGS.join(' / ')}），请先执行 pnpm admin:bootstrap`);
  }
  const orgIds = orgs.map((org) => org.id);

  if (options.dryRun) {
    const perTable: ResetTableStat[] = [];
    for (const table of DEMO_BUSINESS_TABLES) {
      const { count, error } = await supabase
        .from(table)
        .select('*', { count: 'exact', head: true })
        .in('organization_id', orgIds);
      if (error) {
        throw new Error(`统计 ${table} 失败: ${error.message}`);
      }
      perTable.push({ table, count: count ?? 0 });
    }
    return { orgs, perTable, totalDeleted: 0 };
  }

  // recruiting_outcome_events 自引用（supersedes_event_id ON DELETE RESTRICT）：
  // 先把演示组织内的纠正链指针清空，再按组织删除。
  const { error: clearSupersedesError } = await supabase
    .from('recruiting_outcome_events')
    .update({ supersedes_event_id: null })
    .in('organization_id', orgIds);
  if (clearSupersedesError) {
    throw new Error(`清空 recruiting_outcome_events 自引用失败: ${clearSupersedesError.message}`);
  }

  const perTable: ResetTableStat[] = [];
  let totalDeleted = 0;
  for (const table of DEMO_BUSINESS_TABLES) {
    const { data: deleted, error } = await supabase
      .from(table)
      .delete()
      .in('organization_id', orgIds)
      .select('*');
    if (error) {
      throw new Error(`删除 ${table} 失败: ${error.message}`);
    }
    const count = deleted?.length ?? 0;
    totalDeleted += count;
    perTable.push({ table, count });
  }
  return { orgs, perTable, totalDeleted };
}

// ============================================
// 种子数据
// ============================================

// 示例候选人数据（bound_job_title: 种子写入时绑定的职位标题，null=不绑定，演示人才资源池「未绑定」态）
const demoCandidates = [
  {
    name: '张三',
    email: 'zhangsan@example.com',
    phone: '13700137003',
    current_company: '海康威视',
    current_position: '智能制造工程师',
    current_city: '杭州',
    preferred_locations: ['杭州'],
    experience_years: 4,
    education: '本科',
    skills: ['PLC编程', '工业机器人', 'Python', '机器视觉', 'SCADA'],
    salary_expectation: '25-35K',
    salary_min: 25,
    salary_max: 35,
    availability: '1week',
    job_change_frequency: 0.25, // 0.25次/年，约4年换一次，很稳定
    resume_text: '4年智能制造经验，熟悉西门子PLC编程，有工业机器人集成项目经验，熟悉机器视觉应用，了解数字化工厂解决方案。',
    data_source: 'demo',
    bound_job_title: '智能制造工程师',
  },
  {
    name: '李四',
    email: 'lisi@example.com',
    phone: '13800138011',
    current_company: '三花智控',
    current_position: '自动化产线工程师',
    current_city: '杭州',
    preferred_locations: ['杭州', '宁波'],
    experience_years: 5,
    education: '本科',
    skills: ['PLC编程', '工业机器人', '机器视觉', 'SCADA', 'MES'],
    salary_expectation: '25-35K',
    salary_min: 25,
    salary_max: 35,
    availability: '1month',
    job_change_frequency: 0.4, // 0.4次/年，约2.5年换一次，较稳定
    resume_text: '5年自动化产线经验，主导过汽车零部件产线机器人工作站集成与SCADA监控平台部署，熟悉西门子TIA Portal与基恩士视觉系统。',
    data_source: 'demo',
    bound_job_title: '智能制造工程师',
  },
  {
    name: '王五',
    email: 'wangwu@example.com',
    phone: '13400134006',
    current_company: '吉利控股',
    current_position: '电气自动化工程师',
    current_city: '杭州',
    preferred_locations: ['杭州', '宁波'],
    experience_years: 6,
    education: '大专',
    skills: ['PLC编程', '电气调试', '变频器', '触摸屏'],
    salary_expectation: '18-28K',
    salary_min: 18,
    salary_max: 28,
    availability: '2weeks',
    job_change_frequency: 0.5, // 0.5次/年，约2年换一次
    resume_text: '6年电气自动化经验，精通三菱和西门子PLC编程，负责过3条整车焊装产线电气调试，熟悉变频器和伺服驱动应用。',
    data_source: 'demo',
    bound_job_title: 'PLC 电控工程师',
  },
  {
    name: '赵六',
    email: 'zhaoliu@example.com',
    phone: '13600136014',
    current_company: '汇川技术',
    current_position: '电气自动化工程师',
    current_city: '苏州',
    preferred_locations: ['杭州', '苏州'],
    experience_years: 6,
    education: '本科',
    skills: ['PLC编程', '伺服驱动', 'PROFINET', 'EPLAN', '变频器'],
    salary_expectation: '20-30K',
    salary_min: 20,
    salary_max: 30,
    availability: '2weeks',
    job_change_frequency: 0.4, // 0.4次/年，较稳定
    resume_text: '6年电气自动化经验，精通西门子/汇川PLC与伺服系统调试，使用EPLAN完成电气图纸设计，负责过锂电设备产线交付与现场调试。',
    data_source: 'demo',
    bound_job_title: 'PLC 电控工程师',
  },
  {
    name: '钱七',
    email: 'qianqi@example.com',
    phone: '13300133007',
    current_company: '娃哈哈',
    current_position: '设备维护工程师',
    current_city: '杭州',
    preferred_locations: ['杭州'],
    experience_years: 3,
    education: '大专',
    skills: ['设备维护', '机械制图', '液压系统'],
    salary_expectation: '12-18K',
    salary_min: 12,
    salary_max: 18,
    availability: '1month',
    job_change_frequency: 1.2, // 1.2次/年，跳槽偏频繁
    resume_text: '3年产线设备维护经验，熟悉机械制图和液压系统检修，参与过灌装线年度大修，希望转向自动化方向。',
    data_source: 'demo',
    bound_job_title: 'PLC 电控工程师',
  },
  {
    name: '孙八',
    email: 'sunba@example.com',
    phone: '13900139012',
    current_company: '中控技术',
    current_position: 'MES开发工程师',
    current_city: '杭州',
    preferred_locations: ['杭州'],
    experience_years: 4,
    education: '本科',
    skills: ['Java', 'Spring Boot', 'MySQL', 'Redis', '微服务'],
    salary_expectation: '25-35K',
    salary_min: 25,
    salary_max: 35,
    availability: '1month',
    job_change_frequency: 0.5, // 0.5次/年，约2年换一次
    resume_text: '4年Java开发经验，专注流程工业MES与工业数据平台，熟悉Spring Boot微服务与时序数据存储，参与过多个大型炼化MES项目交付。',
    data_source: 'demo',
    bound_job_title: 'Java后端开发',
  },
  {
    name: '周九',
    email: 'zhoujiu@example.com',
    phone: '13500135015',
    current_company: '蓝卓智能',
    current_position: '数字化工厂实施顾问',
    current_city: '杭州',
    preferred_locations: ['杭州', '宁波'],
    experience_years: 4,
    education: '硕士',
    skills: ['数字化工厂', 'MES', '数据分析', '项目管理', '流程梳理'],
    salary_expectation: '28-40K',
    salary_min: 28,
    salary_max: 40,
    availability: 'negotiable',
    job_change_frequency: 0.33, // 0.33次/年，约3年换一次
    resume_text: '4年制造业数字化转型咨询经验，主导过3家离散制造企业MES落地与产线数据治理，擅长跨部门流程梳理与项目推进。',
    data_source: 'demo',
    bound_job_title: null, // 未绑定：演示人才资源池「未绑定职位」与换绑操作
  },
];

// 示例职位数据
const demoJobs = [
  {
    title: '智能制造工程师',
    department: '生产技术部',
    location: '杭州',
    salary_range: '25-40K',
    salary_min: 25,
    salary_max: 40,
    experience_required: '3年以上智能制造或自动化产线经验',
    education_required: '本科及以上学历，机械、自动化相关专业',
    skills_required: ['PLC编程', '工业机器人', '数字化工厂'],
    bonus_skills: ['Python', '机器视觉', '边缘计算'],
    search_keywords: ['智能制造工程师', '自动化工程师', 'PLC编程', '工业机器人', '数字化工厂', '机器视觉', '边缘计算'],
    responsibilities: [
      '负责智能产线规划与实施',
      '工业机器人系统集成',
      '产线数据采集与分析系统搭建',
    ],
    benefits: ['五险一金', '餐补', '交通补贴'],
    urgency: 'normal',
    implicit_requirements: ['需IT+制造业复合背景', '可能需要现场调试出差'],
    completeness: 75,
    missing_fields: ['出差频率', '项目周期', '汇报层级'],
    raw_jd: `【招聘岗位】
职位名称：智能制造工程师
部门：生产技术部
工作地点：杭州
薪资范围：25-40K

【岗位要求】
1. 本科及以上学历，机械、自动化相关专业
2. 3年以上智能制造或自动化产线经验
3. 熟悉PLC编程、工业机器人调试
4. 了解数字化工厂解决方案

【岗位职责】
1. 负责智能产线规划与实施
2. 工业机器人系统集成
3. 产线数据采集与分析系统搭建

【福利待遇】
- 五险一金
- 餐补
- 交通补贴`,
    status: 'active',
  },
  {
    title: 'PLC 电控工程师',
    department: '设备动力部',
    location: '杭州',
    salary_range: '15-25K',
    salary_min: 15,
    salary_max: 25,
    experience_required: '3年以上产线电气调试经验',
    education_required: '大专及以上学历，电气自动化、机电一体化专业优先',
    skills_required: ['PLC编程', '电气调试', '伺服驱动', 'PROFINET'],
    bonus_skills: ['EPLAN', '工业机器人', '触摸屏'],
    search_keywords: ['PLC电控工程师', 'PLC工程师', '电气调试工程师', 'PLC编程', 'PROFINET', '伺服驱动', 'EPLAN'],
    responsibilities: [
      '负责新产线电气调试与验收',
      '现有产线 PLC 程序维护与优化',
      '设备预防性维护计划制定与执行',
    ],
    benefits: ['五险一金', '倒班津贴', '免费宿舍'],
    urgency: 'urgent',
    implicit_requirements: ['需适应产线爬坡期倒班与值班（隐含）', '有整车或零部件厂现场调试经验优先'],
    completeness: 78,
    missing_fields: ['倒班安排', '值班频率', '汇报对象'],
    raw_jd: `【招聘岗位】
职位名称：PLC 电控工程师
部门：设备动力部
工作地点：杭州
薪资范围：15-25K

【岗位要求】
1. 大专及以上学历，电气自动化、机电一体化专业优先
2. 3年以上产线电气调试经验
3. 精通西门子或三菱 PLC 编程，熟悉 PROFINET / Modbus
4. 熟悉伺服驱动、变频器、触摸屏等应用调试

【岗位职责】
1. 负责新产线电气调试与验收
2. 现有产线 PLC 程序维护与优化
3. 设备预防性维护计划制定与执行

【福利待遇】
- 五险一金
- 倒班津贴
- 免费宿舍`,
    status: 'active',
  },
];

// ============================================
// 种子基线写入（幂等）
// ============================================

export interface SeedDemoResult {
  candidatesInserted: number;
  jobsInserted: number;
  jobsBackfilled: number;
}

export async function seedDemoData(): Promise<SeedDemoResult> {
  const supabase = getSupabaseServiceClient();
  console.log('开始植入Demo数据...\n');

  // 0. 幂等准备演示组织（主组织更名“精密智造集团演示账户”，第二组织“精密智造分公司”）：让评审员体验登录选组织、导航栏切换与多租户隔离
  console.log('0. 准备演示组织...');
  const PRIMARY_ORG_SLUG = 'drill';
  const PRIMARY_ORG_NAME = '精密智造集团演示账户';
  const SECOND_ORG_NAME = '精密智造分公司';
  const SECOND_ORG_SLUG = 'lanwan-precision';

  // 优先选主演示组织（drill）的管理员作为种子写入者；缺失时回退任意组织管理员
  const { data: drillOrgLookup } = await supabase
    .from('organizations')
    .select('id')
    .eq('slug', PRIMARY_ORG_SLUG)
    .maybeSingle();
  let membershipsQuery = supabase
    .from('organization_members')
    .select('organization_id, user_id')
    .eq('role', 'admin')
    .eq('is_active', true);
  if (drillOrgLookup?.id) {
    membershipsQuery = membershipsQuery.eq('organization_id', drillOrgLookup.id);
  }
  let { data: memberships, error: membershipError } = await membershipsQuery.limit(1);
  if (!membershipError && !memberships?.length) {
    const fallback = await supabase
      .from('organization_members')
      .select('organization_id, user_id')
      .eq('role', 'admin')
      .eq('is_active', true)
      .limit(1);
    memberships = fallback.data;
    membershipError = fallback.error ?? null;
  }
  const organizationId = memberships?.[0]?.organization_id;
  const collectorUserId = memberships?.[0]?.user_id;
  if (membershipError || !organizationId || !collectorUserId) {
    throw new Error('未找到可用组织管理员，请先执行 pnpm admin:bootstrap');
  }

  // 主演示组织 slug 固定为 drill，仅校准展示名称
  const { data: primaryOrg } = await supabase
    .from('organizations')
    .select('id, name')
    .eq('slug', PRIMARY_ORG_SLUG)
    .maybeSingle();
  if (primaryOrg && primaryOrg.name !== PRIMARY_ORG_NAME) {
    const { error: renamePrimaryError } = await supabase
      .from('organizations')
      .update({ name: PRIMARY_ORG_NAME })
      .eq('id', primaryOrg.id);
    if (renamePrimaryError) {
      throw new Error(`主演示组织更名失败: ${renamePrimaryError.message}`);
    }
    console.log(`  ✅ 主演示组织已更名为“${PRIMARY_ORG_NAME}”`);
  }

  const { data: existingSecondOrg } = await supabase
    .from('organizations')
    .select('id, name')
    .eq('slug', SECOND_ORG_SLUG)
    .maybeSingle();
  let secondOrganizationId: string;
  if (existingSecondOrg?.id) {
    secondOrganizationId = existingSecondOrg.id;
    if (existingSecondOrg.name !== SECOND_ORG_NAME) {
      const { error: renameSecondError } = await supabase
        .from('organizations')
        .update({ name: SECOND_ORG_NAME })
        .eq('id', secondOrganizationId);
      if (renameSecondError) {
        throw new Error(`第二演示组织更名失败: ${renameSecondError.message}`);
      }
      console.log(`  ✅ 第二演示组织已更名为“${SECOND_ORG_NAME}”`);
    } else {
      console.log(`  ⏩ “${SECOND_ORG_NAME}”已存在，跳过`);
    }
  } else {
    const { data: createdOrg, error: createOrgError } = await supabase
      .from('organizations')
      .insert({ name: SECOND_ORG_NAME, slug: SECOND_ORG_SLUG })
      .select('id')
      .single();
    if (createOrgError || !createdOrg) {
      throw new Error(`创建第二演示组织失败: ${createOrgError?.message ?? '未知错误'}`);
    }
    secondOrganizationId = createdOrg.id;
    console.log(`  ✅ 已创建“${SECOND_ORG_NAME}”（slug: ${SECOND_ORG_SLUG}）`);
  }

  // 将演示管理员同时加入第二组织，登录后即可在导航栏切换组织
  const { error: secondMembershipError } = await supabase
    .from('organization_members')
    .upsert(
      { organization_id: secondOrganizationId, user_id: collectorUserId, role: 'admin', is_active: true },
      { onConflict: 'user_id,organization_id', ignoreDuplicates: true },
    );
  if (secondMembershipError) {
    throw new Error(`将演示管理员加入第二组织失败: ${secondMembershipError.message}（请确认已执行最新 migrate.sql，解除一人一组织限制）`);
  }

  // 1. 插入职位数据（历史职位缺少职位描述/岗位关键词/负责人时非破坏性回填）
  // 职位先于候选人写入：候选人的 source_job_id 绑定依赖职位 ID
  console.log('\n1. 插入职位数据...');
  const jobIdByTitle = new Map<string, string>();
  let jobsInserted = 0;
  let jobsBackfilled = 0;
  for (const job of demoJobs) {
    const { data: existingJob } = await supabase
      .from('job_requirements')
      .select('id, raw_jd, search_keywords, owner_user_id')
      .eq('organization_id', organizationId)
      .eq('title', job.title)
      .maybeSingle();

    if (existingJob) {
      jobIdByTitle.set(job.title, existingJob.id);
      const updates: Record<string, unknown> = {};
      if (!existingJob.raw_jd) updates.raw_jd = job.raw_jd;
      const existingKeywords = existingJob.search_keywords;
      if (!Array.isArray(existingKeywords) || existingKeywords.length === 0) {
        updates.search_keywords = job.search_keywords;
      }
      if (!existingJob.owner_user_id) updates.owner_user_id = collectorUserId;
      if (Object.keys(updates).length > 0) {
        const { error: updateError } = await supabase
          .from('job_requirements')
          .update({ ...updates, updated_at: new Date().toISOString() })
          .eq('id', existingJob.id);
        if (updateError) {
          console.log(`  ❌ ${job.title}: 回填失败: ${updateError.message}`);
        } else {
          jobsBackfilled++;
          console.log(`  🔄 ${job.title} 已存在，回填缺失字段`);
        }
      } else {
        console.log(`  ⏩ ${job.title} 已存在且数据完整，跳过`);
      }
      continue;
    }

    const { data: insertedJob, error } = await supabase
      .from('job_requirements')
      .insert({
        ...job,
        organization_id: organizationId,
        owner_user_id: collectorUserId,
        activated_at: new Date().toISOString(),
      })
      .select('id')
      .single();

    if (!error && insertedJob) {
      jobIdByTitle.set(job.title, insertedJob.id);
      jobsInserted++;
      console.log(`  ✅ ${job.title} - ${job.department} (${job.urgency === 'urgent' ? '紧急' : '常规'})`);
    } else if (error?.code === '23505') {
      console.log(`  ⚠️ ${job.title} 已存在，跳过`);
    } else {
      console.log(`  ❌ ${job.title}: ${error?.message ?? '未知错误'}`);
    }
  }
  console.log(`共插入 ${jobsInserted} 个职位，回填 ${jobsBackfilled} 个历史职位的缺失字段`);

  // 2. 插入候选人数据 + 授权记录 + 职位绑定
  console.log('\n2. 插入候选人数据...');
  let candidatesInserted = 0;
  for (const raw of demoCandidates) {
    // bound_job_title 仅用于种子绑定，不属于候选人表字段
    const { bound_job_title: boundJobTitle, ...candidateRow } = raw;
    const boundJobId = boundJobTitle ? (jobIdByTitle.get(boundJobTitle) ?? null) : null;
    if (boundJobTitle && !boundJobId) {
      console.log(`  ⚠️ ${raw.name}: 未找到职位「${boundJobTitle}」，将以未绑定写入`);
    }

    // 加密敏感字段
    const emailHmac = generateHmac(raw.email);
    const phoneHmac = generateHmac(raw.phone);

    if (!emailHmac || !phoneHmac) {
      console.log(`  ❌ ${raw.name}: HMAC 生成失败`);
      continue;
    }

    // 用 email_hmac 精确查重（email 已加密，无法模糊匹配）
    const { data: existing } = await supabase
      .from('candidates')
      .select('id')
      .eq('organization_id', organizationId)
      .eq('email_hmac', emailHmac)
      .maybeSingle();

    if (existing) {
      // 已存在：仍幂等回填职位绑定，保证重跑种子后绑定基线一致
      const { error: rebindError } = await supabase
        .from('candidates')
        .update({
          source_job_id: boundJobId,
          source_job_binding_status: boundJobId ? 'active' : null,
        })
        .eq('id', existing.id)
        .eq('organization_id', organizationId);
      const bindNote = rebindError
        ? `（绑定回填失败: ${rebindError.message}）`
        : `（绑定: ${boundJobTitle ?? '未绑定'}）`;
      console.log(`  ⏩ ${raw.name} 已存在，跳过 ${bindNote}`);
      continue;
    }

    const encryptedCandidate = {
      ...candidateRow,
      organization_id: organizationId,
      name: encryptField(raw.name),
      email: encryptField(raw.email),
      phone: encryptField(raw.phone),
      current_company: encryptField(raw.current_company || null),
      current_position: encryptField(raw.current_position || null),
      resume_text: encryptField(raw.resume_text || null),
      email_hmac: emailHmac,
      phone_hmac: phoneHmac,
      is_authorized: true,
      source_job_id: boundJobId,
      source_job_binding_status: boundJobId ? 'active' : null,
    };

    const { data: candData, error } = await supabase
      .from('candidates')
      .insert(encryptedCandidate)
      .select('id')
      .single();

    if (!error && candData) {
      candidatesInserted++;
      console.log(`  ✅ ${raw.name} - ${raw.current_position} (${raw.current_city}, ${raw.salary_expectation}, 到岗:${raw.availability})`);

      // Demo候选人均为虚构数据；仍使用完整证据结构验证系统门禁。
      const authorizedAt = new Date();
      const processingExpiresAt = new Date(authorizedAt);
      processingExpiresAt.setFullYear(processingExpiresAt.getFullYear() + 1);
      const authorizationEvidence = buildAuthorizationEvidence(
        {
          confirmed: true,
          source_type: 'other',
          source_reference: `demo-seed:${candData.id}`,
          proof_type: 'other',
          proof_reference: `demo-fixture:${candData.id}`,
          proof_sha256: '',
          controller_name: '精密智造集团演示账户',
          controller_contact: '演示环境管理员',
          authorized_at: authorizedAt.toISOString(),
          processing_expires_at: processingExpiresAt.toISOString(),
          external_processors: [
            'Supabase（候选人数据存储）',
            'LLM服务（去标识化匹配说明）',
          ],
          automated_decision_preference: 'assistive',
          impact_assessment_reference: 'DEMO-PIA-CANDIDATE-MATCHING-V1',
          impact_assessment_completed_at: authorizedAt.toISOString(),
        },
        collectorUserId,
        {
          userAgent: 'seed-demo',
          forwardedFor: null,
        },
      );

      const { error: authError } = await supabase
        .from('authorization_records')
        .insert({
          ...authorizationEvidence,
          organization_id: organizationId,
          candidate_id: candData.id,
        });

      if (authError) {
        await supabase
          .from('candidates')
          .delete()
          .eq('id', candData.id)
          .eq('organization_id', organizationId);
        candidatesInserted--;
        if (!authError.message.includes('duplicate') && !authError.message.includes('23505')) {
          console.log(`  ⚠️ ${raw.name} 授权记录写入失败: ${authError.message}`);
        }
      }
    } else if (error) {
      console.log(`  ❌ ${raw.name}: ${error.message}`);
    }
  }
  console.log(`共插入 ${candidatesInserted} 位候选人`);

  // 3. 统计结果
  console.log('\n========================================');
  console.log('Demo数据植入完成！');
  console.log('========================================');
  console.log(`候选人: ${candidatesInserted} 位`);
  console.log(`职 位: ${jobsInserted} 个`);
  console.log('========================================');
  return { candidatesInserted, jobsInserted, jobsBackfilled };
}

