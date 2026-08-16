'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import NextImage from 'next/image';
import { toast } from 'sonner';
import {
  Search,
  Loader2,
  Users,
  FileText,
  ExternalLink,
  Globe,
  AlertCircle,
  CheckCircle2,
  Image as ImageIcon,
  Clock,
  Monitor,
  RefreshCw,
  Trash2,
  Download,
  Eye,
  MessageCircle,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { authFetch } from '@/lib/auth-client';

interface KeywordGroup {
  keyword: string;
  count: number;
  purpose: string;
}

interface CandidateResult {
  global_index: number;
  name: string;
  company_title: string;
  has_structured_resume: boolean;
  resume_text_chars: number;
  resume_preview_url: string | null;
  resume_download_url: string | null;
  screenshot_count: number;
  screenshots: string[];
  status: string;
  contact_request_id: string | null;
  contact_status: 'requested' | 'opening' | 'opened' | 'closed' | 'error' | null;
  contact_error: string | null;
  contact_opened_at: string | null;
  contact_closed_at: string | null;
}

type TaskStatus = 'pending' | 'running' | 'login_required' | 'done' | 'error' | 'canceled';

interface TaskStatusData {
  taskId: string;
  status: TaskStatus;
  expectedCount: number;
  totalCandidates: number;
  invalidCount: number;
  taskDir: string | null;
  errorMessage: string | null;
  reportRequested: boolean;
  reportStatus: string | null;
  candidates: CandidateResult[];
  createdAt: string;
  finishedAt: string | null;
}

const STATUS_LABELS: Record<TaskStatus, string> = {
  pending: '等待本地 Worker',
  running: '正在搜索',
  login_required: '需要登录 Boss',
  done: '搜索完成',
  error: '搜索失败',
  canceled: '已取消',
};

const STATUS_COLORS: Record<TaskStatus, string> = {
  pending: 'bg-gray-100 text-gray-600',
  running: 'bg-blue-100 text-blue-600',
  login_required: 'bg-amber-100 text-amber-600',
  done: 'bg-emerald-100 text-emerald-600',
  error: 'bg-red-100 text-red-600',
  canceled: 'bg-slate-100 text-slate-600',
};

export default function BossSearchPage() {
  const [jdText, setJdText] = useState('');
  const [keywords, setKeywords] = useState<KeywordGroup[]>([]);
  const [keywordLoading, setKeywordLoading] = useState(false);
  const [keywordPreview, setKeywordPreview] = useState('');
  const [taskStatus, setTaskStatus] = useState<TaskStatusData | null>(null);
  const [creating, setCreating] = useState(false);
  const [resumeCandidate, setResumeCandidate] = useState<CandidateResult | null>(null);
  const [resumeText, setResumeText] = useState('');
  const [resumeImages, setResumeImages] = useState<string[]>([]);
  const [resumeLoading, setResumeLoading] = useState(false);
  const [resumeDownloadIndex, setResumeDownloadIndex] = useState<number | null>(null);
  const [contactActionIndex, setContactActionIndex] = useState<number | null>(null);
  const [reportAction, setReportAction] = useState<'view' | 'download' | null>(null);
  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const contactPollTimersRef = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map());
  const resumeObjectUrlsRef = useRef<string[]>([]);
  const resumeRequestRef = useRef(0);

  const clearResumeObjectUrls = useCallback(() => {
    resumeObjectUrlsRef.current.forEach(url => URL.revokeObjectURL(url));
    resumeObjectUrlsRef.current = [];
    setResumeText('');
    setResumeImages([]);
  }, []);

  // 清理轮询
  useEffect(() => {
    const contactPollTimers = contactPollTimersRef.current;
    return () => {
      if (pollRef.current) clearTimeout(pollRef.current);
      contactPollTimers.forEach(timer => clearTimeout(timer));
      contactPollTimers.clear();
      resumeObjectUrlsRef.current.forEach(url => URL.revokeObjectURL(url));
    };
  }, []);

  const generateKeywords = useCallback(async () => {
    if (!jdText.trim()) {
      toast.error('请输入职位描述');
      return;
    }
    setKeywordLoading(true);
    setKeywordPreview('');
    try {
      const res = await authFetch('/api/boss-search/keywords', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jdContent: jdText }),
      });
      const contentType = res.headers.get('content-type') ?? '';
      if (!res.ok) {
        const json = await res.json().catch(() => null) as { error?: string } | null;
        throw new Error(json?.error || '关键词生成失败');
      }
      // JSON 响应：限流 / AI 未启用等前置错误
      if (contentType.includes('application/json')) {
        const json = await res.json();
        if (json.success) {
          setKeywords(json.data.keywords);
          toast.success(`已生成 ${json.data.keywords.length} 组搜索关键词`);
        } else {
          toast.error(json.error || '关键词生成失败');
        }
        return;
      }
      // NDJSON 流式：delta 为生成过程，done 携带最终结果
      const reader = res.body?.getReader();
      if (!reader) throw new Error('关键词生成失败');
      const decoder = new TextDecoder();
      let buffer = '';
      let accumulated = '';
      const outcome: { keywords?: KeywordGroup[]; error?: string } = {};
      const handleLine = (line: string) => {
        if (!line.trim()) return;
        const event: { type?: string; text?: string; data?: { keywords?: KeywordGroup[] }; error?: string } = JSON.parse(line);
        if (event.type === 'delta' && event.text) {
          accumulated += event.text;
          setKeywordPreview(accumulated);
        } else if (event.type === 'done' && event.data) {
          outcome.keywords = event.data.keywords;
        } else if (event.type === 'error') {
          outcome.error = event.error || '关键词生成失败';
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
      if (!outcome.keywords) throw new Error('关键词生成失败');
      setKeywords(outcome.keywords);
      toast.success(`已生成 ${outcome.keywords.length} 组搜索关键词`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '关键词生成失败，请稍后重试');
    } finally {
      setKeywordLoading(false);
      setKeywordPreview('');
    }
  }, [jdText]);

  const updateKeyword = useCallback((index: number, updates: Partial<Pick<KeywordGroup, 'keyword' | 'count'>>) => {
    setKeywords(current => current.map((keyword, keywordIndex) => (
      keywordIndex === index ? { ...keyword, ...updates } : keyword
    )));
  }, []);

  const removeKeyword = useCallback((index: number) => {
    if (keywords.length <= 1) {
      toast.error('至少保留一组搜索关键词');
      return;
    }
    setKeywords(current => current.filter((_, keywordIndex) => keywordIndex !== index));
  }, [keywords.length]);

  const startPolling = useCallback((taskId: string) => {
    const poll = async () => {
      try {
        const res = await authFetch(`/api/boss-search/status?taskId=${taskId}`);
        const json = await res.json();
        if (json.success) {
          const data = json.data as TaskStatusData;
          setTaskStatus(data);

          // 终态：停止轮询
          if (['done', 'error', 'login_required', 'canceled'].includes(data.status)) {
            if (data.status === 'done') {
              toast.success(`搜索完成，共获取 ${data.totalCandidates} 位候选人`);
            } else if (data.status === 'login_required') {
              toast.error('需要在本机重新扫码登录 Boss 直聘');
            } else if (data.status === 'error') {
              toast.error(data.errorMessage || '搜索失败');
            }
            return;
          }
        }
      } catch {
        // 网络错误，继续轮询
      }
      pollRef.current = setTimeout(poll, 4000);
    };
    poll();
  }, []);

  const executeSearch = useCallback(async () => {
    if (keywords.length === 0) {
      toast.error('请先生成搜索关键词');
      return;
    }
    const normalizedKeywords = keywords.map(keyword => ({
      keyword: keyword.keyword.trim(),
      count: keyword.count,
    }));
    if (normalizedKeywords.some(keyword => !keyword.keyword)) {
      toast.error('搜索关键词不能为空');
      return;
    }
    if (normalizedKeywords.some(keyword => !Number.isInteger(keyword.count) || keyword.count < 1)) {
      toast.error('每组搜索人数必须是大于 0 的整数');
      return;
    }
    setCreating(true);
    setTaskStatus(null);
    try {
      const res = await authFetch('/api/boss-search/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          keywords: normalizedKeywords,
          jdContent: jdText,
        }),
      });
      const json = await res.json();
      if (json.success) {
        toast.success('搜索任务已创建，等待本地 Worker 执行');
        const taskId = json.data.taskId as string;
        window.history.replaceState(null, '', `/boss-search?taskId=${encodeURIComponent(taskId)}`);
        startPolling(taskId);
      } else {
        toast.error(json.error || '任务创建失败');
      }
    } catch {
      toast.error('任务创建失败，请稍后重试');
    } finally {
      setCreating(false);
    }
  }, [keywords, jdText, startPolling]);

  useEffect(() => {
    const taskId = new URLSearchParams(window.location.search).get('taskId');
    if (taskId) {
      startPolling(taskId);
    }
  }, [startPolling]);

  const closeResumeViewer = useCallback(() => {
    resumeRequestRef.current += 1;
    clearResumeObjectUrls();
    setResumeLoading(false);
    setResumeCandidate(null);
  }, [clearResumeObjectUrls]);

  const viewResume = useCallback(async (candidate: CandidateResult) => {
    if (!candidate.resume_preview_url && candidate.screenshots.length === 0) {
      toast.error('该候选人没有可查看的简历');
      return;
    }

    resumeRequestRef.current += 1;
    const requestId = resumeRequestRef.current;
    clearResumeObjectUrls();
    setResumeCandidate(candidate);
    setResumeLoading(true);
    try {
      if (candidate.resume_preview_url) {
        const separator = candidate.resume_preview_url.includes('?') ? '&' : '?';
        const response = await authFetch(`${candidate.resume_preview_url}${separator}format=json`);
        const body = await response.json() as {
          success?: boolean;
          data?: { text?: string };
          error?: string;
        };
        if (!response.ok || !body.success || typeof body.data?.text !== 'string') {
          throw new Error(body.error || '结构化简历加载失败');
        }
        if (requestId !== resumeRequestRef.current) return;
        setResumeText(body.data.text);
        return;
      }

      const blobs = await Promise.all(candidate.screenshots.map(async url => {
        const response = await authFetch(url);
        if (!response.ok) {
          const body = await response.json().catch(() => null) as { error?: string } | null;
          throw new Error(body?.error || '简历截图加载失败');
        }
        return response.blob();
      }));
      if (requestId !== resumeRequestRef.current) return;
      const objectUrls = blobs.map(blob => URL.createObjectURL(blob));
      resumeObjectUrlsRef.current = objectUrls;
      setResumeImages(objectUrls);
    } catch (error) {
      if (requestId === resumeRequestRef.current) {
        toast.error(error instanceof Error ? error.message : '简历截图加载失败');
      }
    } finally {
      if (requestId === resumeRequestRef.current) {
        setResumeLoading(false);
      }
    }
  }, [clearResumeObjectUrls]);

  const downloadResume = useCallback(async (candidate: CandidateResult) => {
    if (!candidate.resume_download_url || resumeDownloadIndex !== null) return;
    setResumeDownloadIndex(candidate.global_index);
    try {
      const response = await authFetch(candidate.resume_download_url);
      if (!response.ok) {
        const body = await response.json().catch(() => null) as { error?: string } | null;
        throw new Error(body?.error || '简历下载失败');
      }
      const blobUrl = URL.createObjectURL(await response.blob());
      const link = document.createElement('a');
      link.href = blobUrl;
      link.download = `${candidate.name}-结构化简历.html`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(blobUrl), 60_000);
      toast.success('简历已开始下载');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '简历下载失败');
    } finally {
      setResumeDownloadIndex(null);
    }
  }, [resumeDownloadIndex]);

  const updateCandidateContact = useCallback((
    candidateIndex: number,
    updates: Partial<Pick<
      CandidateResult,
      'contact_request_id' | 'contact_status' | 'contact_error' | 'contact_opened_at' | 'contact_closed_at'
    >>,
  ) => {
    setTaskStatus(current => current ? {
      ...current,
      candidates: current.candidates.map(candidate => (
        candidate.global_index === candidateIndex
          ? { ...candidate, ...updates }
          : candidate
      )),
    } : current);
  }, []);

  const requestContact = useCallback(async (candidate: CandidateResult) => {
    if (!taskStatus?.taskId || contactActionIndex !== null) return;
    setContactActionIndex(candidate.global_index);
    try {
      const response = await authFetch('/api/boss-search/contact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          taskId: taskStatus.taskId,
          candidateIndex: candidate.global_index,
        }),
      });
      const body = await response.json() as {
        success?: boolean;
        data?: { requestId?: string; status?: CandidateResult['contact_status'] };
        error?: string;
      };
      const requestId = body.data?.requestId;
      if (!response.ok || !body.success || !requestId) {
        throw new Error(body.error || '联系请求创建失败');
      }

      updateCandidateContact(candidate.global_index, {
        contact_request_id: requestId,
        contact_status: body.data?.status || 'requested',
        contact_error: null,
      });
      toast.success('已通知 Mac mini，正在打开该候选人的 Boss 页面');

      const pollContact = async (attempt: number) => {
        try {
          const pollResponse = await authFetch(
            `/api/boss-search/contact?requestId=${encodeURIComponent(requestId)}`,
          );
          const pollBody = await pollResponse.json() as {
            success?: boolean;
            data?: {
              status?: CandidateResult['contact_status'];
              errorMessage?: string | null;
              openedAt?: string | null;
              closedAt?: string | null;
            };
            error?: string;
          };
          if (!pollResponse.ok || !pollBody.success || !pollBody.data?.status) {
            throw new Error(pollBody.error || '联系状态查询失败');
          }

          updateCandidateContact(candidate.global_index, {
            contact_status: pollBody.data.status,
            contact_error: pollBody.data.errorMessage || null,
            contact_opened_at: pollBody.data.openedAt || null,
            contact_closed_at: pollBody.data.closedAt || null,
          });
          if (pollBody.data.status === 'opened') {
            toast.success('已在 Mac mini 的 Boss 中打开候选人，请通过远程桌面联系');
            return;
          }
          if (pollBody.data.status === 'error') {
            toast.error(pollBody.data.errorMessage || '打开候选人失败');
            return;
          }
          if (pollBody.data.status === 'closed') return;
        } catch (error) {
          if (attempt >= 20) {
            toast.error(error instanceof Error ? error.message : '联系状态查询失败');
            return;
          }
        }

        if (attempt < 60) {
          const timer = setTimeout(() => pollContact(attempt + 1), 2000);
          contactPollTimersRef.current.set(candidate.global_index, timer);
        }
      };
      void pollContact(0);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '联系请求失败');
    } finally {
      setContactActionIndex(null);
    }
  }, [contactActionIndex, taskStatus, updateCandidateContact]);

  const handleReport = useCallback(async (action: 'view' | 'download') => {
    if (!taskStatus?.taskId || reportAction) return;

    const reportWindow = action === 'view' ? window.open('', '_blank') : null;
    if (action === 'view' && !reportWindow) {
      toast.error('浏览器阻止了新窗口，请允许弹出窗口后重试');
      return;
    }
    if (reportWindow) {
      reportWindow.opener = null;
      reportWindow.document.title = '正在生成候选人报告';
      reportWindow.document.body.textContent = '正在生成候选人报告，请稍候…';
    }

    setReportAction(action);
    try {
      const suffix = action === 'download' ? '?download=1' : '';
      const response = await authFetch(`/api/boss-search/tasks/${encodeURIComponent(taskStatus.taskId)}/report${suffix}`);
      if (!response.ok) {
        const body = await response.json().catch(() => null) as { error?: string } | null;
        throw new Error(body?.error || '报告生成失败');
      }
      const blobUrl = URL.createObjectURL(await response.blob());
      if (action === 'view' && reportWindow) {
        reportWindow.location.href = blobUrl;
      } else {
        const link = document.createElement('a');
        link.href = blobUrl;
        link.download = `Boss候选人报告-${taskStatus.taskId.slice(0, 8)}.html`;
        document.body.appendChild(link);
        link.click();
        link.remove();
        toast.success('报告已开始下载');
      }
      window.setTimeout(() => URL.revokeObjectURL(blobUrl), 60_000);
    } catch (error) {
      reportWindow?.close();
      toast.error(error instanceof Error ? error.message : '报告生成失败');
    } finally {
      setReportAction(null);
    }
  }, [reportAction, taskStatus]);

  const totalExpected = keywords.reduce((sum, k) => sum + k.count, 0);

  const isRunning = taskStatus && ['pending', 'running'].includes(taskStatus.status);

  return (
    <>
      <div className="mb-6">
        <h1 className="text-xl font-semibold flex items-center gap-2">
          <Globe className="h-5 w-5 text-blue-500" />
          Boss直聘候选人搜索
        </h1>
        <p className="text-sm text-gray-500 mt-0.5">JD &rarr; 关键词策略 &rarr; 简历爬取 &rarr; 评估报告</p>
      </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left: JD Input & Keywords */}
          <div className="lg:col-span-2 space-y-6">
            {/* Step 1: JD Input */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <span className="flex h-6 w-6 items-center justify-center rounded-full bg-blue-100 text-blue-600 text-sm font-bold">1</span>
                  粘贴职位描述 (JD)
                </CardTitle>
              </CardHeader>
              <CardContent>
                <Textarea
                  value={jdText}
                  onChange={e => setJdText(e.target.value)}
                  placeholder="粘贴完整JD，包括职位名称、技术要求、经验要求、薪资范围、城市等信息..."
                  className="min-h-[140px] resize-none"
                />
                <Button
                  className="mt-3"
                  onClick={generateKeywords}
                  disabled={keywordLoading || !jdText.trim()}
                >
                  {keywordLoading ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      正在生成关键词策略...
                    </>
                  ) : (
                    <>
                      <Search className="h-4 w-4 mr-2" />
                      AI生成搜索关键词策略
                    </>
                  )}
                </Button>
                {keywordLoading && (
                  <div className="mt-3 max-h-32 overflow-y-auto rounded-lg bg-muted/50 p-3">
                    <p className="mb-1 text-xs text-muted-foreground">
                      正在分析职位要求并拆解搜索关键词，过程实时显示：
                    </p>
                    <pre className="whitespace-pre-wrap break-words font-sans text-xs text-muted-foreground">
                      {keywordPreview || '正在连接模型…'}
                    </pre>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Step 2: Keywords */}
            {keywords.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-base flex items-center gap-2">
                    <span className="flex h-6 w-6 items-center justify-center rounded-full bg-blue-100 text-blue-600 text-sm font-bold">2</span>
                    搜索关键词策略
                    <Badge variant="secondary" className="ml-1">共 {totalExpected} 人</Badge>
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2">
                    {keywords.map((kw, idx) => (
                      <div
                        key={idx}
                        className="grid grid-cols-1 gap-3 rounded-lg border border-gray-100 bg-gray-50 p-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center"
                      >
                        <div className="min-w-0">
                          <Label htmlFor={`boss-keyword-${idx}`} className="sr-only">
                            第 {idx + 1} 组搜索关键词
                          </Label>
                          <Input
                            id={`boss-keyword-${idx}`}
                            value={kw.keyword}
                            onChange={event => updateKeyword(idx, { keyword: event.target.value })}
                            aria-invalid={!kw.keyword.trim()}
                            className="bg-white font-medium"
                            disabled={creating || isRunning === true}
                          />
                          <div className="text-xs text-gray-500 mt-0.5">{kw.purpose}</div>
                        </div>
                        <div className="flex items-center gap-2">
                          <div className="relative min-w-0 flex-1 sm:w-28 sm:flex-none">
                            <Label htmlFor={`boss-count-${idx}`} className="sr-only">
                              第 {idx + 1} 组搜索人数
                            </Label>
                            <Input
                              id={`boss-count-${idx}`}
                              type="number"
                              min={1}
                              max={10}
                              step={1}
                              value={kw.count}
                              onChange={event => updateKeyword(idx, {
                                count: Number.isNaN(event.target.valueAsNumber) ? 0 : event.target.valueAsNumber,
                              })}
                              onBlur={event => {
                                const count = event.target.valueAsNumber;
                                if (!Number.isInteger(count) || count < 1 || count > 10) {
                                  updateKeyword(idx, { count: Math.min(10, Math.max(1, Math.round(count) || 1)) });
                                }
                              }}
                              aria-invalid={!Number.isInteger(kw.count) || kw.count < 1}
                              className="bg-white pr-9 text-right tabular-nums"
                              disabled={creating || isRunning === true}
                            />
                            <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm text-gray-500">
                              人
                            </span>
                          </div>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            onClick={() => removeKeyword(idx)}
                            disabled={creating || isRunning === true}
                            aria-label={`删除第 ${idx + 1} 组搜索关键词`}
                            title="删除该关键词"
                            className="shrink-0 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                  <Button
                    className="mt-4 w-full"
                    size="lg"
                    onClick={executeSearch}
                    disabled={creating || isRunning === true}
                  >
                    {creating ? (
                      <>
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        正在创建任务...
                      </>
                    ) : isRunning === true ? (
                      <>
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        搜索进行中...
                      </>
                    ) : (
                      <>
                        <Users className="h-4 w-4 mr-2" />
                        确认并创建搜索任务 ({totalExpected} 人)
                      </>
                    )}
                  </Button>
                </CardContent>
              </Card>
            )}

            {/* Step 3: Task Status & Results */}
            {taskStatus && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-base flex items-center gap-2">
                    <span className="flex h-6 w-6 items-center justify-center rounded-full bg-emerald-100 text-emerald-600 text-sm font-bold">3</span>
                    搜索结果
                    <Badge className={`ml-1 ${STATUS_COLORS[taskStatus.status]}`}>
                      {STATUS_LABELS[taskStatus.status]}
                    </Badge>
                    {taskStatus.status === 'done' && taskStatus.totalCandidates > 0 && (
                      <Badge variant="default">{taskStatus.totalCandidates} 位候选人</Badge>
                    )}
                    {taskStatus.invalidCount > 0 && (
                      <Badge variant="destructive">{taskStatus.invalidCount} 人爬取失败</Badge>
                    )}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {/* 等待 Worker 提示 */}
                  {taskStatus.status === 'pending' && (
                    <div className="flex flex-col items-center justify-center py-8 gap-3">
                      <div className="flex items-center gap-2 text-gray-500">
                        <Clock className="h-5 w-5 animate-pulse" />
                        <span>等待本地 Worker 认领任务...</span>
                      </div>
                      <p className="text-sm text-gray-400">
                        请确保本地已启动 Worker：<code className="bg-gray-100 px-1.5 py-0.5 rounded text-xs">cd assets &amp;&amp; uv run boss_worker.py</code>
                      </p>
                    </div>
                  )}

                  {/* 搜索中提示 */}
                  {taskStatus.status === 'running' && (
                    <div className="flex flex-col items-center justify-center py-8 gap-3">
                      <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
                      <p className="text-sm text-gray-500">本地 Worker 正在爬取候选人简历...</p>
                    </div>
                  )}

                  {/* 需要登录 */}
                  {taskStatus.status === 'login_required' && (
                    <div className="flex flex-col items-center justify-center py-8 gap-3">
                      <div className="flex items-center gap-2 text-amber-600">
                        <AlertCircle className="h-6 w-6" />
                        <span className="font-medium">需要重新登录 Boss 直聘</span>
                      </div>
                      <p className="text-sm text-gray-500">
                        请在本机运行：<code className="bg-gray-100 px-1.5 py-0.5 rounded text-xs">cd assets &amp;&amp; uv run boss.py login</code>
                      </p>
                      <p className="text-sm text-gray-400">登录完成后，点击下方按钮重试</p>
                      <Button
                        size="sm"
                        onClick={() => startPolling(taskStatus.taskId)}
                      >
                        <RefreshCw className="h-4 w-4 mr-2" />
                        重新检查状态
                      </Button>
                    </div>
                  )}

                  {/* 错误 */}
                  {taskStatus.status === 'error' && (
                    <div className="flex flex-col items-center justify-center py-8 gap-3">
                      <div className="flex items-center gap-2 text-red-600">
                        <AlertCircle className="h-6 w-6" />
                        <span className="font-medium">搜索失败</span>
                      </div>
                      {taskStatus.errorMessage && (
                        <p className="text-sm text-gray-500 max-w-md text-center">{taskStatus.errorMessage}</p>
                      )}
                    </div>
                  )}

                  {/* 搜索完成 - 候选人列表 */}
                  {taskStatus.status === 'done' && taskStatus.candidates.length > 0 && (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3 max-h-[400px] overflow-y-auto">
                      {taskStatus.candidates.map(cand => (
                        <div key={cand.global_index} className="flex items-start gap-3 p-3 rounded-lg border border-gray-100">
                          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-gray-100 text-xs font-bold text-gray-600 shrink-0">
                            {cand.global_index}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="font-medium text-sm truncate">{cand.name}</div>
                            <div className="text-xs text-gray-500 truncate">{cand.company_title}</div>
                            {cand.has_structured_resume ? (
                              <div className="flex items-center gap-1 mt-1">
                                <FileText className="h-3 w-3 text-emerald-500" />
                                <span className="text-xs text-emerald-600">
                                  可复制文本 · {cand.resume_text_chars} 字
                                </span>
                              </div>
                            ) : cand.screenshot_count > 0 && (
                              <div className="flex items-center gap-1 mt-1">
                                <ImageIcon className="h-3 w-3 text-gray-400" />
                                <span className="text-xs text-gray-400">仅有 {cand.screenshot_count} 张截图备份</span>
                              </div>
                            )}
                            <div className="mt-2 flex flex-wrap gap-2">
                              <Button
                                type="button"
                                size="sm"
                                className="h-8"
                                onClick={() => viewResume(cand)}
                                disabled={!cand.resume_preview_url && cand.screenshots.length === 0}
                                aria-label={`查看 ${cand.name} 的简历`}
                              >
                                <Eye className="h-3.5 w-3.5" />
                                {cand.has_structured_resume ? '在线简历' : '查看截图'}
                              </Button>
                              {cand.resume_download_url && (
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="sm"
                                  className="h-8"
                                  onClick={() => downloadResume(cand)}
                                  disabled={resumeDownloadIndex !== null}
                                  aria-label={`下载 ${cand.name} 的结构化简历`}
                                >
                                  {resumeDownloadIndex === cand.global_index ? (
                                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                  ) : (
                                    <Download className="h-3.5 w-3.5" />
                                  )}
                                  下载简历
                                </Button>
                              )}
                              <Button
                                type="button"
                                variant="default"
                                size="sm"
                                className="h-8"
                                onClick={() => requestContact(cand)}
                                disabled={
                                  contactActionIndex !== null
                                  || cand.contact_status === 'requested'
                                  || cand.contact_status === 'opening'
                                  || cand.contact_status === 'opened'
                                }
                                aria-label={`在 Boss 联系 ${cand.name}`}
                              >
                                {contactActionIndex === cand.global_index
                                  || cand.contact_status === 'requested'
                                  || cand.contact_status === 'opening' ? (
                                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                  ) : (
                                    <MessageCircle className="h-3.5 w-3.5" />
                                  )}
                                {cand.contact_status === 'opened'
                                  ? '已在Mac打开'
                                  : cand.contact_status === 'error'
                                    ? '重试联系'
                                    : '在Boss联系'}
                              </Button>
                            </div>
                            {cand.contact_status === 'opened' && (
                              <p className="mt-1 text-xs text-blue-600">
                                请在 Mac mini 远程桌面中使用 Boss 站内沟通
                              </p>
                            )}
                            {cand.contact_status === 'error' && cand.contact_error && (
                              <p className="mt-1 text-xs text-red-500">{cand.contact_error}</p>
                            )}
                          </div>
                          {cand.status === 'done' || cand.status === 'ok' ? (
                            <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0" />
                          ) : (
                            <AlertCircle className="h-4 w-4 text-amber-500 shrink-0" />
                          )}
                        </div>
                      ))}
                    </div>
                  )}

                  {/* 搜索完成但无候选人 */}
                  {taskStatus.status === 'done' && taskStatus.candidates.length === 0 && (
                    <div className="flex flex-col items-center justify-center py-8 gap-2">
                      <CheckCircle2 className="h-8 w-8 text-emerald-500" />
                      <p className="text-sm text-gray-500">搜索已完成，但未获取到有效候选人</p>
                    </div>
                  )}
                </CardContent>
              </Card>
            )}
          </div>

          {/* Right: Sidebar */}
          <div className="space-y-6">
            {/* 架构说明 */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">使用说明</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm text-gray-600">
                <div className="flex gap-2">
                  <span className="font-bold text-gray-400 shrink-0">1.</span>
                  <span>粘贴完整 JD，系统自动生成搜索关键词策略</span>
                </div>
                <div className="flex gap-2">
                  <span className="font-bold text-gray-400 shrink-0">2.</span>
                  <span>确认关键词后，创建搜索任务加入队列</span>
                </div>
                <div className="flex gap-2">
                  <span className="font-bold text-gray-400 shrink-0">3.</span>
                  <span>本地 Worker 自动认领任务，保存可搜索的结构化简历，截图仅作失败回退</span>
                </div>
                <div className="flex gap-2">
                  <span className="font-bold text-gray-400 shrink-0">4.</span>
                  <span>搜索完成后生成六维评估、批次画像和市场观察报告</span>
                </div>
              </CardContent>
            </Card>

            {/* 环境要求 */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">本地环境要求</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <div className="flex items-center gap-2">
                  <Monitor className="h-4 w-4 text-gray-400" />
                  <span className="text-gray-600">需要桌面环境运行 Worker</span>
                </div>
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                  <span className="text-gray-600">Python + uv 已安装</span>
                </div>
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                  <span className="text-gray-600">Boss 直聘登录态有效</span>
                </div>
                <div className="mt-3 p-3 rounded-lg bg-blue-50 border border-blue-100">
                  <p className="text-xs text-blue-700">
                    <AlertCircle className="h-3 w-3 inline mr-1" />
                    首次使用请在本机执行：
                  </p>
                  <ol className="text-xs text-blue-600 mt-2 space-y-1 list-decimal list-inside">
                    <li>配置 <code className="bg-blue-100 px-1 rounded">.env.worker</code></li>
                    <li><code className="bg-blue-100 px-1 rounded">uv run boss.py login</code></li>
                    <li><code className="bg-blue-100 px-1 rounded">uv run boss_worker.py</code></li>
                  </ol>
                </div>
              </CardContent>
            </Card>

            {/* 报告按钮 */}
            {taskStatus?.status === 'done' && (
              <Card className="border-blue-200 bg-blue-50">
                <CardContent className="pt-4">
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    <Button
                      size="lg"
                      onClick={() => handleReport('view')}
                      disabled={reportAction !== null}
                    >
                      {reportAction === 'view' ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <FileText className="h-4 w-4" />
                      )}
                      在线查看报告
                      <ExternalLink className="h-3 w-3" />
                    </Button>
                    <Button
                      size="lg"
                      onClick={() => handleReport('download')}
                      disabled={reportAction !== null}
                    >
                      {reportAction === 'download' ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Download className="h-4 w-4" />
                      )}
                      下载 HTML 报告
                    </Button>
                  </div>
                  <p className="text-xs text-gray-500 mt-2 text-center">
                    candidate-analysis 六维评估报告，包含批次画像、对比矩阵、职业轨迹和市场建议
                  </p>
                </CardContent>
              </Card>
            )}
          </div>
        </div>

      <Dialog
        open={resumeCandidate !== null}
        onOpenChange={open => {
          if (!open) closeResumeViewer();
        }}
      >
        <DialogContent className="max-h-[92vh] overflow-hidden sm:max-w-4xl">
          <DialogHeader>
            <DialogTitle>{resumeCandidate?.name || '候选人简历'}</DialogTitle>
            <DialogDescription>
              {resumeCandidate?.has_structured_resume
                ? `可搜索、复制和打印 · ${resumeCandidate.resume_text_chars} 字`
                : `${resumeCandidate?.screenshot_count || 0} 张截图备份`}
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-[76vh] overflow-y-auto rounded-lg bg-gray-50 p-3">
            {resumeLoading && (
              <div className="flex min-h-52 items-center justify-center gap-2 text-sm text-gray-500">
                <Loader2 className="h-5 w-5 animate-spin" />
                正在加载简历…
              </div>
            )}
            {!resumeLoading && resumeText && (
              <article className="rounded-lg border bg-white px-5 py-6 text-sm leading-7 text-gray-800">
                <pre className="whitespace-pre-wrap break-words font-sans">{resumeText}</pre>
              </article>
            )}
            {!resumeLoading && !resumeText && resumeImages.length === 0 && (
              <div className="flex min-h-52 items-center justify-center text-sm text-gray-500">
                暂无可查看的简历
              </div>
            )}
            {!resumeLoading && !resumeText && resumeImages.length > 0 && (
              <div className="space-y-4">
                {resumeImages.map((src, index) => (
                  <figure key={src} className="overflow-hidden rounded-lg border bg-white">
                    <NextImage
                      src={src}
                      alt={`${resumeCandidate?.name || '候选人'}简历第 ${index + 1} 页`}
                      width={1400}
                      height={1800}
                      unoptimized
                      className="h-auto w-full"
                    />
                    <figcaption className="border-t px-3 py-2 text-center text-xs text-gray-400">
                      第 {index + 1} 页
                    </figcaption>
                  </figure>
                ))}
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
