'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  AlertCircle,
  Award,
  ChevronDown,
  ClipboardList,
  Copy,
  FileText,
  History,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Sparkles,
  Target,
  Trash2,
  Zap,
} from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { authFetch } from '@/lib/auth-client';
import { formatExperienceBand } from '@/lib/matching/screening-rubric';
import { getScoreBg, getScoreColor, getScoreLabel } from '../constants';
import { useWorkspaceData } from '../hooks/use-workspace-data';
import { JobFormDialog } from './job-form-dialog';
import type { Job } from '../types';

const BATCH_POLL_INTERVAL_MS = 2_000;
const BATCH_POLL_MAX_ATTEMPTS = 60;

interface BatchMatchItem {
  candidate_id: string;
  overall_score: number;
  rank?: number;
  recommendation_band?: 'strong' | 'consider' | 'insufficient_information';
}

interface BatchMatchResult {
  matches?: BatchMatchItem[];
  top_candidates?: BatchMatchItem[];
}

interface TalentPoolCandidate {
  candidate_id: string;
  name: string;
  best_score: number;
  matched_skills: string[];
  last_matched_at: string;
}

interface TalentPoolData {
  job_title: string;
  candidates: TalentPoolCandidate[];
}

interface JobPostingRecord {
  id: string;
  platform: string;
  url: string | null;
  note: string | null;
  posted_at: string;
}

const POSTING_PLATFORMS = ['Boss直聘', '智联', '58', '猎聘', 'LinkedIn', '内推', '其他'];

const BAND_LABELS: Record<NonNullable<BatchMatchItem['recommendation_band']>, string> = {
  strong: '优先推荐',
  consider: '可考虑',
  insufficient_information: '信息不足',
};

/** 将原始解析技能提炼为招聘平台可用的简洁搜索关键词：拆分复合词、去除描述性修饰、去重过滤 */
function refineKeywords(rawKeywords: readonly string[]): string[] {
  const seen = new Set<string>();
  const refined: string[] = [];
  for (const raw of rawKeywords) {
    for (const part of String(raw).split(/[、，,;；/]+/)) {
      const text = part
        .trim()
        .replace(/^(熟悉|精通|掌握|了解|熟练|具备|具有|有)/, '')
        .replace(/^\d+\s*年以上/, '')
        .replace(/(经验|能力|背景|者优先|优先|相关|基础)$/, '')
        .trim();
      if (text.length < 2 || text.length > 12) continue;
      const key = text.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      refined.push(text);
    }
  }
  return refined;
}

async function waitForBatchMatch(taskId: string): Promise<BatchMatchResult> {
  for (let attempt = 0; attempt < BATCH_POLL_MAX_ATTEMPTS; attempt += 1) {
    await new Promise<void>(resolve => {
      window.setTimeout(resolve, BATCH_POLL_INTERVAL_MS);
    });

    const response = await authFetch(
      `/api/match/batch?taskId=${encodeURIComponent(taskId)}`,
    );
    const result = await response.json();
    if (!response.ok || !result.success) {
      throw new Error(result.error || '查询批量匹配任务失败');
    }
    if (result.data?.status === 'done' && result.data.result) {
      return result.data.result;
    }
    if (result.data?.status === 'error') {
      throw new Error(result.data.errorMessage || '批量匹配任务失败');
    }
  }

  throw new Error('批量匹配处理超时，请稍后在匹配记录中查看结果');
}

export function JobWorkspace() {
  const router = useRouter();
  const {
    jobs,
    candidates,
    reloadDashboard,
    reloadJobs,
    reloadMatchRecords,
  } = useWorkspaceData();
  const [jdContent, setJdContent] = useState('');
  const [parsedJob, setParsedJob] = useState<Job | null>(null);
  const parsedBand = parsedJob?.screening_rubric?.experience_band ?? null;
  const parsedBandLabel = formatExperienceBand(parsedBand);
  const [jdLoading, setJdLoading] = useState(false);
  const [jobSearch, setJobSearch] = useState('');
  const [generatingJobId, setGeneratingJobId] = useState<string | null>(null);
  const [editingJobId, setEditingJobId] = useState<string | null>(null);
  const [savingJd, setSavingJd] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [formJob, setFormJob] = useState<Job | null>(null);
  const [deletingJob, setDeletingJob] = useState<Job | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [aiEnabled, setAiEnabled] = useState<boolean | null>(null);
  const [autoMatchSummary, setAutoMatchSummary] = useState<{
    jobId: string;
    jobTitle: string;
    matches: BatchMatchItem[];
  } | null>(null);
  const [matching, setMatching] = useState(false);
  const [showParseDetails, setShowParseDetails] = useState(false);
  const [publishDescription, setPublishDescription] = useState('');
  const [generatingDescription, setGeneratingDescription] = useState(false);
  const [talentPool, setTalentPool] = useState<TalentPoolData | null>(null);
  const [talentPoolLoading, setTalentPoolLoading] = useState(false);
  const [talentPoolExpanded, setTalentPoolExpanded] = useState(false);
  const [creatingOutreachId, setCreatingOutreachId] = useState<string | null>(null);
  const [jobPostings, setJobPostings] = useState<JobPostingRecord[]>([]);
  const [postingsLoading, setPostingsLoading] = useState(false);
  const [postingFormOpen, setPostingFormOpen] = useState(false);
  const [postingPlatform, setPostingPlatform] = useState('');
  const [postingUrl, setPostingUrl] = useState('');
  const [postingNote, setPostingNote] = useState('');
  const [submittingPosting, setSubmittingPosting] = useState(false);
  const jdCardRef = useRef<HTMLDivElement | null>(null);

  const editingJob = useMemo(
    () => jobs.find((job) => job.id === editingJobId) ?? null,
    [jobs, editingJobId],
  );

  // 解析的核心交付物：岗位关键词，供 HR 复制到招聘平台搜索
  // 优先用 AI 提炼的 search_keywords（含职位别名/同义词）；不足时回退到本地清洗必需+加分技能
  const parsedKeywords = useMemo(() => {
    if (!parsedJob) return [] as string[];
    const fromAi = refineKeywords(parsedJob.search_keywords ?? []);
    if (fromAi.length >= 3) return fromAi.slice(0, 10);
    return refineKeywords([
      ...(parsedJob.skills_required ?? []),
      ...(parsedJob.bonus_skills ?? []),
    ]).slice(0, 10);
  }, [parsedJob]);

  // 人才池再激活：解析结果就绪后拉取历史高分候选人
  useEffect(() => {
    const jobId = parsedJob?.id;
    if (!jobId) {
      setTalentPool(null);
      setTalentPoolExpanded(false);
      return;
    }
    let active = true;
    setTalentPoolLoading(true);
    void authFetch(`/api/talent-pool?jobId=${jobId}`)
      .then(response => response.json())
      .then((result: { success?: boolean; data?: TalentPoolData }) => {
        if (!active) return;
        if (result.success && result.data) setTalentPool(result.data);
        else setTalentPool(null);
      })
      .catch(() => {
        if (active) setTalentPool(null);
      })
      .finally(() => {
        if (active) setTalentPoolLoading(false);
      });
    return () => { active = false; };
  }, [parsedJob?.id]);

  // 发布台账：解析结果就绪后拉取当前职位已登记发布记录
  useEffect(() => {
    const jobId = parsedJob?.id;
    if (!jobId) {
      setJobPostings([]);
      setPostingFormOpen(false);
      return;
    }
    let active = true;
    setPostingsLoading(true);
    void authFetch(`/api/job-postings?jobId=${jobId}`)
      .then(response => response.json())
      .then((result: { success?: boolean; data?: JobPostingRecord[] }) => {
        if (!active) return;
        if (result.success && Array.isArray(result.data)) setJobPostings(result.data);
        else setJobPostings([]);
      })
      .catch(() => {
        if (active) setJobPostings([]);
      })
      .finally(() => {
        if (active) setPostingsLoading(false);
      });
    return () => { active = false; };
  }, [parsedJob?.id]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const response = await authFetch('/api/integrations');
        const result: { success?: boolean; data?: { ai_policy?: { effective_mode?: string } } } = await response.json();
        const mode = result.data?.ai_policy?.effective_mode;
        if (!cancelled && response.ok && result.success && typeof mode === 'string') {
          setAiEnabled(mode !== 'rules_only');
        }
      } catch {
        // 获取失败时保持按钮可用，由解析接口返回具体错误
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const filteredJobs = useMemo(() => {
    if (!jobSearch.trim()) return jobs;
    const search = jobSearch.toLowerCase();
    return jobs.filter(
      (job) =>
        job.title.toLowerCase().includes(search) ||
        job.department?.toLowerCase().includes(search) ||
        job.location?.toLowerCase().includes(search),
    );
  }, [jobSearch, jobs]);

  async function handleParseJD() {
    if (!jdContent.trim()) {
      toast.error('请输入职位描述');
      return;
    }
    const targetJobId = editingJobId;
    setJdLoading(true);
    try {
      const response = await authFetch('/api/jd/parse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jdContent,
          ...(targetJobId ? { jobId: targetJobId } : {}),
        }),
      });
      const result = await response.json();
      if (!result.success) {
        toast.error(result.error || '解析失败');
        return;
      }

      const job: Job = result.data;
      setParsedJob(job);
      setPublishDescription('');
      await reloadJobs();
      if (targetJobId) {
        toast.success('职位描述已更新并完成AI重新解析');
      } else {
        toast.success('JD解析成功！可点击「匹配候选人」开始自动匹配');
      }
    } catch (error) {
      console.error('JD解析失败:', error);
      toast.error('解析失败，请重试');
    } finally {
      setJdLoading(false);
    }
  }

  /** 自动搜索候选人库并执行批量匹配（与解析动作解耦，由「匹配候选人」按钮触发） */
  async function runAutoMatch(job: Job) {
    if (!job.id || !job.skills_required?.length) return;

    try {
      const searchResponse = await authFetch('/api/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jobId: job.id,
          skills: job.skills_required,
          location: job.location,
          limit: 10,
        }),
      });
      const searchResult = await searchResponse.json();
      if (!searchResult.success || !searchResult.data?.candidates?.length) {
        toast.info('未找到匹配的候选人，请先添加候选人', {
          action: {
            label: '去添加',
            onClick: () => router.push('/candidates'),
          },
        });
        return;
      }

      toast.info(
        `找到 ${searchResult.data.candidates.length} 位候选人，正在批量匹配...`,
      );
      const candidateIds = searchResult.data.candidates.map(
        (candidate: { id: string }) => candidate.id,
      );
      const matchResponse = await authFetch('/api/match/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          job_id: job.id,
          candidate_ids: candidateIds,
          client_event_id: crypto.randomUUID(),
        }),
      });
      const matchResult = await matchResponse.json();
      if (!matchResponse.ok || !matchResult.success) {
        throw new Error(matchResult.error || '批量匹配任务提交失败');
      }

      const taskId = matchResult.data?.taskId;
      const batchResult = typeof taskId === 'string'
        ? await waitForBatchMatch(taskId)
        : matchResult.data;
      const topMatches = (
        batchResult?.matches ||
        batchResult?.top_candidates ||
        []
      ).slice(0, 5);
      setAutoMatchSummary({ jobId: job.id, jobTitle: job.title, matches: topMatches });
      toast.success(`匹配完成！Top ${topMatches.length} 候选人已生成`);
      await Promise.all([reloadMatchRecords(), reloadDashboard()]);
    } catch (error) {
      console.error('自动匹配失败:', error);
      toast.error('自动匹配失败，请手动匹配');
    }
  }

  /** 人工触发：基于当前解析出的用人标准，自动搜索候选人库并批量匹配 */
  async function handleMatchCandidates() {
    if (!parsedJob || matching) return;
    setMatching(true);
    toast.info('正在搜索匹配候选人...');
    try {
      await runAutoMatch(parsedJob);
    } finally {
      setMatching(false);
    }
  }

  /** 复制岗位关键词，供 HR 粘贴到招聘平台搜索人才 */
  async function copyKeywords() {
    if (parsedKeywords.length === 0) {
      toast.error('暂无可复制的关键词');
      return;
    }
    try {
      await navigator.clipboard.writeText(parsedKeywords.join(' '));
      toast.success('关键词已复制，可粘贴到招聘平台搜索人才');
    } catch {
      toast.error('复制失败，请手动选择关键词复制');
    }
  }

  /** 反哺：基于解析出的用人标准生成发布版职位描述，供 HR 复制到招聘平台发布 */
  async function generatePublishDescription() {
    if (!parsedJob?.id || generatingDescription) return;
    setGeneratingDescription(true);
    try {
      const response = await authFetch('/api/jd/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobId: parsedJob.id }),
      });
      const result = await response.json();
      if (!response.ok || !result.success) {
        throw new Error(result.error || '生成失败');
      }
      setPublishDescription(String(result.data?.description ?? ''));
      toast.success('发布版职位描述已生成，可复制后到招聘平台发布');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '生成失败，请重试');
    } finally {
      setGeneratingDescription(false);
    }
  }

  async function copyPublishDescription() {
    if (!publishDescription) return;
    try {
      await navigator.clipboard.writeText(publishDescription);
      toast.success('职位描述已复制，可粘贴到招聘平台发布');
    } catch {
      toast.error('复制失败，请手动选择描述复制');
    }
  }

  /** 人才池再激活：为历史高分候选人创建触达待办 */
  async function createOutreachTask(candidate: TalentPoolCandidate) {
    if (!parsedJob?.id) return;
    setCreatingOutreachId(candidate.candidate_id);
    try {
      const response = await authFetch('/api/outreach-tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobId: parsedJob.id, candidateId: candidate.candidate_id }),
      });
      const result: { success?: boolean; data?: { created?: boolean }; error?: string } = await response.json();
      if (!response.ok || !result.success) throw new Error(result.error || '创建触达待办失败');
      toast.success(result.data?.created === false
        ? '该候选人已有未关闭的触达待办'
        : '触达待办已创建，可在沟通与结果页查看');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '创建触达待办失败');
    } finally {
      setCreatingOutreachId(null);
    }
  }

  /** 发布台账：登记一次渠道发布，成功后刷新已登记列表 */
  async function submitPosting() {
    if (!parsedJob?.id) return;
    if (!postingPlatform) {
      toast.error('请选择发布平台');
      return;
    }
    setSubmittingPosting(true);
    try {
      const response = await authFetch('/api/job-postings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jobId: parsedJob.id,
          platform: postingPlatform,
          url: postingUrl.trim() || undefined,
          note: postingNote.trim() || undefined,
        }),
      });
      const result: { success?: boolean; data?: JobPostingRecord; error?: string } = await response.json();
      if (!response.ok || !result.success || !result.data) {
        throw new Error(result.error || '登记发布失败');
      }
      const posting = result.data;
      setJobPostings(prev => [posting, ...prev]);
      setPostingFormOpen(false);
      setPostingPlatform('');
      setPostingUrl('');
      setPostingNote('');
      toast.success('发布已登记');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '登记发布失败');
    } finally {
      setSubmittingPosting(false);
    }
  }

  function openCreateForm() {
    setFormJob(null);
    setFormOpen(true);
  }

  function openEditForm(job: Job) {
    setFormJob(job);
    setFormOpen(true);
  }

  async function confirmDeleteJob() {
    if (!deletingJob) return;
    setDeleting(true);
    try {
      const response = await authFetch(`/api/jobs/${deletingJob.id}`, { method: 'DELETE' });
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.error || '删除失败');
      if (editingJobId === deletingJob.id) setEditingJobId(null);
      setDeletingJob(null);
      await reloadJobs();
      toast.success('职位已删除');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '删除职位失败');
    } finally {
      setDeleting(false);
    }
  }

  function handleSelectJob(job: Job) {
    setEditingJobId(job.id);
    setJdContent(job.raw_jd ?? '');
    setParsedJob(job);
    setPublishDescription('');
    requestAnimationFrame(() => {
      jdCardRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }

  async function saveJdUpdate() {
    if (!editingJobId) return;
    if (!jdContent.trim()) {
      toast.error('请输入职位描述');
      return;
    }
    setSavingJd(true);
    try {
      const response = await authFetch(`/api/jobs/${editingJobId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ raw_jd: jdContent }),
      });
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.error || '更新失败');
      await reloadJobs();
      toast.success('职位描述已更新');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '职位描述更新失败');
    } finally {
      setSavingJd(false);
    }
  }

  async function updateJobLifecycle(jobId: string, action: 'activate' | 'close') {
    try {
      const response = await authFetch('/api/jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, job_id: jobId }),
      });
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.error || '职位状态更新失败');
      await reloadJobs();
      toast.success(action === 'activate' ? '职位已启用' : '职位已关闭');
    } catch (error) {
      await reloadJobs();
      toast.error(error instanceof Error ? error.message : '职位状态更新失败');
    }
  }

  async function generateShortlist(jobId: string) {
    setGeneratingJobId(jobId);
    try {
      const response = await authFetch('/api/shortlists', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ job_id: jobId, top_n: 10, client_event_id: crypto.randomUUID() }),
      });
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.error || '短名单任务提交失败');
      toast.success('短名单任务已提交');
      router.push('/shortlists');
    } catch (error) {
      await reloadJobs();
      toast.error(error instanceof Error ? error.message : '短名单任务提交失败');
    } finally {
      setGeneratingJobId(null);
    }
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-6 lg:grid-cols-2">
        <div ref={jdCardRef} className="scroll-mt-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FileText className="h-5 w-5 text-blue-600" />
              AI 辅助解析职位描述（可选）
            </CardTitle>
            <CardDescription>
              粘贴职位描述，AI 自动提取职位、薪资、技能等要求并生成需求卡片；确认解析结果后点击「匹配候选人」自动搜索并批量匹配。不使用 AI 时，可在下方「新增职位」手动录入
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {aiEnabled === false && (
              <Alert className="border-amber-300 bg-amber-50">
                <AlertCircle className="h-4 w-4 text-amber-700" />
                <AlertTitle>AI 解析暂未启用</AlertTitle>
                <AlertDescription>
                  当前企业尚未开通 AI 服务，如需使用请联系管理员在「数据源」页面启用；您也可以在下方「新增职位」中手动填写职位信息。
                </AlertDescription>
              </Alert>
            )}
            {editingJob && (
              <div className="flex items-center justify-between gap-2 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2">
                <p className="text-sm text-blue-700">
                  正在编辑职位：<span className="font-semibold">{editingJob.title}</span>
                </p>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 shrink-0 text-blue-700"
                  onClick={() => setEditingJobId(null)}
                >
                  取消
                </Button>
              </div>
            )}
            <Textarea
              placeholder={`请粘贴职位描述(JD)内容...

示例：
【招聘岗位】
职位名称：前端架构师
部门：技术中心
工作地点：北京
薪资范围：40-60K

【岗位要求】
1. 本科及以上学历
2. 5年以上前端开发经验
3. 精通React、TypeScript...`}
              className="min-h-[300px] resize-none"
              value={jdContent}
              onChange={(event) => setJdContent(event.target.value)}
            />
            <div className="flex flex-col gap-2 sm:flex-row">
              <Button
                className="flex-1 bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-700 hover:to-blue-800"
                onClick={handleParseJD}
                disabled={jdLoading || !jdContent.trim() || aiEnabled === false}
              >
                {jdLoading ? (
                  <>
                    <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                    AI正在解析...
                  </>
                ) : (
                  <>
                    <Sparkles className="h-4 w-4 mr-2" />
                    {editingJobId ? 'AI重新解析并更新' : 'AI智能解析'}
                  </>
                )}
              </Button>
              {editingJobId && (
                <Button
                  variant="outline"
                  className="sm:w-36"
                  onClick={() => void saveJdUpdate()}
                  disabled={savingJd || !jdContent.trim()}
                >
                  {savingJd ? '保存中…' : '保存描述'}
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
        </div>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle>解析结果</CardTitle>
              <CardDescription>AI 提取的职位信息将显示在这里，作为匹配候选人的用人标准</CardDescription>
            </div>
            <Button
              size="sm"
              className="shrink-0"
              disabled={!parsedJob || matching}
              onClick={() => void handleMatchCandidates()}
            >
              {matching ? (
                <>
                  <RefreshCw className="mr-1 h-4 w-4 animate-spin" />
                  匹配中...
                </>
              ) : (
                <>
                  <Target className="mr-1 h-4 w-4" />
                  匹配候选人
                </>
              )}
            </Button>
          </CardHeader>
          <CardContent>
            {parsedJob ? (
              <div className="space-y-4">
                <div className="p-4 bg-gradient-to-r from-blue-50 to-purple-50 rounded-xl border border-blue-200">
                  <h3 className="text-lg font-bold text-blue-900">
                    {parsedJob.title}
                  </h3>
                  {parsedJob.department && (
                    <p className="text-sm text-blue-700 mt-1">
                      {parsedJob.department}
                    </p>
                  )}
                </div>

                <div className="rounded-xl border border-blue-200 bg-blue-50/60 p-4">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-medium text-blue-900">
                      岗位关键词 · 可复制后到招聘平台搜索人才
                    </p>
                    <Button
                      size="sm"
                      variant="outline"
                      className="shrink-0"
                      onClick={() => void copyKeywords()}
                    >
                      <Copy className="mr-1 h-4 w-4" />
                      复制关键词
                    </Button>
                  </div>
                  {parsedKeywords.length > 0 ? (
                    <div className="mt-2 flex flex-wrap gap-2">
                      {parsedKeywords.map((keyword) => (
                        <Badge
                          key={keyword}
                          variant="secondary"
                          className="border-blue-200 bg-white text-blue-700"
                        >
                          {keyword}
                        </Badge>
                      ))}
                    </div>
                  ) : (
                    <p className="mt-2 text-xs text-blue-700">
                      未解析到技能关键词，可完善职位描述后重新解析
                    </p>
                  )}
                </div>

                <div className="rounded-xl border border-purple-200 bg-purple-50/60 p-4">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-medium text-purple-900">
                      发布版职位描述 · 生成后复制到招聘平台发布
                    </p>
                    <div className="flex shrink-0 items-center gap-2">
                      {publishDescription && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => void copyPublishDescription()}
                        >
                          <Copy className="mr-1 h-4 w-4" />
                          复制描述
                        </Button>
                      )}
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={!parsedJob}
                        onClick={() => setPostingFormOpen(value => !value)}
                      >
                        <ClipboardList className="mr-1 h-4 w-4" />
                        {postingFormOpen ? '收起登记' : '登记发布'}
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={!parsedJob || generatingDescription}
                        onClick={() => void generatePublishDescription()}
                      >
                        {generatingDescription ? (
                          <>
                            <RefreshCw className="mr-1 h-4 w-4 animate-spin" />
                            生成中...
                          </>
                        ) : (
                          <>
                            <Sparkles className="mr-1 h-4 w-4" />
                            生成发布版描述
                          </>
                        )}
                      </Button>
                    </div>
                  </div>
                  {publishDescription ? (
                    <Textarea
                      readOnly
                      value={publishDescription}
                      className="mt-2 min-h-[220px] resize-y bg-white text-sm leading-6"
                    />
                  ) : (
                    <p className="mt-2 text-xs text-purple-700">
                      基于解析出的用人标准，一键生成结构完整、措辞有吸引力的职位描述；AI 未启用时使用内置模板
                    </p>
                  )}
                  {postingFormOpen && (
                    <div className="mt-3 rounded-lg border border-purple-200 bg-white p-3">
                      <div className="grid gap-3 sm:grid-cols-[150px_1fr]">
                        <div className="space-y-2">
                          <Label htmlFor="posting-platform">发布平台</Label>
                          <Select value={postingPlatform} onValueChange={setPostingPlatform}>
                            <SelectTrigger id="posting-platform" className="w-full">
                              <SelectValue placeholder="选择平台" />
                            </SelectTrigger>
                            <SelectContent>
                              {POSTING_PLATFORMS.map(platform => (
                                <SelectItem key={platform} value={platform}>{platform}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="posting-url">链接（可选）</Label>
                          <Input
                            id="posting-url"
                            value={postingUrl}
                            onChange={event => setPostingUrl(event.target.value)}
                            placeholder="https://"
                            maxLength={1000}
                          />
                        </div>
                      </div>
                      <div className="mt-3 space-y-2">
                        <Label htmlFor="posting-note">备注（可选）</Label>
                        <Input
                          id="posting-note"
                          value={postingNote}
                          onChange={event => setPostingNote(event.target.value)}
                          placeholder="例如：发布时使用的标题、渠道联系人等"
                          maxLength={500}
                        />
                      </div>
                      <div className="mt-3 flex items-center justify-end gap-2">
                        <Button size="sm" variant="ghost" onClick={() => setPostingFormOpen(false)}>
                          取消
                        </Button>
                        <Button size="sm" disabled={submittingPosting} onClick={() => void submitPosting()}>
                          {submittingPosting ? '登记中…' : '确认登记'}
                        </Button>
                      </div>
                    </div>
                  )}
                </div>

                {jobPostings.length > 0 && (
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-xs font-medium text-slate-500">已登记发布：</p>
                    {jobPostings.map(posting => (
                      <div
                        key={posting.id}
                        className="flex items-center gap-1.5 rounded-full border border-purple-200 bg-purple-50 px-2.5 py-1 text-xs text-purple-800"
                      >
                        <span className="font-medium">{posting.platform}</span>
                        <span className="text-purple-400">·</span>
                        <span>{new Date(posting.posted_at).toLocaleDateString('zh-CN')}</span>
                        {posting.note && (
                          <span
                            className="max-w-[120px] truncate text-purple-500"
                            title={posting.note}
                          >
                            · {posting.note}
                          </span>
                        )}
                        {posting.url && (
                          <a
                            href={posting.url}
                            target="_blank"
                            rel="noreferrer"
                            className="text-blue-600 underline"
                            title={posting.url}
                          >
                            链接
                          </a>
                        )}
                      </div>
                    ))}
                    {postingsLoading && <span className="text-xs text-purple-500">刷新中…</span>}
                  </div>
                )}

                {talentPool && (
                  <div className="rounded-xl border border-emerald-200 bg-emerald-50/60 p-4">
                    <div className="flex items-center justify-between gap-2">
                      <p className="flex items-center gap-1.5 text-sm font-medium text-emerald-900">
                        <History className="h-4 w-4 shrink-0 text-emerald-700" />
                        人才池再激活 · {talentPool.candidates.length} 位历史高分候选人命中当前关键词
                      </p>
                      {talentPool.candidates.length > 0 && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="shrink-0"
                          onClick={() => setTalentPoolExpanded(value => !value)}
                        >
                          {talentPoolExpanded ? '收起' : '展开列表'}
                        </Button>
                      )}
                    </div>
                    {talentPoolLoading && <p className="mt-2 text-xs text-emerald-700">加载中…</p>}
                    {!talentPoolLoading && talentPool.candidates.length === 0 && (
                      <p className="mt-2 text-xs text-emerald-700">暂无命中当前技能要求的历史高分候选人</p>
                    )}
                    {talentPoolExpanded && (
                      <div className="mt-3 divide-y divide-emerald-100">
                        {talentPool.candidates.map(candidate => (
                          <div key={candidate.candidate_id} className="flex flex-col gap-2 py-2 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between">
                            <div className="min-w-0">
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="text-sm font-medium text-slate-900">{candidate.name}</span>
                                <Badge className={`${getScoreBg(candidate.best_score)} ${getScoreColor(candidate.best_score)}`}>
                                  {candidate.best_score}分
                                </Badge>
                              </div>
                              <div className="mt-1 flex flex-wrap items-center gap-1 text-xs text-slate-500">
                                <span>命中技能：</span>
                                {candidate.matched_skills.map(skill => (
                                  <Badge key={skill} variant="secondary" className="text-xs">{skill}</Badge>
                                ))}
                                {candidate.last_matched_at && (
                                  <span className="ml-1">最近匹配：{new Date(candidate.last_matched_at).toLocaleDateString('zh-CN')}</span>
                                )}
                              </div>
                            </div>
                            <div className="flex shrink-0 items-center gap-2">
                              <Button
                                size="sm"
                                disabled={creatingOutreachId === candidate.candidate_id}
                                onClick={() => void createOutreachTask(candidate)}
                              >
                                {creatingOutreachId === candidate.candidate_id ? '创建中…' : '创建触达待办'}
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => router.push(`/matching?jobId=${parsedJob.id}&candidateId=${candidate.candidate_id}`)}
                              >
                                深度匹配
                              </Button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                <Button
                  variant="ghost"
                  size="sm"
                  className="-ml-2 text-gray-500"
                  onClick={() => setShowParseDetails((value) => !value)}
                >
                  <ChevronDown
                    className={`mr-1 h-4 w-4 transition-transform ${
                      showParseDetails ? 'rotate-180' : ''
                    }`}
                  />
                  {showParseDetails ? '收起解析明细' : '展开解析明细（匹配依据）'}
                </Button>
                {showParseDetails && (
                  <div className="space-y-4">
                    <div className="grid grid-cols-2 gap-4">
                      {parsedJob.location && (
                        <div className="p-3 bg-gray-50 rounded-lg">
                          <p className="text-xs text-gray-500 mb-1">工作地点</p>
                          <p className="font-medium">{parsedJob.location}</p>
                        </div>
                      )}
                      {parsedJob.salary_range && (
                        <div className="p-3 bg-emerald-50 rounded-lg">
                          <p className="text-xs text-gray-500 mb-1">薪资范围</p>
                          <p className="font-medium text-emerald-600">
                            {parsedJob.salary_range}
                          </p>
                        </div>
                      )}
                      {parsedJob.experience_required && (
                        <div className="p-3 bg-gray-50 rounded-lg">
                          <p className="text-xs text-gray-500 mb-1">经验要求</p>
                          <p className="font-medium">
                            {parsedJob.experience_required}
                          </p>
                          {parsedBand && (
                            <div className="mt-2 flex flex-wrap items-center gap-1.5">
                              <Badge variant="outline" className="bg-white">
                                {parsedBandLabel}
                              </Badge>
                              <Badge
                                variant="outline"
                                className={
                                  parsedBand.source === 'explicit'
                                    ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                                    : 'bg-amber-50 text-amber-700 border-amber-200'
                                }
                              >
                                {parsedBand.source === 'explicit' ? 'JD 明确' : 'AI 推断'}
                              </Badge>
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-6 px-1.5 text-xs text-blue-600"
                                onClick={() => openEditForm(parsedJob)}
                              >
                                <Pencil className="mr-1 h-3 w-3" />
                                编辑年限区间
                              </Button>
                            </div>
                          )}
                        </div>
                      )}
                      {parsedJob.education_required && (
                        <div className="p-3 bg-gray-50 rounded-lg">
                          <p className="text-xs text-gray-500 mb-1">学历要求</p>
                          <p className="font-medium">
                            {parsedJob.education_required}
                          </p>
                        </div>
                      )}
                    </div>

                    {parsedJob.responsibilities &&
                      parsedJob.responsibilities.length > 0 && (
                        <div>
                          <p className="text-sm text-gray-500 mb-2">岗位职责</p>
                          <ul className="list-disc list-inside space-y-1 text-sm">
                            {parsedJob.responsibilities.map((responsibility) => (
                              <li key={responsibility} className="text-gray-700">
                                {responsibility}
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}

                    {parsedJob.benefits && parsedJob.benefits.length > 0 && (
                      <div>
                        <p className="text-sm text-gray-500 mb-2">福利待遇</p>
                        <div className="flex flex-wrap gap-2">
                          {parsedJob.benefits.map((benefit) => (
                            <Badge
                              key={benefit}
                              variant="outline"
                              className="bg-emerald-50 text-emerald-700 border-emerald-200"
                            >
                              {benefit}
                            </Badge>
                          ))}
                        </div>
                      </div>
                    )}

                    {parsedJob.implicit_requirements &&
                      parsedJob.implicit_requirements.length > 0 && (
                        <div>
                          <p className="text-sm text-gray-500 mb-2 flex items-center gap-1">
                            <Zap className="h-3.5 w-3.5" /> 隐含需求
                          </p>
                          <ul className="list-disc list-inside space-y-1 text-sm text-amber-700">
                            {parsedJob.implicit_requirements.map((requirement) => (
                              <li key={requirement}>{requirement}</li>
                            ))}
                          </ul>
                        </div>
                      )}

                    {parsedJob.completeness != null && (
                      <div>
                        <p className="text-sm text-gray-500 mb-2">JD完整度</p>
                        <div className="flex items-center gap-3">
                          <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden">
                            <div
                              className={`h-full rounded-full ${
                                parsedJob.completeness >= 80
                                  ? 'bg-emerald-500'
                                  : parsedJob.completeness >= 60
                                    ? 'bg-amber-500'
                                    : 'bg-red-500'
                              }`}
                              style={{ width: `${parsedJob.completeness}%` }}
                            />
                          </div>
                          <span
                            className={`text-sm font-semibold ${
                              parsedJob.completeness >= 80
                                ? 'text-emerald-600'
                                : parsedJob.completeness >= 60
                                  ? 'text-amber-600'
                                  : 'text-red-600'
                            }`}
                          >
                            {parsedJob.completeness}%
                          </span>
                        </div>
                      </div>
                    )}

                    {parsedJob.missing_fields &&
                      parsedJob.missing_fields.length > 0 && (
                        <div>
                          <p className="text-sm text-gray-500 mb-2 flex items-center gap-1">
                            <AlertCircle className="h-3.5 w-3.5" /> 缺失字段
                          </p>
                          <div className="flex flex-wrap gap-2">
                            {parsedJob.missing_fields.map((field) => (
                              <Badge
                                key={field}
                                variant="outline"
                                className="bg-red-50 text-red-600 border-red-200"
                              >
                                {field}
                              </Badge>
                            ))}
                          </div>
                        </div>
                      )}

                    {parsedJob.urgency && parsedJob.urgency !== 'normal' && (
                      <div
                        className={`p-3 rounded-lg ${
                          parsedJob.urgency === 'urgent'
                            ? 'bg-red-50 border border-red-200'
                            : 'bg-amber-50 border border-amber-200'
                        }`}
                      >
                        <p className="text-sm font-medium flex items-center gap-1">
                          <AlertCircle
                            className={`h-4 w-4 ${
                              parsedJob.urgency === 'urgent'
                                ? 'text-red-500'
                                : 'text-amber-500'
                            }`}
                          />
                          紧急程度：
                          {parsedJob.urgency === 'urgent' ? '紧急' : '较急'}
                        </p>
                      </div>
                    )}
                  </div>
                )}
              </div>
            ) : (
              <div className="h-[300px] flex flex-col items-center justify-center text-gray-400">
                <FileText className="h-16 w-16 mb-4 text-gray-200" />
                <p>解析结果将在这里显示</p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {autoMatchSummary && autoMatchSummary.matches.length > 0 && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Award className="h-5 w-5 text-blue-600" />
                匹配结果 · {autoMatchSummary.jobTitle}
              </CardTitle>
              <CardDescription>
                按综合分排序的候选人，评分依据即解析出的技能/经验/学历/薪资标准；可进入短名单做人工决策
              </CardDescription>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => router.push('/shortlists')}
            >
              查看短名单
            </Button>
          </CardHeader>
          <CardContent>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
              {autoMatchSummary.matches.map((match, index) => {
                const candidate = candidates.find(
                  (item) => item.id === match.candidate_id,
                );
                return (
                  <div
                    key={match.candidate_id}
                    className={`rounded-xl border p-3 ${getScoreBg(match.overall_score || 0)}`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-gray-500">
                        No.{match.rank ?? index + 1}
                      </span>
                      <span className={`text-xl font-bold ${getScoreColor(match.overall_score || 0)}`}>
                        {match.overall_score}
                      </span>
                    </div>
                    <p className="mt-1 truncate text-sm font-medium text-gray-900">
                      {candidate?.name ?? '未知候选人'}
                    </p>
                    <p className="mt-0.5 text-xs text-gray-500">
                      {match.recommendation_band
                        ? BAND_LABELS[match.recommendation_band]
                        : getScoreLabel(match.overall_score || 0)}
                    </p>
                    <Button
                      size="sm"
                      variant="outline"
                      className="mt-2 w-full"
                      onClick={() => router.push(`/matching?jobId=${autoMatchSummary.jobId}&candidateId=${match.candidate_id}`)}
                    >
                      深度匹配
                    </Button>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle>职位库</CardTitle>
            <CardDescription>已解析的职位列表 · 点击职位卡片可回填并编辑职位描述</CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
              <Input
                placeholder="搜索职位..."
                className="pl-9 w-48"
                value={jobSearch}
                onChange={(event) => setJobSearch(event.target.value)}
              />
            </div>
            <Button onClick={openCreateForm}>
              <Plus className="h-4 w-4 mr-1" />
              新增职位
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {filteredJobs.length > 0 ? (
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {filteredJobs.map((job) => (
                <Card
                  key={job.id}
                  className="hover:shadow-md transition-shadow cursor-pointer"
                  onClick={() => handleSelectJob(job)}
                  title="点击回填职位描述"
                >
                  <CardContent className="pt-4">
                    <div className="flex items-start justify-between mb-2">
                      <h4 className="font-semibold text-gray-900">{job.title}</h4>
                      {job.salary_range && (
                        <Badge className="bg-emerald-50 text-emerald-700">
                          {job.salary_range}
                        </Badge>
                      )}
                    </div>
                    <div className="space-y-1 text-sm text-gray-500">
                      <div className="flex flex-wrap items-center justify-between gap-2"><Badge variant="outline">{job.status === 'active' ? '已启用' : job.status === 'closed' ? '已关闭' : '草稿'}</Badge><div className="flex flex-wrap gap-2">{job.status === 'active' && <Button size="sm" onClick={(event) => { event.stopPropagation(); void generateShortlist(job.id); }} disabled={generatingJobId === job.id}>{generatingJobId === job.id ? '提交中…' : '生成短名单'}</Button>}{job.status === 'active' ? <Button size="sm" variant="outline" onClick={(event) => { event.stopPropagation(); void updateJobLifecycle(job.id, 'close'); }}>关闭职位</Button> : <Button size="sm" variant="outline" onClick={(event) => { event.stopPropagation(); void updateJobLifecycle(job.id, 'activate'); }}>启用职位</Button>}<Button size="sm" variant="outline" onClick={(event) => { event.stopPropagation(); openEditForm(job); }}><Pencil className="h-3.5 w-3.5" />编辑</Button><Button size="sm" variant="outline" className="text-red-600 hover:text-red-700" onClick={(event) => { event.stopPropagation(); setDeletingJob(job); }}><Trash2 className="h-3.5 w-3.5" />删除</Button></div></div>
                      {job.department && <p>部门：{job.department}</p>}
                      {job.location && <p>地点：{job.location}</p>}
                      {job.skills_required && job.skills_required.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-2">
                          {job.skills_required.slice(0, 3).map((skill) => (
                            <Badge
                              key={skill}
                              variant="secondary"
                              className="text-xs"
                            >
                              {skill}
                            </Badge>
                          ))}
                          {job.skills_required.length > 3 && (
                            <Badge variant="secondary" className="text-xs">
                              +{job.skills_required.length - 3}
                            </Badge>
                          )}
                        </div>
                      )}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          ) : (
            <div className="text-center py-8 text-gray-500">
              {jobSearch ? (
                '未找到匹配的职位'
              ) : (
                <span className="inline-flex items-center gap-2">
                  <Target className="h-4 w-4" />
                  暂无职位，可点击“新增职位”或解析JD
                </span>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <JobFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        job={formJob}
        onSaved={reloadJobs}
      />

      <AlertDialog
        open={deletingJob !== null}
        onOpenChange={(open) => { if (!open && !deleting) setDeletingJob(null); }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删除职位「{deletingJob?.title}」？</AlertDialogTitle>
            <AlertDialogDescription>
              将同时级联删除该职位关联的匹配记录与短名单数据，且不可恢复。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>取消</AlertDialogCancel>
            <AlertDialogAction
              disabled={deleting}
              className="bg-red-600 text-white hover:bg-red-700"
              onClick={(event) => { event.preventDefault(); void confirmDeleteJob(); }}
            >
              {deleting ? '删除中…' : '确认删除'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
