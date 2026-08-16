'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import {
  ArrowLeft,
  CheckCircle2,
  Clock,
  FileText,
  FileUp,
  KeyRound,
  Loader2,
  Pencil,
  Play,
  RefreshCw,
  Settings,
  Sheet,
  ShieldCheck,
  Trash2,
  XCircle,
} from 'lucide-react';
import { toast } from 'sonner';
import { authFetch } from '@/lib/auth-client';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';

interface CurrentUser {
  id: string;
  name: string;
  email: string;
  role: string;
}

interface GeneratedSummary {
  name: string;
  cell: string;
  summary: string;
  written: boolean;
}

interface BatchResult {
  processed: string[];
  written: string[];
  skipped: string[];
  failed: Array<{ name: string; error: string }>;
  unmatched: string[];
  unmatched_files: string[];
  generated: GeneratedSummary[];
  dry_run: boolean;
}

type TaskStatus = 'uploading' | 'pending' | 'running' | 'done' | 'error';

interface BatchTask {
  taskId: string;
  sheetName: string;
  status: TaskStatus;
  overwrite: boolean;
  dryRun: boolean;
  files: Array<{ name: string; size: number }>;
  logs: string[];
  result: BatchResult | null;
  errorMessage: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
}

interface AdminCredential {
  id: string;
  name: string;
  endpointHost: string;
  createdAt: string;
  updatedAt: string;
}

interface AdminConfig {
  credentials: AdminCredential[];
  llm: {
    configured: boolean;
    apiKeySource: 'database' | 'environment' | 'none';
    resumeAnalysisAllowed: boolean;
    baseUrl: string;
    textModel: string;
    visionModel: string;
    workers: number;
    styleSample: string;
    customStyleSample: boolean;
  };
}

const STATUS_META: Record<TaskStatus, { label: string; className: string }> = {
  uploading: { label: '正在上传', className: 'bg-sky-100 text-sky-700' },
  pending: { label: '等待 Worker', className: 'bg-amber-100 text-amber-700' },
  running: { label: '正在处理', className: 'bg-blue-100 text-blue-700' },
  done: { label: '已完成', className: 'bg-emerald-100 text-emerald-700' },
  error: { label: '失败', className: 'bg-red-100 text-red-700' },
};

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) {
    return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  }
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function formatTime(value: string | null): string {
  if (!value) return '—';
  return new Date(value).toLocaleString('zh-CN', { hour12: false });
}

export default function ResumeBatchPage() {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [sheetUrl, setSheetUrl] = useState('');
  const [worksheetId, setWorksheetId] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [overwrite, setOverwrite] = useState(false);
  const [dryRun, setDryRun] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [tasks, setTasks] = useState<BatchTask[]>([]);
  const [currentTask, setCurrentTask] = useState<BatchTask | null>(null);
  const [loading, setLoading] = useState(true);
  const [adminConfig, setAdminConfig] = useState<AdminConfig | null>(null);
  const [adminSaving, setAdminSaving] = useState(false);
  const [credentialForm, setCredentialForm] = useState({
    id: '',
    name: '',
    mcpUrl: '',
  });
  const [settingsForm, setSettingsForm] = useState({
    apiKey: '',
    baseUrl: '',
    textModel: '',
    visionModel: '',
    workers: '8',
    styleSample: '',
  });

  const folderInputRef = useRef<HTMLInputElement | null>(null);
  // 挂载即启用 directory 模式（浏览器 API 属性非标准，需手动设置；ref 回调避免条件渲染导致 useEffect 时序错配）
  const folderInputRefCallback = useCallback((el: HTMLInputElement | null) => {
    folderInputRef.current = el;
    if (el) {
      el.setAttribute('webkitdirectory', '');
      el.setAttribute('directory', '');
    }
  }, []);

  const loadTasks = useCallback(async () => {
    const response = await authFetch('/api/resume-batch/status');
    const json = await response.json();
    if (!response.ok || !json.success) {
      throw new Error(json.error || '读取任务失败');
    }
    const loaded = json.data as BatchTask[];
    setTasks(loaded);
    setCurrentTask(current => {
      if (!current) return loaded[0] || null;
      return loaded.find(task => task.taskId === current.taskId) || current;
    });
  }, []);

  const loadAdminConfig = useCallback(async () => {
    const response = await authFetch('/api/resume-batch/admin');
    const json = await response.json();
    if (!response.ok || !json.success) {
      throw new Error(json.error || '读取管理员配置失败');
    }
    const config = json.data as AdminConfig;
    setAdminConfig(config);
    setSettingsForm({
      apiKey: '',
      baseUrl: config.llm.baseUrl,
      textModel: config.llm.textModel,
      visionModel: config.llm.visionModel,
      workers: String(config.llm.workers),
      styleSample: config.llm.styleSample,
    });
  }, []);

  useEffect(() => {
    const initialize = async () => {
      setLoading(true);
      try {
        const userResponse = await authFetch('/api/auth/me');
        const userJson = await userResponse.json();
        if (!userResponse.ok || !userJson.success) {
          throw new Error(userJson.error || '登录已过期');
        }
        const loadedUser = userJson.data as CurrentUser;
        setUser(loadedUser);
        await Promise.all([
          loadTasks(),
          loadedUser.role === 'admin' ? loadAdminConfig() : Promise.resolve(),
        ]);
      } catch (error) {
        toast.error(error instanceof Error ? error.message : '页面加载失败');
      } finally {
        setLoading(false);
      }
    };
    initialize();
  }, [loadAdminConfig, loadTasks]);

  const pollTask = useCallback(async (taskId: string) => {
    try {
      const response = await authFetch(
        `/api/resume-batch/status?taskId=${encodeURIComponent(taskId)}`,
      );
      const json = await response.json();
      if (response.ok && json.success) {
        const task = json.data as BatchTask;
        setCurrentTask(task);
        setTasks(current => [
          task,
          ...current.filter(item => item.taskId !== task.taskId),
        ].slice(0, 20));
        if (task.status === 'done') {
          toast.success(task.dryRun ? '试运行完成' : '推荐理由写入完成');
          return;
        }
        if (task.status === 'error') {
          toast.error(task.errorMessage || '简历批处理失败');
          return;
        }
      }
    } catch {
      // 短暂网络异常时继续轮询。
    }
    pollRef.current = setTimeout(() => pollTask(taskId), 2000);
  }, []);

  useEffect(() => () => {
    if (pollRef.current) clearTimeout(pollRef.current);
  }, []);

  const handleFiles = (selected: FileList | null) => {
    const pdfs = Array.from(selected || []).filter(file => (
      file.name.toLowerCase().endsWith('.pdf')
    ));
    setFiles(pdfs);
    if (selected && pdfs.length !== selected.length) {
      toast.warning(`已忽略 ${selected.length - pdfs.length} 个非 PDF 文件`);
    }
  };

  const submitTask = async () => {
    if (!sheetUrl.trim()) {
      toast.error('请粘贴钉钉表格链接');
      return;
    }
    if (files.length === 0) {
      toast.error('请选择至少一份 PDF 简历');
      return;
    }

    setSubmitting(true);
    try {
      const formData = new FormData();
      formData.set('sheetUrl', sheetUrl.trim());
      formData.set('worksheetId', worksheetId.trim());
      formData.set('overwrite', String(overwrite));
      formData.set('dryRun', String(dryRun));
      files.forEach(file => formData.append('files', file, file.name));
      const response = await authFetch('/api/resume-batch/submit', {
        method: 'POST',
        body: formData,
      });
      const json = await response.json();
      if (!response.ok || !json.success) {
        throw new Error(json.error || '任务提交失败');
      }
      const taskId = String(json.data.taskId);
      toast.success(`已提交 ${files.length} 份简历，正在自动识别表格组织`);
      if (pollRef.current) clearTimeout(pollRef.current);
      await loadTasks();
      pollTask(taskId);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '任务提交失败');
    } finally {
      setSubmitting(false);
    }
  };

  const runAdminAction = async (body: Record<string, string>) => {
    setAdminSaving(true);
    try {
      const response = await authFetch('/api/resume-batch/admin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = await response.json();
      if (!response.ok || !json.success) {
        throw new Error(json.error || '保存失败');
      }
      await loadAdminConfig();
      toast.success(json.data?.message || '配置已保存');
      return true;
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '保存失败');
      return false;
    } finally {
      setAdminSaving(false);
    }
  };

  const saveCredential = async () => {
    const saved = await runAdminAction({
      action: 'save_credential',
      id: credentialForm.id,
      name: credentialForm.name,
      mcpUrl: credentialForm.mcpUrl,
    });
    if (saved) {
      setCredentialForm({ id: '', name: '', mcpUrl: '' });
    }
  };

  const saveSettings = async () => {
    const saved = await runAdminAction({
      action: 'save_settings',
      ...settingsForm,
    });
    if (saved) {
      setSettingsForm(current => ({ ...current, apiKey: '' }));
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="sticky top-0 z-40 border-b bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3">
          <div className="flex items-center gap-3">
            <Link href="/" aria-label="返回人才决策Agent">
              <Button variant="ghost" size="icon">
                <ArrowLeft className="h-5 w-5" />
              </Button>
            </Link>
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-600 text-white">
              <FileUp className="h-5 w-5" />
            </div>
            <div>
              <h1 className="font-semibold text-slate-900">简历批处理</h1>
              <p className="text-xs text-slate-500">PDF 提取 · AI 推荐理由 · 钉钉写回</p>
            </div>
          </div>
          <div className="text-right">
            <p className="text-sm font-medium">{user?.name}</p>
            <p className="text-xs text-slate-500">{user?.role === 'admin' ? '管理员' : 'HR'}</p>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-6">
        <Tabs defaultValue="batch" className="space-y-6">
          <TabsList>
            <TabsTrigger value="batch" className="gap-2">
              <FileUp className="h-4 w-4" />
              批量处理
            </TabsTrigger>
            {user?.role === 'admin' && (
              <TabsTrigger value="admin" className="gap-2">
                <Settings className="h-4 w-4" />
                管理员配置
              </TabsTrigger>
            )}
          </TabsList>

          <TabsContent value="batch" className="space-y-6">
            <div className="grid gap-6 lg:grid-cols-[minmax(0,1.35fr)_minmax(320px,0.65fr)]">
              <Card>
                <CardHeader>
                  <CardTitle>上传候选人简历</CardTitle>
                  <CardDescription>
                    PDF 文件名需与钉钉表格“姓名”列一致，例如“张三.pdf”
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-5">
                  <div className="space-y-2">
                    <Label htmlFor="sheet-url">钉钉表格链接</Label>
                    <div className="relative">
                      <Sheet className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
                      <Input
                        id="sheet-url"
                        className="pl-9"
                        value={sheetUrl}
                        placeholder="粘贴钉钉表格链接，系统会自动识别所属组织"
                        onChange={event => setSheetUrl(event.target.value)}
                      />
                    </div>
                    <p className="text-xs text-slate-500">
                      无需选择组织；系统会依次验证管理员配置的 MCP 凭证。
                    </p>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="worksheet-id">工作表 ID（可选）</Label>
                    <Input
                      id="worksheet-id"
                      value={worksheetId}
                      placeholder="留空时使用第一个工作表"
                      onChange={event => setWorksheetId(event.target.value)}
                    />
                  </div>

                      <div className="space-y-3">
                        <Label>简历 PDF</Label>
                        <div
                          className="flex min-h-36 cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed border-blue-200 bg-blue-50/40 px-6 py-8 text-center transition hover:bg-blue-50"
                          onClick={() => fileInputRef.current?.click()}
                          role="button"
                          tabIndex={0}
                          onKeyDown={event => {
                            if (event.key === 'Enter') fileInputRef.current?.click();
                          }}
                        >
                          <FileUp className="mb-3 h-9 w-9 text-blue-500" />
                          <span className="font-medium text-slate-800">
                            点击选择一份或多份 PDF，或
                            <span
                              role="button"
                              tabIndex={0}
                              className="text-blue-600 hover:underline"
                              onClick={event => {
                                event.stopPropagation();
                                folderInputRef.current?.click();
                              }}
                              onKeyDown={event => {
                                if (event.key === 'Enter') {
                                  event.stopPropagation();
                                  folderInputRef.current?.click();
                                }
                              }}
                            >
                              选择整个文件夹
                            </span>
                          </span>
                          <span className="mt-1 text-xs text-slate-500">
                            单次最多 50 份，每份不超过 30MB
                          </span>
                        </div>
                        <input
                          ref={fileInputRef}
                          type="file"
                          accept=".pdf,application/pdf"
                          multiple
                          className="sr-only"
                          onChange={event => handleFiles(event.target.files)}
                        />
                        <input
                          ref={folderInputRefCallback}
                          type="file"
                          multiple
                          className="sr-only"
                          onChange={event => handleFiles(event.target.files)}
                        />
                        {files.length > 0 && (
                          <div className="rounded-lg border bg-white p-3">
                            <div className="mb-2 flex items-center justify-between text-sm">
                              <span className="font-medium">已选择 {files.length} 份 PDF</span>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => {
                                  setFiles([]);
                                  if (fileInputRef.current) fileInputRef.current.value = '';
                                }}
                              >
                                清空
                              </Button>
                            </div>
                            <div className="space-y-1 text-xs text-slate-600">
                              {files.slice(0, 8).map(file => (
                                <div key={`${file.name}-${file.size}`} className="flex justify-between gap-3">
                                  <span className="truncate">{file.name}</span>
                                  <span className="shrink-0">{formatBytes(file.size)}</span>
                                </div>
                              ))}
                              {files.length > 8 && <p>另有 {files.length - 8} 份文件</p>}
                            </div>
                          </div>
                        )}
                      </div>

                      <div className="flex flex-wrap gap-6 rounded-lg bg-slate-50 p-4">
                        <label className="flex items-center gap-2 text-sm">
                          <Checkbox
                            checked={overwrite}
                            onCheckedChange={checked => setOverwrite(checked === true)}
                          />
                          覆盖已有推荐理由
                        </label>
                        <label className="flex items-center gap-2 text-sm">
                          <Checkbox
                            checked={dryRun}
                            onCheckedChange={checked => setDryRun(checked === true)}
                          />
                          试运行（生成但不写表）
                        </label>
                      </div>

                      <Button
                        className="w-full bg-blue-600 hover:bg-blue-700"
                        size="lg"
                        disabled={submitting || files.length === 0 || !sheetUrl.trim()}
                        onClick={submitTask}
                      >
                        {submitting ? (
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        ) : (
                          <Play className="mr-2 h-4 w-4" />
                        )}
                        {submitting ? '正在上传…' : dryRun ? '开始试运行' : '开始处理并写回'}
                      </Button>
                </CardContent>
              </Card>

              <div className="space-y-6">
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">处理规则</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3 text-sm text-slate-600">
                    <p>1. 按 PDF 文件名匹配表格“姓名”列。</p>
                    <p>2. 文本型 PDF 直接提取；扫描件自动使用视觉模型识别。</p>
                    <p>3. 系统自动识别表格所属钉钉组织，无需员工选择凭证。</p>
                    <p>4. AI 按管理员设置的参考范例生成推荐理由。</p>
                    <p>5. 默认跳过已有内容；可选择覆盖或先试运行。</p>
                    <Separator />
                    <p className="flex gap-2 text-xs text-emerald-700">
                      <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />
                      原始 PDF 存放在私有临时存储，Worker 处理结束后自动删除。
                    </p>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="flex flex-row items-center justify-between">
                    <div>
                      <CardTitle className="text-base">最近任务</CardTitle>
                      <CardDescription>管理员可查看全部任务</CardDescription>
                    </div>
                    <Button variant="ghost" size="icon" onClick={loadTasks}>
                      <RefreshCw className="h-4 w-4" />
                    </Button>
                  </CardHeader>
                  <CardContent>
                    {tasks.length === 0 ? (
                      <p className="py-6 text-center text-sm text-slate-500">暂无任务</p>
                    ) : (
                      <ScrollArea className="h-64">
                        <div className="space-y-2 pr-3">
                          {tasks.map(task => (
                            <button
                              key={task.taskId}
                              type="button"
                              onClick={() => setCurrentTask(task)}
                              className={`w-full rounded-lg border p-3 text-left transition ${
                                currentTask?.taskId === task.taskId
                                  ? 'border-blue-300 bg-blue-50'
                                  : 'bg-white hover:bg-slate-50'
                              }`}
                            >
                              <div className="flex items-center justify-between gap-2">
                                <span className="truncate text-sm font-medium">{task.sheetName}</span>
                                <Badge className={STATUS_META[task.status]?.className}>
                                  {STATUS_META[task.status]?.label || task.status}
                                </Badge>
                              </div>
                              <p className="mt-1 text-xs text-slate-500">
                                {task.files.length} 份 PDF · {formatTime(task.createdAt)}
                              </p>
                            </button>
                          ))}
                        </div>
                      </ScrollArea>
                    )}
                  </CardContent>
                </Card>
              </div>
            </div>

            {currentTask && (
              <Card>
                <CardHeader>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <CardTitle className="flex items-center gap-2">
                        {currentTask.status === 'done' ? (
                          <CheckCircle2 className="h-5 w-5 text-emerald-600" />
                        ) : currentTask.status === 'error' ? (
                          <XCircle className="h-5 w-5 text-red-600" />
                        ) : (
                          <Clock className="h-5 w-5 text-blue-600" />
                        )}
                        任务详情
                      </CardTitle>
                      <CardDescription>
                        {currentTask.sheetName} · {currentTask.files.length} 份 PDF
                      </CardDescription>
                    </div>
                    <Badge className={STATUS_META[currentTask.status]?.className}>
                      {STATUS_META[currentTask.status]?.label || currentTask.status}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent className="space-y-5">
                  {currentTask.errorMessage && (
                    <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                      {currentTask.errorMessage}
                    </div>
                  )}
                  <div className="rounded-lg bg-slate-950 p-4">
                    <ScrollArea className="h-52">
                      <pre className="whitespace-pre-wrap pr-3 font-mono text-xs leading-6 text-emerald-300">
                        {currentTask.logs.join('\n') || '等待任务日志…'}
                      </pre>
                    </ScrollArea>
                  </div>

                  {currentTask.result && (
                    <div className="space-y-4">
                      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                        <div className="rounded-lg bg-blue-50 p-3">
                          <p className="text-xs text-slate-500">已处理</p>
                          <p className="text-2xl font-semibold text-blue-700">
                            {currentTask.result.processed.length}
                          </p>
                        </div>
                        <div className="rounded-lg bg-emerald-50 p-3">
                          <p className="text-xs text-slate-500">已写入</p>
                          <p className="text-2xl font-semibold text-emerald-700">
                            {currentTask.result.written.length}
                          </p>
                        </div>
                        <div className="rounded-lg bg-amber-50 p-3">
                          <p className="text-xs text-slate-500">已跳过</p>
                          <p className="text-2xl font-semibold text-amber-700">
                            {currentTask.result.skipped.length}
                          </p>
                        </div>
                        <div className="rounded-lg bg-red-50 p-3">
                          <p className="text-xs text-slate-500">失败</p>
                          <p className="text-2xl font-semibold text-red-700">
                            {currentTask.result.failed.length}
                          </p>
                        </div>
                      </div>

                      {currentTask.result.generated.length > 0 && (
                        <div className="space-y-3">
                          <h3 className="font-medium">
                            {currentTask.result.dry_run ? '试运行生成结果' : '推荐理由'}
                          </h3>
                          {currentTask.result.generated.map(item => (
                            <div key={`${item.name}-${item.cell}`} className="rounded-lg border bg-white p-4">
                              <div className="mb-2 flex items-center justify-between">
                                <span className="font-medium">{item.name}</span>
                                <Badge variant="outline">{item.cell}</Badge>
                              </div>
                              <p className="whitespace-pre-wrap text-sm leading-6 text-slate-700">
                                {item.summary}
                              </p>
                            </div>
                          ))}
                        </div>
                      )}

                      {(currentTask.result.unmatched_files.length > 0
                        || currentTask.result.unmatched.length > 0) && (
                        <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
                          {currentTask.result.unmatched_files.length > 0 && (
                            <p>
                              未匹配到表格姓名的 PDF：
                              {currentTask.result.unmatched_files.join('、')}
                            </p>
                          )}
                          {currentTask.result.unmatched.length > 0 && (
                            <p>
                              表格中没有对应 PDF 的人员：
                              {currentTask.result.unmatched.join('、')}
                            </p>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </CardContent>
              </Card>
            )}
          </TabsContent>

          {user?.role === 'admin' && (
            <TabsContent value="admin" className="space-y-6">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <ShieldCheck className="h-5 w-5 text-emerald-600" />
                    模型与安全状态
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="grid gap-4 md:grid-cols-4">
                    <div className="rounded-lg border p-4">
                      <p className="text-xs text-slate-500">LLM 配置</p>
                      <p className="mt-1 font-medium">
                        {adminConfig?.llm.configured ? '已配置' : '未配置 LLM_API_KEY'}
                      </p>
                    </div>
                    <div className="rounded-lg border p-4">
                      <p className="text-xs text-slate-500">简历 AI 授权</p>
                      <p className="mt-1 font-medium">
                        {adminConfig?.llm.resumeAnalysisAllowed ? '已显式授权' : '未授权'}
                      </p>
                    </div>
                    <div className="rounded-lg border p-4">
                      <p className="text-xs text-slate-500">文本模型</p>
                      <p className="mt-1 truncate font-medium">{adminConfig?.llm.textModel}</p>
                    </div>
                    <div className="rounded-lg border p-4">
                      <p className="text-xs text-slate-500">视觉模型</p>
                      <p className="mt-1 truncate font-medium">{adminConfig?.llm.visionModel}</p>
                    </div>
                  </div>
                  <p className="mt-3 text-xs text-slate-500">
                    API Key 可使用服务器环境变量，也可由管理员加密保存；页面不会读取或回显明文。
                  </p>
                </CardContent>
              </Card>

              <div className="grid gap-6 xl:grid-cols-2">
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <KeyRound className="h-5 w-5 text-blue-600" />
                      钉钉 MCP 凭证
                    </CardTitle>
                    <CardDescription>
                      每个钉钉组织配置一条 Streamable HTTP URL，保存后加密存储。
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-5">
                    <div className="space-y-3 rounded-lg border bg-slate-50 p-4">
                      <div className="space-y-2">
                        <Label>凭证名称</Label>
                        <Input
                          value={credentialForm.name}
                          placeholder="例如：本公司"
                          onChange={event => setCredentialForm(current => ({
                            ...current,
                            name: event.target.value,
                          }))}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>MCP URL</Label>
                        <Input
                          type="password"
                          value={credentialForm.mcpUrl}
                          placeholder={credentialForm.id ? '留空表示保留现有 URL' : 'https://mcp-gw.dingtalk.com/...'}
                          onChange={event => setCredentialForm(current => ({
                            ...current,
                            mcpUrl: event.target.value,
                          }))}
                        />
                      </div>
                      <div className="flex gap-2">
                        <Button disabled={adminSaving} onClick={saveCredential}>
                          {adminSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                          {credentialForm.id ? '更新凭证' : '添加凭证'}
                        </Button>
                        {credentialForm.id && (
                          <Button
                            variant="outline"
                            onClick={() => setCredentialForm({ id: '', name: '', mcpUrl: '' })}
                          >
                            取消编辑
                          </Button>
                        )}
                      </div>
                    </div>

                    <div className="space-y-2">
                      {adminConfig?.credentials.length ? adminConfig.credentials.map(credential => (
                        <div key={credential.id} className="flex items-center justify-between gap-3 rounded-lg border p-3">
                          <div className="min-w-0">
                            <p className="font-medium">{credential.name}</p>
                            <p className="truncate text-xs text-slate-500">{credential.endpointHost}</p>
                          </div>
                          <div className="flex shrink-0 gap-1">
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => setCredentialForm({
                                id: credential.id,
                                name: credential.name,
                                mcpUrl: '',
                              })}
                            >
                              <Pencil className="h-4 w-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => {
                                if (window.confirm(`确定删除凭证“${credential.name}”吗？`)) {
                                  runAdminAction({
                                    action: 'delete_credential',
                                    id: credential.id,
                                  });
                                }
                              }}
                            >
                              <Trash2 className="h-4 w-4 text-red-500" />
                            </Button>
                          </div>
                        </div>
                      )) : (
                        <p className="py-4 text-center text-sm text-slate-500">尚未配置 MCP 凭证</p>
                      )}
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <Settings className="h-5 w-5 text-emerald-600" />
                      模型配置
                    </CardTitle>
                    <CardDescription>
                      留空 API Key 会保留当前密钥；其他空值回退到服务器环境变量。
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-5">
                    <div className="space-y-3 rounded-lg border bg-slate-50 p-4">
                      <div className="space-y-2">
                        <Label>API Key</Label>
                        <Input
                          type="password"
                          value={settingsForm.apiKey}
                          placeholder={adminConfig?.llm.configured ? '已配置，留空表示保持不变' : '输入模型 API Key'}
                          onChange={event => setSettingsForm(current => ({
                            ...current,
                            apiKey: event.target.value,
                          }))}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>Base URL</Label>
                        <Input
                          value={settingsForm.baseUrl}
                          placeholder="https://dashscope.aliyuncs.com/compatible-mode/v1"
                          onChange={event => setSettingsForm(current => ({
                            ...current,
                            baseUrl: event.target.value,
                          }))}
                        />
                      </div>
                      <div className="grid gap-3 sm:grid-cols-2">
                        <div className="space-y-2">
                          <Label>文本模型</Label>
                          <Input
                            value={settingsForm.textModel}
                            onChange={event => setSettingsForm(current => ({
                              ...current,
                              textModel: event.target.value,
                            }))}
                          />
                        </div>
                        <div className="space-y-2">
                          <Label>视觉模型</Label>
                          <Input
                            value={settingsForm.visionModel}
                            onChange={event => setSettingsForm(current => ({
                              ...current,
                              visionModel: event.target.value,
                            }))}
                          />
                        </div>
                      </div>
                      <div className="space-y-2">
                        <Label>并发数（1-32）</Label>
                        <Input
                          type="number"
                          min={1}
                          max={32}
                          value={settingsForm.workers}
                          onChange={event => setSettingsForm(current => ({
                            ...current,
                            workers: event.target.value,
                          }))}
                        />
                      </div>
                      <div className="flex gap-2">
                        <Button
                          disabled={adminSaving}
                          onClick={saveSettings}
                        >
                          {adminSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                          保存模型配置
                        </Button>
                        <Button
                          variant="outline"
                          disabled={adminSaving || !adminConfig?.llm.configured}
                          onClick={() => runAdminAction({ action: 'test_llm' })}
                        >
                          测试连通性
                        </Button>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </div>

              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <FileText className="h-5 w-5 text-violet-600" />
                    推荐理由参考范例
                  </CardTitle>
                  <CardDescription>
                    模型会模仿范例的段落结构、标题顺序和语言风格，不会复用其中的候选人信息。
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="flex items-center justify-between">
                    <Badge variant="outline">
                      {adminConfig?.llm.customStyleSample ? '自定义范例' : '内置默认范例'}
                    </Badge>
                    <span className="text-xs text-slate-500">至少 20 个字符</span>
                  </div>
                  <Textarea
                    className="min-h-64"
                    value={settingsForm.styleSample}
                    onChange={event => setSettingsForm(current => ({
                      ...current,
                      styleSample: event.target.value,
                    }))}
                  />
                  <div className="flex gap-2">
                    <Button disabled={adminSaving} onClick={saveSettings}>
                      保存参考范例
                    </Button>
                    <Button
                      variant="outline"
                      disabled={adminSaving || !adminConfig?.llm.customStyleSample}
                      onClick={() => runAdminAction({ action: 'reset_style' })}
                    >
                      恢复默认
                    </Button>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-base">
                    <FileText className="h-4 w-4 text-blue-600" />
                    配置提示
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-2 text-sm text-slate-600">
                  <p>1. 使用目标表格所属组织的钉钉账号登录 mcp.dingtalk.com。</p>
                  <p>2. 创建“钉钉表格” MCP，复制 Streamable HTTP URL 后添加凭证。</p>
                  <p>3. 员工粘贴表格链接后，Worker 会自动尝试各组织凭证。</p>
                  <p>4. 表格需包含“姓名”和“推荐理由”列；连续行会自动批量写入。</p>
                </CardContent>
              </Card>
            </TabsContent>
          )}
        </Tabs>
      </main>
    </div>
  );
}
