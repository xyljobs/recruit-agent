/**
 * 种子数据脚本 - Demo数据初始化
 * 运行: pnpm exec tsx scripts/seed-demo.ts
 */

import dotenv from 'dotenv';
import path from 'path';

// 优先加载 .env.local，再 fallback .env
const envLocal = path.resolve(process.cwd(), '.env.local');
dotenv.config({ path: envLocal });
dotenv.config(); // fallback to .env
import { getSupabaseServiceClient } from '../src/storage/database/supabase-client';
import { encryptField, generateHmac } from '../src/lib/encryption';
import { buildAuthorizationEvidence } from '../src/lib/privacy/authorization';

const supabase = getSupabaseServiceClient();

// 示例候选人数据
const demoCandidates = [
  {
    name: '张明',
    email: 'zhangming@example.com',
    phone: '13800138001',
    current_company: '阿里巴巴',
    current_position: '高级前端工程师',
    current_city: '杭州',
    preferred_locations: ['杭州', '北京', '上海'],
    experience_years: 5,
    education: '本科',
    skills: ['React', 'TypeScript', 'Node.js', 'Webpack', '微前端'],
    salary_expectation: '35-45K',
    salary_min: 35,
    salary_max: 45,
    availability: '1month',
    job_change_frequency: 0.4, // 0.4次/年，约2.5年换一次，较稳定
    resume_text: '5年前端开发经验，精通React和TypeScript，有大型项目架构经验，参与过双11大促项目，熟悉微前端和性能优化。',
    data_source: 'demo',
  },
  {
    name: '李华',
    email: 'lihua@example.com',
    phone: '13900139002',
    current_company: '字节跳动',
    current_position: '后端开发工程师',
    current_city: '杭州',
    preferred_locations: ['杭州', '北京'],
    experience_years: 4,
    education: '本科',
    skills: ['Java', 'Spring Boot', 'MySQL', 'Redis', 'Kafka', '微服务'],
    salary_expectation: '30-40K',
    salary_min: 30,
    salary_max: 40,
    availability: '2weeks',
    job_change_frequency: 0.5, // 0.5次/年，约2年换一次
    resume_text: '4年Java后端开发经验，熟悉Spring Boot和微服务架构，有高并发项目经验，参与过电商核心系统开发。',
    data_source: 'demo',
  },
  {
    name: '王芳',
    email: 'wangfang@example.com',
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
  },
  {
    name: '陈建国',
    email: 'chenjianguo@example.com',
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
  },
  {
    name: '周伟',
    email: 'zhouwei@example.com',
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
  },
  {
    name: '赵强',
    email: 'zhaoqiang@example.com',
    phone: '13600136004',
    current_company: '网易',
    current_position: '测试开发工程师',
    current_city: '杭州',
    preferred_locations: ['杭州', '上海'],
    experience_years: 3,
    education: '本科',
    skills: ['Python', 'Selenium', 'Jenkins', '接口测试', '性能测试', '自动化测试'],
    salary_expectation: '20-30K',
    salary_min: 20,
    salary_max: 30,
    availability: 'immediately',
    job_change_frequency: 1.0, // 1次/年，跳槽较频繁
    resume_text: '3年测试开发经验，精通Python自动化测试，熟悉Jenkins CI/CD流程，有大型项目质量保障经验。',
    data_source: 'demo',
  },
  {
    name: '刘洋',
    email: 'liuyang@example.com',
    phone: '13500135005',
    current_company: '蚂蚁集团',
    current_position: '产品经理',
    current_city: '杭州',
    preferred_locations: ['杭州', '北京', '深圳'],
    experience_years: 4,
    education: '硕士',
    skills: ['B端产品', '需求分析', 'Axure', '数据分析', '用户研究', '项目管理'],
    salary_expectation: '35-50K',
    salary_min: 35,
    salary_max: 50,
    availability: 'negotiable',
    job_change_frequency: 0.33, // 0.33次/年，约3年换一次
    resume_text: '4年B端产品经验，有金融科技产品经验，擅长需求分析和用户研究，有跨部门项目协调经验。',
    data_source: 'demo',
  },
];

// 示例职位数据
const demoJobs = [
  {
    title: '前端架构师',
    department: '技术中心',
    location: '杭州',
    salary_range: '40-60K',
    salary_min: 40,
    salary_max: 60,
    experience_required: '5年以上前端开发经验',
    education_required: '本科及以上学历，计算机相关专业',
    skills_required: ['React', 'TypeScript', '架构设计', '性能优化', '微前端'],
    bonus_skills: ['Node.js', 'WebGL', '低代码平台'],
    responsibilities: [
      '负责公司前端架构设计和优化',
      '制定前端技术规范和最佳实践',
      '带领团队攻克技术难题',
      '参与产品技术方案评审',
    ],
    benefits: ['六险一金', '年终奖', '股票期权', '弹性工作'],
    urgency: 'urgent',
    implicit_requirements: ['需具备大型项目架构经验（隐含：5年以上经验）', '团队管理能力（隐含：架构师通常需带团队）', '抗压能力强可能意味着加班较多'],
    completeness: 80,
    missing_fields: ['团队规模', '汇报对象', '技术栈版本'],
    raw_jd: `【招聘岗位】
职位名称：前端架构师
部门：技术中心
工作地点：杭州
薪资范围：40-60K

【岗位要求】
1. 本科及以上学历，计算机相关专业
2. 5年以上前端开发经验
3. 精通React、TypeScript，有架构设计经验
4. 良好的沟通能力和团队协作精神

【岗位职责】
1. 负责公司前端架构设计和优化
2. 制定前端技术规范和最佳实践
3. 带领团队攻克技术难题
4. 参与产品技术方案评审

【福利待遇】
- 六险一金
- 年终奖
- 股票期权
- 弹性工作`,
    status: 'active',
  },
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
  {
    title: 'Java后端开发',
    department: '研发中心',
    location: '杭州',
    salary_range: '25-40K',
    salary_min: 25,
    salary_max: 40,
    experience_required: '3年以上Java开发经验',
    education_required: '本科及以上学历',
    skills_required: ['Java', 'Spring Boot', 'MySQL', 'Redis'],
    bonus_skills: ['Kafka', '微服务', 'Docker'],
    responsibilities: [
      '负责核心业务系统开发',
      '参与系统架构设计',
      '优化系统性能和稳定性',
    ],
    benefits: ['五险一金', '年终奖', '弹性工作'],
    urgency: 'normal',
    implicit_requirements: ['分布式系统经验是加分项（隐含：项目可能涉及高并发）', '有电商经验更优'],
    completeness: 70,
    missing_fields: ['技术栈版本', '团队规模', '项目背景'],
    raw_jd: `【招聘岗位】
职位名称：Java后端开发
部门：研发中心
工作地点：杭州
薪资范围：25-40K

【岗位要求】
1. 本科及以上学历
2. 3年以上Java开发经验
3. 熟悉Spring Boot、MySQL、Redis
4. 有分布式系统经验优先

【岗位职责】
1. 负责核心业务系统开发
2. 参与系统架构设计
3. 优化系统性能和稳定性

【福利待遇】
- 五险一金
- 年终奖
- 弹性工作`,
    status: 'active',
  },
];

async function seedDemoData() {
  console.log('开始植入Demo数据...\n');

  const { data: memberships, error: membershipError } = await supabase
    .from('organization_members')
    .select('organization_id, user_id')
    .eq('role', 'admin')
    .eq('is_active', true)
    .limit(1);
  const organizationId = memberships?.[0]?.organization_id;
  const collectorUserId = memberships?.[0]?.user_id;
  if (membershipError || !organizationId || !collectorUserId) {
    throw new Error('未找到可用组织管理员，请先执行 pnpm admin:bootstrap');
  }

  // 1. 插入候选人数据 + 授权记录
  console.log('\n1. 插入候选人数据...');
  let candidatesInserted = 0;
  for (const raw of demoCandidates) {
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
      console.log(`  ⏩ ${raw.name} 已存在，跳过`);
      continue;
    }

    const encryptedCandidate = {
      ...raw,
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
          controller_name: '人才决策Agent演示组织',
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

  // 2. 插入职位数据
  console.log('\n2. 插入职位数据...');
  let jobsInserted = 0;
  for (const job of demoJobs) {
    const { error } = await supabase
      .from('job_requirements')
      .insert({
        ...job,
        organization_id: organizationId,
        activated_at: new Date().toISOString(),
      });

    if (!error) {
      jobsInserted++;
      console.log(`  ✅ ${job.title} - ${job.department} (${job.urgency === 'urgent' ? '紧急' : '常规'})`);
    } else if (error.code === '23505') {
      console.log(`  ⚠️ ${job.title} 已存在，跳过`);
    } else {
      console.log(`  ❌ ${job.title}: ${error.message}`);
    }
  }
  console.log(`共插入 ${jobsInserted} 个职位`);

  // 3. 统计结果
  console.log('\n========================================');
  console.log('Demo数据植入完成！');
  console.log('========================================');
  console.log(`候选人: ${candidatesInserted} 位`);
  console.log(`职 位: ${jobsInserted} 个`);
  console.log('========================================');
}

// 运行种子脚本
seedDemoData()
  .then(() => {
    console.log('\n种子脚本执行完成');
    process.exit(0);
  })
  .catch((error) => {
    console.error('种子脚本执行失败:', error);
    process.exit(1);
  });
