import { realpath, stat } from 'node:fs/promises';
import { basename, extname, join, resolve, sep } from 'node:path';
import { NextRequest } from 'next/server';
import {
  getTenantRequestContext,
  type TenantRequestContext,
} from '@/lib/auth-server';

export interface BossCandidateManifest {
  index?: number;
  global_index?: number;
  expect_id?: string;
  geek_url?: string;
  name?: string;
  company_title?: string;
  keyword?: string;
  keyword_dir?: string;
  dir?: string;
  shots?: number;
  screenshot_count?: number;
  resume_text_file?: string;
  resume_text_chars?: number;
  resume_source_file?: string;
  status?: string;
  summary?: unknown;
}

export interface BossSearchTaskRecord {
  id: string;
  organization_id: string;
  user_id: string | null;
  status: string;
  task_dir: string | null;
  jd_content: string;
  expected_count: number | null;
  total_candidates: number | null;
  invalid_count: number | null;
  report_status: string | null;
  error_message: string | null;
  result_summary: unknown;
  manifest: unknown;
  created_at: string;
  finished_at: string | null;
}

export class BossTaskFileError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export interface BossRequestIdentity {
  userId: string;
  organizationId: string;
  role: string;
}

export interface BossRequestContext extends BossRequestIdentity {
  supabase: TenantRequestContext['supabase'];
}

export async function getBossRequestContext(
  request: NextRequest,
): Promise<BossRequestContext> {
  try {
    const { supabase, user } = await getTenantRequestContext(request);
    return {
      supabase,
      userId: user.userId,
      organizationId: user.organizationId,
      role: user.role,
    };
  } catch {
    throw new BossTaskFileError('登录已过期，请重新登录', 401);
  }
}

export async function getBossRequestIdentity(
  request: NextRequest,
): Promise<BossRequestIdentity> {
  const { userId, organizationId, role } = await getBossRequestContext(request);
  return { userId, organizationId, role };
}

export function assertBossTaskAccess(
  identity: BossRequestIdentity,
  taskUserId: string | null,
): void {
  if (identity.role !== 'admin' && taskUserId !== identity.userId) {
    throw new BossTaskFileError('无权访问该任务', 403);
  }
}

export async function getBossTaskForFileAccess(
  request: NextRequest,
  taskId: string,
  providedContext?: BossRequestContext,
): Promise<BossSearchTaskRecord> {
  const context = providedContext ?? await getBossRequestContext(request);

  const { data: task, error } = await context.supabase
    .from('boss_search_tasks')
    .select('id, organization_id, user_id, status, task_dir, jd_content, expected_count, total_candidates, invalid_count, report_status, error_message, result_summary, manifest, created_at, finished_at')
    .eq('id', taskId)
    .eq('organization_id', context.organizationId)
    .single();

  if (error || !task) {
    throw new BossTaskFileError('任务不存在', 404);
  }
  assertBossTaskAccess(context, task.user_id);
  if (task.status !== 'done' || !task.task_dir) {
    throw new BossTaskFileError('任务尚未完成，文件暂不可用', 409);
  }

  return task as BossSearchTaskRecord;
}

export function getManifestCandidates(manifest: unknown): BossCandidateManifest[] {
  if (!manifest || typeof manifest !== 'object') return [];
  const candidates = 'candidates' in manifest
    ? (manifest as { candidates?: unknown }).candidates
    : manifest;
  return Array.isArray(candidates)
    ? candidates.filter((candidate): candidate is BossCandidateManifest => (
      Boolean(candidate) && typeof candidate === 'object'
    ))
    : [];
}

export function getCandidateScreenshotSegments(candidate: BossCandidateManifest): string[][] {
  const count = candidate.screenshot_count ?? candidate.shots ?? 0;
  if (
    !Number.isInteger(count)
    || count < 1
    || count > 50
    || typeof candidate.keyword_dir !== 'string'
    || typeof candidate.dir !== 'string'
  ) {
    return [];
  }

  return Array.from({ length: count }, (_, index) => [
    candidate.keyword_dir as string,
    candidate.dir as string,
    `${index + 1}.png`,
  ]);
}

export function getCandidateResumeTextSegments(candidate: BossCandidateManifest): string[] | null {
  if (
    candidate.resume_text_file !== 'resume.txt'
    || typeof candidate.keyword_dir !== 'string'
    || typeof candidate.dir !== 'string'
  ) {
    return null;
  }
  return [candidate.keyword_dir, candidate.dir, candidate.resume_text_file];
}

export function getManifestCandidate(
  manifest: unknown,
  candidateIndex: number,
): BossCandidateManifest | null {
  if (!Number.isInteger(candidateIndex) || candidateIndex < 1) return null;
  return getManifestCandidates(manifest).find((candidate, position) => (
    (candidate.global_index ?? position + 1) === candidateIndex
  )) ?? null;
}

export async function resolveBossTaskFile(
  taskDir: string,
  pathSegments: string[],
): Promise<string> {
  if (!taskDir || basename(taskDir) !== taskDir) {
    throw new BossTaskFileError('任务目录无效', 400);
  }
  if (
    pathSegments.length === 0
    || pathSegments.some(segment => (
      !segment
      || segment === '.'
      || segment === '..'
      || segment.includes('/')
      || segment.includes('\\')
    ))
  ) {
    throw new BossTaskFileError('文件路径无效', 400);
  }

  try {
    const rootCandidates = process.env.BOSS_RESUME_DIR
      ? [resolve(process.env.BOSS_RESUME_DIR)]
      : [
        resolve(process.cwd(), 'assets', '简历'),
        resolve(process.cwd(), '..', '..', 'assets', '简历'),
      ];
    let resumeRoot: string | null = null;
    for (const candidateRoot of rootCandidates) {
      try {
        resumeRoot = await realpath(candidateRoot);
        break;
      } catch {
        // Next.js standalone 运行目录是 .next/standalone，继续尝试项目根目录。
      }
    }
    if (!resumeRoot) {
      throw new BossTaskFileError('简历根目录不存在', 404);
    }
    const taskRoot = await realpath(join(resumeRoot, taskDir));
    if (!taskRoot.startsWith(`${resumeRoot}${sep}`)) {
      throw new BossTaskFileError('任务目录无效', 400);
    }

    const filePath = await realpath(join(taskRoot, ...pathSegments));
    if (!filePath.startsWith(`${taskRoot}${sep}`)) {
      throw new BossTaskFileError('文件路径无效', 400);
    }
    const fileStat = await stat(filePath);
    if (!fileStat.isFile()) {
      throw new BossTaskFileError('文件不存在', 404);
    }
    return filePath;
  } catch (error) {
    if (error instanceof BossTaskFileError) throw error;
    throw new BossTaskFileError('文件不存在', 404);
  }
}

export function getImageContentType(filePath: string): string | null {
  switch (extname(filePath).toLowerCase()) {
    case '.png':
      return 'image/png';
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.webp':
      return 'image/webp';
    case '.gif':
      return 'image/gif';
    default:
      return null;
  }
}

export function getContentDisposition(type: 'inline' | 'attachment', filename: string): string {
  const asciiFilename = filename.replace(/[^\x20-\x7E]/g, '_').replace(/["\\]/g, '_');
  return `${type}; filename="${asciiFilename}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}
