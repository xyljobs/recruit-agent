import type { SupabaseClient } from '@supabase/supabase-js';

export const RESUME_BATCH_BUCKET = 'resume-batch-files';
export const RESUME_BATCH_MAX_FILES = 50;
export const RESUME_BATCH_MAX_FILE_SIZE = 30 * 1024 * 1024;
export const DEFAULT_RESUME_STYLE_SAMPLE = `【基本信息】男，27岁，太原师范学院书法本科，8年全域市场运营经验，手握全国高校独家渠道资源，意向杭州高校资源运营管理/校园用户增长岗
【经验&匹配】深耕全国高校+城市社区双渠道运营，完整承接APP 0-1冷启动、校园线下活动落地、KOC孵化、公私域裂变、品牌投放、数据复盘全链路工作，适配高校渠道拓展、校园资源维护、校园用户增长运营岗位。
【亮点】自有核心资源储备：覆盖全国100+高校、500+学生会/社团/KOC、社区团长、同城万人社群与校园新媒体矩阵；历任市场总监、高校渠道负责人，搭建标准化校园活动SOP，批量落地校园宣讲、开学季大型线下活动；擅长学生、上班族分层运营，定制差异化拉新、激活、留存裂变方案，搭建私域流量闭环；操盘滴滴、知乎、欧莱雅、香飘飘等品牌校园推广，单日完成5000+学生转化，2个月新增4万理工类精准高校用户；全程跟踪下载、注册、留存转化数据，迭代低成本获客玩法优化渠道成本，具备商务谈判、线下团队统筹、全域流量宣发、渠道资源整合全流程实操能力。`;

export interface ResumeBatchFileRecord {
  name: string;
  storage_path: string;
  size: number;
}

export function normalizePdfName(name: string): string {
  return name
    .replace(/^.*[\\/]/, '')
    .normalize('NFKC')
    .trim();
}

export function validateResumeSheetTarget(value: string): string {
  const target = value.trim();
  if (!target) {
    throw new Error('请填写钉钉表格链接');
  }
  if (/^https:\/\//i.test(target) || /^[A-Za-z0-9_-]{8,}$/.test(target)) {
    return target;
  }
  throw new Error('钉钉表格链接或 nodeId 格式不正确');
}

export function resumeSheetLabel(target: string): string {
  try {
    return `钉钉表格 · ${new URL(target).hostname}`;
  } catch {
    return '钉钉表格';
  }
}

export async function ensureResumeBatchBucket(supabase: SupabaseClient): Promise<void> {
  const { data, error } = await supabase.storage.getBucket(RESUME_BATCH_BUCKET);
  if (data && !error) {
    return;
  }

  const { error: createError } = await supabase.storage.createBucket(RESUME_BATCH_BUCKET, {
    public: false,
    fileSizeLimit: RESUME_BATCH_MAX_FILE_SIZE,
    allowedMimeTypes: ['application/pdf'],
  });

  if (createError && !/already exists|duplicate/i.test(createError.message)) {
    throw new Error(`无法创建简历私有存储桶: ${createError.message}`);
  }
}

export function credentialEndpointHost(encryptedUrl: string): string {
  try {
    const value = new URL(encryptedUrl);
    return value.hostname;
  } catch {
    return '已配置';
  }
}
