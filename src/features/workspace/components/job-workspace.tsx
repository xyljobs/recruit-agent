'use client';

import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  AlertCircle,
  ArrowRight,
  ClipboardList,
  Copy,
  FileText,
  FileUp,
  History,
  Pencil,
  Plus,
  Power,
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
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { authFetch } from '@/lib/auth-client';
import { formatExperienceBand } from '@/lib/matching/screening-rubric';
import { refineSearchKeywords, withTitleFirst } from '@/lib/matching/search-keywords';
import { getScoreBg, getScoreColor } from '../constants';
import { mergeResumeImportFiles } from '../lib/resume-file';
import { useWorkspaceData } from '../hooks/use-workspace-data';
import { JobFormDialog } from './job-form-dialog';
import { ImportPreviewDialog } from './resume-import-preview';
import { DemoResetButton } from './demo-reset-control';
import type { Job } from '../types';

// 职位选中记忆 key：配合 URL jobId 参数，切换页面/刷新后回到职位页仍保持选中
const LAST_JOB_ID_KEY = 'last_job_id';

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

export function JobWorkspace() {
  const router = useRouter();
  const {
    jobs,
    reloadJobs,
    reloadCandidates,
  } = useWorkspaceData();
  const [jdContent, setJdContent] = useState('');
  const [parsedJob, setParsedJob] = useState<Job | null>(null);
  const parsedBand = parsedJob?.screening_rubric?.experience_band ?? null;
  const parsedBandLabel = formatExperienceBand(parsedBand);
  const [jdLoading, setJdLoading] = useState(false);
  const [jdElapsed, setJdElapsed] = useState(0);
  // JD 解析深度思考开关：开启后思考型模型先深度推理 JD 语义再输出，结果更精准但约需 1-2 分钟
  const [parseDeepThinking, setParseDeepThinking] = useState(false);
  // 流式解析的实时预览文本：AI 生成过程中逐字展示，消除等待"卡住"感
  const [parsePreview, setParsePreview] = useState('');
  const parsePreviewRef = useRef<HTMLPreElement | null>(null);
  const [jobSearch, setJobSearch] = useState('');
  const [importCandidateOpen, setImportCandidateOpen] = useState(false);
  const [importCandidateJobId, setImportCandidateJobId] = useState<string | null>(null);
  const [importCandidateFiles, setImportCandidateFiles] = useState<File[]>([]);
  const importFileInputRef = useRef<HTMLInputElement | null>(null);
  const [editingJobId, setEditingJobId] = useState<string | null>(null);
  const [savingJd, setSavingJd] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [formJob, setFormJob] = useState<Job | null>(null);
  const [deletingJob, setDeletingJob] = useState<Job | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [aiEnabled, setAiEnabled] = useState<boolean | null>(null);
  const [publishDescription, setPublishDescription] = useState('');
  const [generatingDescription, setGeneratingDescription] = useState(false);
  // 发布版描述深度思考开关与耗时计时：开启后思考型模型先深度推理再撰写，文案质量更高但约需 1-2 分钟
  const [publishDeepThinking, setPublishDeepThinking] = useState(false);
  const [publishGenElapsed, setPublishGenElapsed] = useState(0);
  // 当前进行中生成的实际模式：静默自动生成始终走快速模式，避免开关开着时误导文案
  const [publishGenMode, setPublishGenMode] = useState<'fast' | 'deep'>('fast');
  // 岗位关键词重新生成：loading/计时/深度思考开关；序号保证只有最新一次生成能更新关键词
  const [keywordsLoading, setKeywordsLoading] = useState(false);
  const [keywordsElapsed, setKeywordsElapsed] = useState(0);
  const [keywordsPreview, setKeywordsPreview] = useState('');
  const [deepThinking, setDeepThinking] = useState(false);
  const keywordsGenSeq = useRef(0);
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
  // 发布版描述生成序号与 abort 控制器：保证只有最新一次生成能更新首屏
  const publishGenSeq = useRef(0);
  const publishGenAbort = useRef<AbortController | null>(null);
  // 本会话已生成描述的本地缓存：reloadJobs 完成前切换职位也能复用，避免重复生成
  const publishCacheRef = useRef<Record<string, string>>({});
  // 静默自动生成失败过的职位：不再反复自动重试烧 AI 额度，改由用户显式点击按钮重试
  const publishAutoFailedRef = useRef<Set<string>>(new Set());
  // 解析结果 tab 区：切换 tab 后若新面板底部超出视口（tab 栏贴近屏幕底部时），
  // 自动把 tab 栏平滑滚到视口顶部，免去手动滚动；内容全部可见时不打扰
  const resultTabsRef = useRef<HTMLDivElement | null>(null);
  const handleResultTabChange = () => {
    window.requestAnimationFrame(() => {
      const root = resultTabsRef.current;
      if (!root) return;
      const panel = root.querySelector<HTMLElement>('[data-state="active"][role="tabpanel"]');
      const panelBottom = panel?.getBoundingClientRect().bottom ?? 0;
      if (panelBottom > window.innerHeight - 16) {
        root.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    });
  };

  const editingJob = useMemo(
    () => jobs.find((job) => job.id === editingJobId) ?? null,
    [jobs, editingJobId],
  );

  // 解析耗时可视化：LLM 生成完整需求卡片通常需 10 秒左右，计时让等待可感知
  useEffect(() => {
    if (!jdLoading) return;
    setJdElapsed(0);
    const timer = window.setInterval(() => setJdElapsed((value) => value + 1), 1000);
    return () => window.clearInterval(timer);
  }, [jdLoading]);

  // 流式预览自动滚动到底部，跟随最新生成内容
  useEffect(() => {
    const node = parsePreviewRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [parsePreview]);

  // 关键词重新生成耗时可视化：快速模式约 1-2 秒，深度思考模式约 30 秒-1 分钟
  useEffect(() => {
    if (!keywordsLoading) return;
    setKeywordsElapsed(0);
    const timer = window.setInterval(() => setKeywordsElapsed((value) => value + 1), 1000);
    return () => window.clearInterval(timer);
  }, [keywordsLoading]);

// 发布版描述生成耗时可视化：快速模式约 10 秒，深度思考模式约 1-2 分钟
  useEffect(() => {
    if (!generatingDescription) return;
    setPublishGenElapsed(0);
    const timer = window.setInterval(() => setPublishGenElapsed((value) => value + 1), 1000);
    return () => window.clearInterval(timer);
  }, [generatingDescription]);

  // 解析的核心交付物：岗位关键词，供 HR 复制到招聘平台搜索
  // 优先用 AI 提炼并持久化的 search_keywords（含职位别名/同义词）；不足时回退到本地清洗必需+加分技能
  // 职位名称是最精准的搜索词，始终置于首位
  const parsedKeywords = useMemo(() => {
    if (!parsedJob) return [] as string[];
    const fromAi = refineSearchKeywords(parsedJob.search_keywords ?? []);
    if (fromAi.length >= 3) {
      return withTitleFirst(fromAi, parsedJob.title).slice(0, 10);
    }
    return withTitleFirst(
      refineSearchKeywords([
        ...(parsedJob.skills_required ?? []),
        ...(parsedJob.bonus_skills ?? []),
      ]),
      parsedJob.title,
    ).slice(0, 10);
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
    setParsePreview('');
    try {
      const response = await authFetch('/api/jd/parse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jdContent,
          deepThinking: parseDeepThinking,
          ...(targetJobId ? { jobId: targetJobId } : {}),
        }),
      });
      const contentType = response.headers.get('content-type') ?? '';

      // JSON 响应：限流 / AI 未启用等前置错误
      if (contentType.includes('application/json')) {
        const result: { success?: boolean; data?: Job; error?: string } = await response.json();
        if (!result.success || !result.data) throw new Error(result.error || '解析失败');
        finishParse(result.data, targetJobId);
        return;
      }

      // NDJSON 流式响应：逐分片实时渲染生成过程，done 事件携带最终结果
      const reader = response.body?.getReader();
      if (!reader) throw new Error('解析失败');
      const decoder = new TextDecoder();
      let buffer = '';
      let accumulated = '';
      const outcome: { job?: Job; error?: string } = {};
      const handleLine = (line: string) => {
        if (!line.trim()) return;
        const event: { type?: string; text?: string; data?: Job; error?: string } = JSON.parse(line);
        if (event.type === 'delta' && event.text) {
          accumulated += event.text;
          setParsePreview(accumulated);
        } else if (event.type === 'done' && event.data) {
          outcome.job = event.data;
        } else if (event.type === 'error') {
          outcome.error = event.error || '解析失败';
        }
      };
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';
        lines.forEach(handleLine);
      }
      handleLine(buffer);
      if (outcome.error) throw new Error(outcome.error);
      if (!outcome.job) throw new Error('解析失败，请重试');
      finishParse(outcome.job, targetJobId);
    } catch (error) {
      console.error('JD解析失败:', error);
      toast.error(error instanceof Error ? error.message : '解析失败，请重试');
    } finally {
      setJdLoading(false);
      setParsePreview('');
    }
  }

  /** 解析完成后应用结果：更新需求卡片、后台刷新职位列表并提示 */
  function finishParse(job: Job, targetJobId: string | null) {
    setParsedJob(job);
    // 解析结果同步为当前选中职位：写入 URL 与 sessionStorage，切换页面后返回仍保持
    const params = new URLSearchParams(window.location.search);
    if (params.get('jobId') !== job.id) {
      params.set('jobId', job.id);
      router.replace(`/jobs?${params.toString()}`, { scroll: false });
    }
    sessionStorage.setItem(LAST_JOB_ID_KEY, job.id);
    // 发布版JD为默认首屏：解析完成后自动静默生成一次，消除空首屏
    void generatePublishDescription(job.id, { silent: true });
    // 解析结果即时生效；职位列表后台刷新，不阻塞等待反馈
    void reloadJobs();
    if (targetJobId) {
      toast.success('已重新提炼搜索关键词、润色发布版JD，并更新用人标准');
    } else {
      toast.success('JD解析成功！请先在第二步完成候选人入库，再在第三步生成短名单');
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

  /** 重新生成岗位关键词：基于职位最新描述独立提炼，不重跑整份 JD 解析；深度思考模式结果更精准但约需 30 秒-1 分钟 */
  async function regenerateKeywords() {
    const job = parsedJob;
    if (!job) return;
    const seq = ++keywordsGenSeq.current;
    const jobId = job.id;
    setKeywordsLoading(true);
    setKeywordsPreview('');
    try {
      const response = await authFetch('/api/jd/keywords', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobId, deepThinking }),
      });
      const contentType = response.headers.get('content-type') ?? '';
      if (!response.ok) {
        const result: { error?: string } | null = await response.json().catch(() => null);
        throw new Error(result?.error || '重新生成失败');
      }
      // JSON 响应：rules_only 模式本地规则精炼即时返回
      if (contentType.includes('application/json')) {
        const result: { success?: boolean; data?: { search_keywords?: string[] }; error?: string } = await response.json();
        if (!result.success || !result.data) throw new Error(result.error || '重新生成失败');
        if (seq !== keywordsGenSeq.current) return;
        applyKeywords(result.data.search_keywords ?? [], jobId);
        return;
      }
      // NDJSON 流式响应：delta 为生成过程，done 事件携带归一化后的最终关键词
      const reader = response.body?.getReader();
      if (!reader) throw new Error('重新生成失败');
      const decoder = new TextDecoder();
      let buffer = '';
      let accumulated = '';
      const outcome: { keywords?: string[]; error?: string } = {};
      const handleLine = (line: string) => {
        if (!line.trim()) return;
        const event: { type?: string; text?: string; data?: { search_keywords?: string[] }; error?: string } = JSON.parse(line);
        if (event.type === 'delta' && event.text) {
          accumulated += event.text;
          if (seq === keywordsGenSeq.current) setKeywordsPreview(accumulated);
        } else if (event.type === 'done' && event.data) {
          outcome.keywords = event.data.search_keywords ?? [];
        } else if (event.type === 'error') {
          outcome.error = event.error || '重新生成失败';
        }
      };
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';
        lines.forEach(handleLine);
      }
      handleLine(buffer);
      if (seq !== keywordsGenSeq.current) return;
      if (outcome.error) throw new Error(outcome.error);
      applyKeywords(outcome.keywords ?? [], jobId);
    } catch (error) {
      // 被作废的任务静默退出，不报错不更新状态
      if (seq !== keywordsGenSeq.current) return;
      console.error('重新生成岗位关键词失败:', error);
      toast.error(error instanceof Error ? error.message : '重新生成失败，请重试');
    } finally {
      if (seq === keywordsGenSeq.current) {
        setKeywordsLoading(false);
        setKeywordsPreview('');
      }
    }
  }

  /** 应用新关键词：更新当前选中职位（校验职位未切换），后台刷新职位列表同步持久化结果 */
  function applyKeywords(keywords: string[], jobId: string) {
    setParsedJob((prev) => (prev && prev.id === jobId ? { ...prev, search_keywords: keywords } : prev));
    void reloadJobs();
    toast.success('岗位关键词已重新生成，可复制后到招聘平台搜索人才');
  }

  /** 反哺：基于解析出的用人标准生成发布版职位描述，供 HR 复制到招聘平台发布；silent 用于解析/选中职位后的自动触发，只展示结果不打断且始终快速模式 */
  async function generatePublishDescription(jobId: string, options?: { silent?: boolean; deepThinking?: boolean }) {
    const silent = options?.silent === true;
    const deepThinking = options?.deepThinking === true;
    // 用户显式触发即视为主动重试：清除自动生成的失败标记
    if (!silent) publishAutoFailedRef.current.delete(jobId);
    // 序号自增并 abort 上一次请求：切换职位或重复触发时旧任务作废，避免旧结果覆盖新首屏
    const seq = ++publishGenSeq.current;
    publishGenAbort.current?.abort();
    const controller = new AbortController();
    publishGenAbort.current = controller;
    setGeneratingDescription(true);
    setPublishGenMode(deepThinking ? 'deep' : 'fast');
    setPublishDescription('');
    try {
      const response = await authFetch('/api/jd/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobId, ...(deepThinking ? { deepThinking: true } : {}) }),
        signal: controller.signal,
      });
      const contentType = response.headers.get('content-type') ?? '';
      if (!response.ok) {
        const result: { error?: string } | null = await response.json().catch(() => null);
        throw new Error(result?.error || '生成失败');
      }
      if (contentType.includes('application/json')) {
        // rules_only 模式：本地模板即时返回完整结果
        const result: { success?: boolean; data?: { description?: string }; error?: string } = await response.json();
        if (!result.success) throw new Error(result.error || '生成失败');
        if (seq !== publishGenSeq.current) return;
        const description = String(result.data?.description ?? '');
        setPublishDescription(description);
        publishCacheRef.current[jobId] = description;
        publishAutoFailedRef.current.delete(jobId);
        // 后台刷新列表同步 publish_jd，切走职位后回来仍能读到库中缓存
        void reloadJobs();
        if (!silent) toast.success('发布版职位描述已生成，可复制后到招聘平台发布');
        return;
      }
      // AI 模式：NDJSON 流式输出，逐分片实时渲染
      const reader = response.body?.getReader();
      if (!reader) throw new Error('生成失败');
      const decoder = new TextDecoder();
      let buffer = '';
      let accumulated = '';
      const handleLine = (line: string) => {
        if (!line.trim()) return;
        const event: { type?: string; text?: string } = JSON.parse(line);
        if (event.type === 'delta' && event.text) {
          accumulated += event.text;
          if (seq === publishGenSeq.current) setPublishDescription(accumulated);
        }
      };
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';
        lines.forEach(handleLine);
      }
      handleLine(buffer);
      if (seq !== publishGenSeq.current) return;
      if (!accumulated.trim()) throw new Error('生成内容为空，请重试');
      publishCacheRef.current[jobId] = accumulated.trim();
      publishAutoFailedRef.current.delete(jobId);
      // 后台刷新列表同步 publish_jd，切走职位后回来仍能读到库中缓存
      void reloadJobs();
      if (!silent) toast.success('发布版职位描述已生成，可复制后到招聘平台发布');
    } catch (error) {
      // 被作废的任务（切换职位/abort）静默退出，不报错不更新状态
      if (seq !== publishGenSeq.current) return;
      const message = error instanceof Error ? error.message : '生成失败，请重试';
      // 静默自动生成失败必须可见：标记失败防止反复自动重试烧额度，并提示用户可手动重试
      if (silent) publishAutoFailedRef.current.add(jobId);
      toast.error(silent ? `发布版描述自动生成失败：${message}，可点击「生成发布版描述」重试` : message);
    } finally {
      if (seq === publishGenSeq.current) {
        setGeneratingDescription(false);
        publishGenAbort.current = null;
      }
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
      toast.success('发布渠道已登记');
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
      if (editingJobId === deletingJob.id) {
        setEditingJobId(null);
        // 清理职位选中记忆，避免删除后回到本页又尝试恢复已删职位（URL 残留参数由恢复逻辑清理）
        sessionStorage.removeItem(LAST_JOB_ID_KEY);
      }
      setDeletingJob(null);
      await reloadJobs();
      toast.success('职位已删除');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '删除职位失败');
    } finally {
      setDeleting(false);
    }
  }

  /** 应用选中职位：回填 JD 原文、展示解析结果。内部系统默认宽屏分栏，原地切换无需滚动 */
  function applySelectJob(job: Job) {
    setEditingJobId(job.id);
    setJdContent(job.raw_jd ?? '');
    setParsedJob(job);
    if (job.id !== parsedJob?.id) {
      // 切换职位：作废进行中的旧职位生成请求，避免其结果覆盖新首屏
      publishGenSeq.current += 1;
      publishGenAbort.current?.abort();
      publishGenAbort.current = null;
      setGeneratingDescription(false);
    }
    // 缓存优先：库中已持久化或本会话刚生成过的描述直接复用，
    // 切页/刷新/重选职位时内容保持稳定，只有显式点击“生成发布版描述”才重算
    const cachedPublish = job.publish_jd || publishCacheRef.current[job.id];
    if (cachedPublish) {
      setPublishDescription(cachedPublish);
      return;
    }
    // 无缓存时：同职位已有内存结果/生成中则复用，否则自动静默生成一次，消除空首屏；
    // 自动生成失败过的职位不再反复重试（避免反复消耗 AI 额度），由用户显式点击按钮重试
    const sameJobReady = job.id === parsedJob?.id && (publishDescription !== '' || generatingDescription);
    if (!sameJobReady && !publishAutoFailedRef.current.has(job.id)) {
      void generatePublishDescription(job.id, { silent: true });
    }
  }

  /** 选中职位：应用选中状态，并把 jobId 写入 URL 与 sessionStorage，切换页面/刷新后返回仍保持选中 */
  function handleSelectJob(job: Job) {
    applySelectJob(job);
    const params = new URLSearchParams(window.location.search);
    if (params.get('jobId') !== job.id) {
      params.set('jobId', job.id);
      router.replace(`/jobs?${params.toString()}`, { scroll: false });
    }
    sessionStorage.setItem(LAST_JOB_ID_KEY, job.id);
  }

  /** 职位库加载完成后，从 URL（优先）或 sessionStorage 恢复上次选中的职位 */
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const jobId = params.get('jobId') || sessionStorage.getItem(LAST_JOB_ID_KEY);
    if (!jobId) return;
    const job = jobs.find((item) => item.id === jobId);
    if (job) {
      if (job.id !== parsedJob?.id) applySelectJob(job);
    } else if (jobs.length > 0) {
      // URL/存储指向的职位已不存在（如已删除），清理失效状态
      if (params.has('jobId')) router.replace('/jobs', { scroll: false });
      sessionStorage.removeItem(LAST_JOB_ID_KEY);
    }
    // 仅在职位库加载完成时恢复选中；applySelectJob 为本组件函数，无需纳入依赖
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobs]);

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

  return (
    <div className="grid gap-6 lg:grid-cols-[clamp(320px,20vw,460px)_minmax(0,1fr)] lg:items-start">
      {/* 左栏：职位库常驻列表，点击即时切换右侧编辑，无需上下滚动 */}
      <Card className="self-start lg:sticky lg:top-6">
        <CardHeader className="space-y-3">
          <div className="flex items-center justify-between gap-2">
            <div>
              <CardTitle>职位库</CardTitle>
              <CardDescription>共 {jobs.length} 个职位 · 点击即时在右侧编辑</CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <DemoResetButton />
              <Button size="sm" className="shrink-0" onClick={openCreateForm}>
                <Plus className="h-4 w-4" />
                新增
              </Button>
            </div>
          </div>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="搜索职位..."
              className="pl-9"
              value={jobSearch}
              onChange={(event) => setJobSearch(event.target.value)}
            />
          </div>
        </CardHeader>
        <CardContent>
          {filteredJobs.length > 0 ? (
            <div className="space-y-2 lg:max-h-[calc(100vh_-_17rem)] lg:overflow-y-auto">
              {filteredJobs.map((job) => {
                const selected = job.id === editingJobId;
                return (
                  <div
                    key={job.id}
                    className={`rounded-lg border p-3 cursor-pointer transition-colors ${
                      selected
                        ? 'border-blue-300 bg-blue-50/70'
                        : 'border-slate-200 hover:border-slate-300 hover:bg-slate-50'
                    }`}
                    onClick={() => handleSelectJob(job)}
                    title="点击在右侧回填并编辑职位描述"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <p className="min-w-0 truncate text-sm font-semibold text-foreground">{job.title}</p>
                      {job.salary_range && (
                        <span className="shrink-0 text-xs font-medium text-emerald-700">{job.salary_range}</span>
                      )}
                    </div>
                    <div className="mt-1.5 flex items-center gap-1.5">
                      <Badge variant="outline" className="shrink-0 px-1.5 text-[11px]">
                        {job.status === 'active' ? '已启用' : job.status === 'closed' ? '已关闭' : '草稿'}
                      </Badge>
                      <span className="truncate text-xs text-muted-foreground">
                        {[job.department, job.location].filter(Boolean).join(' · ') || '—'}
                      </span>
                    </div>
                    {job.skills_required && job.skills_required.length > 0 && (
                      <p
                        className="mt-1 truncate text-xs text-muted-foreground"
                        title={job.skills_required.join(' · ')}
                      >
                        {job.skills_required.join(' · ')}
                      </p>
                    )}
                    <div className="mt-2 flex flex-wrap items-center gap-1">
                      {job.status === 'active' && (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 gap-1 px-1.5 text-xs text-slate-600"
                          title="为该职位导入候选人简历"
                          onClick={(event) => {
                            event.stopPropagation();
                            setImportCandidateJobId(job.id);
                            importFileInputRef.current?.click();
                          }}
                        >
                          <FileUp className="h-3.5 w-3.5" />
                          导入简历
                        </Button>
                      )}
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 gap-1 px-1.5 text-xs text-slate-600"
                        title={job.status === 'active' ? '关闭该职位' : '重新启用该职位'}
                        onClick={(event) => {
                          event.stopPropagation();
                          void updateJobLifecycle(job.id, job.status === 'active' ? 'close' : 'activate');
                        }}
                      >
                        <Power className="h-3.5 w-3.5" />
                        {job.status === 'active' ? '关闭' : '启用'}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 gap-1 px-1.5 text-xs text-slate-600"
                        title="编辑职位信息"
                        onClick={(event) => {
                          event.stopPropagation();
                          openEditForm(job);
                        }}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                        编辑
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 gap-1 px-1.5 text-xs text-destructive hover:bg-destructive/10 hover:text-destructive"
                        title="删除职位"
                        onClick={(event) => {
                          event.stopPropagation();
                          setDeletingJob(job);
                        }}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                        删除
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="text-center py-8 text-muted-foreground">
              {jobSearch ? (
                '未找到匹配的职位'
              ) : (
                <span className="inline-flex items-center gap-2">
                  <Target className="h-4 w-4" />
                  暂无职位，可点击「新增」或解析JD
                </span>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* 右栏：职位描述编辑 + 解析结果，选中左侧职位后即时更新 */}
      <div className="min-w-0 space-y-6">
        <div>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FileText className="h-5 w-5 text-blue-600" />
              AI 辅助解析职位描述（可选）
            </CardTitle>
            <CardDescription>
              粘贴职位描述，AI 自动生成需求卡片
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
职位名称：智能制造工程师
部门：生产技术部
工作地点：杭州
薪资范围：25-40K

【岗位要求】
1. 本科及以上学历，机械、自动化相关专业
2. 3年以上智能制造或自动化产线经验
3. 熟悉PLC编程、工业机器人调试...`}
              className="min-h-[300px] resize-none"
              value={jdContent}
              onChange={(event) => setJdContent(event.target.value)}
            />
            <div className="flex flex-col gap-2 sm:flex-row">
              <Button
                className="flex-1"
                onClick={handleParseJD}
                disabled={jdLoading || !jdContent.trim() || aiEnabled === false}
              >
                {jdLoading ? (
                  <>
                    <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                    {parseDeepThinking
                      ? `AI深度思考中（已${jdElapsed}秒）…`
                      : `AI正在解析，内容实时显示中（已${jdElapsed}秒）…`}
                  </>
                ) : (
                  <>
                    <Sparkles className="h-4 w-4 mr-2" />
                    {editingJobId ? 'AI重新提炼关键词·润色JD' : 'AI提炼关键词·润色JD'}
                  </>
                )}
              </Button>
              {editingJobId && (
                <Button
                  className="sm:w-36"
                  onClick={() => void saveJdUpdate()}
                  disabled={savingJd || !jdContent.trim()}
                >
                  {savingJd ? '保存中…' : '保存描述'}
                </Button>
              )}
            </div>
            <div className="flex items-center justify-end gap-1.5">
              <Switch
                id="parse-deep-thinking"
                checked={parseDeepThinking}
                onCheckedChange={setParseDeepThinking}
                disabled={jdLoading || aiEnabled === false}
              />
              <Label
                htmlFor="parse-deep-thinking"
                className="text-xs font-normal text-muted-foreground"
              >
                深度思考（约 1-2 分钟，结果更精准）
              </Label>
            </div>
          </CardContent>
        </Card>
        </div>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle>解析结果</CardTitle>
              <CardDescription>AI 提取的职位信息将显示在这里，作为候选人入库与短名单匹配的用人标准</CardDescription>
            </div>
            <Button
              size="sm"
              className="shrink-0 gap-1.5 rounded-full px-4 font-medium shadow-sm transition-all hover:shadow-md"
              disabled={!parsedJob}
              onClick={() => router.push('/candidates')}
              title={parsedJob ? undefined : '先解析或选择一个职位后可继续'}
            >
              <FileUp className="h-4 w-4" />
              下一步：候选人入库
              <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
            </Button>
          </CardHeader>
          <CardContent>
            {jdLoading && (
              <div className="mb-4 rounded-xl border border-blue-200 bg-blue-50/60 p-4">
                <div className="flex items-center gap-2">
                  <RefreshCw className="h-4 w-4 animate-spin text-blue-600" />
                  <p className="text-sm font-medium text-blue-900">
                    {parseDeepThinking
                      ? `AI 深度思考中：先推理 JD 语义再生成需求卡片（已${jdElapsed}秒）…`
                      : `AI 正在生成需求卡片（已${jdElapsed}秒），内容实时显示中…`}
                  </p>
                </div>
                <pre
                  ref={parsePreviewRef}
                  className="mt-2 max-h-48 overflow-y-auto whitespace-pre-wrap break-all rounded-lg bg-white/80 p-3 font-mono text-xs leading-relaxed text-slate-600"
                >
                  {parsePreview || (parseDeepThinking ? '深度推理进行中，思考完成后内容将逐字显示…' : '正在连接模型，内容马上逐字显示…')}
                </pre>
              </div>
            )}
            {parsedJob ? (
              <div className="space-y-4">
                <div ref={resultTabsRef} className="scroll-mt-28">
                  <Tabs
                    key={parsedJob.id}
                    defaultValue="publish"
                    onValueChange={handleResultTabChange}
                  >
                    <TabsList className="grid w-full grid-cols-4">
                    <TabsTrigger value="publish">发布版JD</TabsTrigger>
                    <TabsTrigger value="keywords">
                      岗位关键词
                      {parsedKeywords.length > 0 && (
                        <span className="text-xs text-muted-foreground">
                          {parsedKeywords.length}
                        </span>
                      )}
                    </TabsTrigger>
                    <TabsTrigger value="criteria">匹配依据</TabsTrigger>
                    <TabsTrigger value="talent">
                      人才池再激活
                      {talentPool && talentPool.candidates.length > 0 && (
                        <span className="text-xs text-muted-foreground">
                          {talentPool.candidates.length}
                        </span>
                      )}
                    </TabsTrigger>
                  </TabsList>

                  <TabsContent value="publish">
                    <div className="rounded-xl border border-purple-200 bg-purple-50/60 p-4">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-sm font-medium text-purple-900">
                          发布版职位描述 · 生成后复制到招聘平台发布
                        </p>
                        <div className="flex shrink-0 items-center gap-2">
                          {publishDescription && (
                            <Button
                              size="sm"
                              onClick={() => void copyPublishDescription()}
                            >
                              <Copy className="mr-1 h-4 w-4" />
                              复制描述
                            </Button>
                          )}
                          <Button
                            size="sm"
                            disabled={!parsedJob}
                            onClick={() => setPostingFormOpen(value => !value)}
                          >
                            <ClipboardList className="mr-1 h-4 w-4" />
                            {postingFormOpen ? '收起登记' : '登记发布渠道'}
                          </Button>
                          <div className="flex items-center gap-1.5">
                            <Switch
                              id="publish-deep-thinking"
                              checked={publishDeepThinking}
                              onCheckedChange={setPublishDeepThinking}
                              disabled={aiEnabled === false || generatingDescription}
                            />
                            <Label
                              htmlFor="publish-deep-thinking"
                              className="text-xs font-normal text-purple-700"
                            >
                              深度思考
                            </Label>
                          </div>
                          <Button
                            size="sm"
                            disabled={!parsedJob || generatingDescription}
                            onClick={() => void generatePublishDescription(parsedJob.id, { deepThinking: publishDeepThinking })}
                          >
                            {generatingDescription ? (
                              <>
                                <RefreshCw className="mr-1 h-4 w-4 animate-spin" />
                                {publishGenMode === 'deep' ? `深度思考中（已${publishGenElapsed}秒）…` : `生成中（已${publishGenElapsed}秒）…`}
                              </>
                            ) : (
                              <>
                                <RefreshCw className="mr-1 h-4 w-4" />
                                {publishDescription ? 'AI重新生成发布版描述' : 'AI生成发布版描述'}
                              </>
                            )}
                          </Button>
                        </div>
                      </div>
                      {publishDescription ? (
                        <div className="mt-2 min-h-[220px] overflow-y-auto whitespace-pre-wrap rounded-md border border-input bg-card px-3 py-2 text-sm leading-6">
                          {publishDescription.split('\n').map((line, index, lines) => (
                            <Fragment key={index}>
                              {line.includes('【招聘流程说明】') ? (
                                <strong className="font-semibold">{line}</strong>
                              ) : (
                                line
                              )}
                              {index < lines.length - 1 ? '\n' : ''}
                            </Fragment>
                          ))}
                        </div>
                      ) : generatingDescription ? (
                        <p className="mt-2 flex items-center gap-1.5 text-xs text-purple-700">
                          <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                          {publishGenMode === 'deep'
                            ? `深度思考中：AI 正在深度推理用人标准并撰写职位描述，约需 1-2 分钟（已${publishGenElapsed}秒）…`
                            : `AI 正在撰写职位描述，内容将逐段显示（已${publishGenElapsed}秒）…`}
                        </p>
                      ) : (
                        <p className="mt-2 text-xs text-purple-700">
                          基于解析出的用人标准，一键生成结构完整、措辞有吸引力的职位描述；AI 未启用时使用内置模板。快速模式约 10 秒；开启「深度思考」后 AI 先深度推理再撰写，文案质量更高但约需 1-2 分钟
                        </p>
                      )}
                      {postingFormOpen && (
                        <div className="mt-3 rounded-lg border border-purple-200 bg-card p-3">
                          <p className="mb-3 text-xs text-purple-700">
                            登记仅记录发布渠道与链接，系统不会自动发布到所选平台；请先自行在平台发布，再回来完成登记。
                          </p>
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
                      <div className="mt-3 flex flex-wrap items-center gap-2">
                        <p className="text-xs font-medium text-slate-500">已登记发布渠道：</p>
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
                  </TabsContent>

                  <TabsContent value="keywords">
                    <div className="rounded-xl border border-blue-200 bg-blue-50/60 p-4">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="text-sm font-medium text-blue-900">
                          岗位关键词 · 可复制后到招聘平台搜索人才
                        </p>
                        <div className="flex flex-wrap items-center gap-2">
                          <div className="flex items-center gap-1.5">
                            <Switch
                              id="keywords-deep-thinking"
                              checked={deepThinking}
                              onCheckedChange={setDeepThinking}
                              disabled={aiEnabled === false || keywordsLoading}
                            />
                            <Label
                              htmlFor="keywords-deep-thinking"
                              className="text-xs font-normal text-blue-700"
                            >
                              深度思考
                            </Label>
                          </div>
                          <Button
                            size="sm"
                            className="shrink-0"
                            disabled={!parsedJob || keywordsLoading}
                            onClick={() => void regenerateKeywords()}
                          >
                            <RefreshCw className={`mr-1 h-4 w-4 ${keywordsLoading ? 'animate-spin' : ''}`} />
                            {keywordsLoading ? 'AI生成中…' : 'AI重新生成'}
                          </Button>
                          <Button
                            size="sm"
                            className="shrink-0"
                            disabled={keywordsLoading}
                            onClick={() => void copyKeywords()}
                          >
                            <Copy className="mr-1 h-4 w-4" />
                            复制关键词
                          </Button>
                        </div>
                      </div>
                      {keywordsLoading && (
                        <>
                          <p className="mt-2 text-xs text-blue-700">
                            {deepThinking
                              ? `深度思考中：AI 正在推理 JD 语义，约需 30 秒-1 分钟（已${keywordsElapsed}秒）…`
                              : `AI 重新提炼中（已${keywordsElapsed}秒）…`}
                          </p>
                          {keywordsPreview && (
                            <div className="mt-2 max-h-32 overflow-y-auto rounded-lg bg-muted/50 p-2">
                              <pre className="whitespace-pre-wrap break-words font-sans text-xs text-muted-foreground">
                                {keywordsPreview}
                              </pre>
                            </div>
                          )}
                        </>
                      )}
                      {parsedKeywords.length > 0 ? (
                        <div className="mt-2 flex flex-wrap gap-2">
                          {parsedKeywords.map((keyword) => (
                            <Badge
                              key={keyword}
                              variant="secondary"
                              className="border-blue-200 bg-card text-blue-700"
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
                      <p className="mt-3 text-xs text-blue-700/80">
                        快速模式约 1-2 秒；开启「深度思考」后 AI 先深度推理 JD 语义再提炼，结果更精准但约需 30 秒-1 分钟
                      </p>
                    </div>
                  </TabsContent>

                  <TabsContent value="criteria">
                    <div className="space-y-4">
                      <div className="grid grid-cols-2 gap-4">
                        {parsedJob.location && (
                          <div className="p-3 bg-muted/50 rounded-lg">
                            <p className="text-xs text-muted-foreground mb-1">工作地点</p>
                            <p className="font-medium">{parsedJob.location}</p>
                          </div>
                        )}
                        {parsedJob.salary_range && (
                          <div className="p-3 bg-emerald-50 rounded-lg">
                            <p className="text-xs text-muted-foreground mb-1">薪资范围</p>
                            <p className="font-medium text-emerald-600">
                              {parsedJob.salary_range}
                            </p>
                          </div>
                        )}
                        {parsedJob.experience_required && (
                          <div className="p-3 bg-muted/50 rounded-lg">
                            <p className="text-xs text-muted-foreground mb-1">经验要求</p>
                            <p className="font-medium">
                              {parsedJob.experience_required}
                            </p>
                            {parsedBand && (
                              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                                <Badge variant="outline" className="bg-card">
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
                          <div className="p-3 bg-muted/50 rounded-lg">
                            <p className="text-xs text-muted-foreground mb-1">学历要求</p>
                            <p className="font-medium">
                              {parsedJob.education_required}
                            </p>
                          </div>
                        )}
                      </div>

                      {parsedJob.responsibilities &&
                        parsedJob.responsibilities.length > 0 && (
                          <div>
                            <p className="text-sm text-muted-foreground mb-2">岗位职责</p>
                            <ul className="list-disc list-inside space-y-1 text-sm">
                              {parsedJob.responsibilities.map((responsibility) => (
                                <li key={responsibility} className="text-foreground">
                                  {responsibility}
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}

                      {parsedJob.benefits && parsedJob.benefits.length > 0 && (
                        <div>
                          <p className="text-sm text-muted-foreground mb-2">福利待遇</p>
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
                            <p className="text-sm text-muted-foreground mb-2 flex items-center gap-1">
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
                          <p className="text-sm text-muted-foreground mb-2">JD完整度</p>
                          <div className="flex items-center gap-3">
                            <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
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
                            <p className="text-sm text-muted-foreground mb-2 flex items-center gap-1">
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
                  </TabsContent>

                  <TabsContent value="talent">
                    {talentPool ? (
                      <div className="rounded-xl border border-emerald-200 bg-emerald-50/60 p-4">
                        <div className="flex items-center justify-between gap-2">
                          <p className="flex items-center gap-1.5 text-sm font-medium text-emerald-900">
                            <History className="h-4 w-4 shrink-0 text-emerald-700" />
                            人才池再激活 · {talentPool.candidates.length} 位历史高分候选人命中当前关键词
                          </p>
                          {talentPool.candidates.length > 0 && (
                            <Button
                              size="sm"
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
                    ) : (
                      <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                        <p className="text-xs text-slate-500">
                          {talentPoolLoading ? '正在加载人才池数据…' : '人才池数据加载失败，请稍后重试'}
                        </p>
                      </div>
                    )}
                  </TabsContent>
                  </Tabs>
                </div>
              </div>
            ) : jdLoading ? null : (
              <div className="h-[300px] flex flex-col items-center justify-center text-muted-foreground">
                <FileText className="h-16 w-16 mb-4 text-muted-foreground" />
                <p>解析结果将在这里显示</p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <JobFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        job={formJob}
        onSaved={reloadJobs}
      />

      <input
        ref={importFileInputRef}
        type="file"
        accept=".pdf,.docx,.doc,.txt,.md"
        multiple
        className="hidden"
        onChange={(event) => {
          const files = Array.from(event.target.files || []);
          if (files.length > 0) {
            // 追加合并而非整批替换：弹窗未关闭时再次选择文件在已有列表上累积
            const merged = mergeResumeImportFiles(importCandidateFiles, files);
            const ignored = merged.unsupported + merged.oversize + merged.duplicates + merged.overflow;
            if (ignored > 0) {
              toast.warning(`已忽略 ${ignored} 个文件（仅支持 PDF/Word/文本，单份不超过 20MB，总量 50 份，重复自动去重）`);
            }
            if (merged.files.length > importCandidateFiles.length) {
              setImportCandidateFiles(merged.files);
              setImportCandidateOpen(true);
            }
          }
          event.target.value = '';
        }}
      />
      <ImportPreviewDialog
        open={importCandidateOpen}
        onOpenChange={(open) => {
          setImportCandidateOpen(open);
          if (!open) {
            setImportCandidateJobId(null);
            setImportCandidateFiles([]);
          }
        }}
        files={importCandidateFiles}
        lockedJobId={
          importCandidateJobId ?? editingJobId ?? jobs[0]?.id ?? null
        }
        onImported={reloadCandidates}
        onRemoveFile={(file) =>
          setImportCandidateFiles((previous) =>
            previous.filter((item) => item !== file),
          )
        }
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
              variant="destructive"
              disabled={deleting}
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
