'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  Bot,
  Cloud,
  Database,
  FileJson2,
  FileUp,
  HardDrive,
  LockKeyhole,
  RefreshCw,
  Search,
  Server,
  ShieldCheck,
  TriangleAlert,
} from 'lucide-react';
import { toast } from 'sonner';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { authFetch } from '@/lib/auth-client';
import type { IntegrationConnection } from '../decision-types';
import { normalizeIntegrationConnections } from '../lib/decision-ui';
import { DemoResetCard } from './demo-reset-control';

interface DataBoundary {
  ai_mode?: 'rules_only' | 'private_endpoint' | 'approved_cloud' | string;
  deployment_mode?: 'rules_only' | 'private_endpoint' | 'approved_cloud' | string;
  effective_mode?: 'rules_only' | 'private_endpoint' | 'approved_cloud' | string;
  model_endpoint_classification?: string | null;
  external_processors?: string[] | null;
  deployment_processors?: string[] | null;
}

function formatDate(value: string | null | undefined): string {
  if (!value) return '尚未同步';
  return new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
}

function sourceLabel(type: string): string {
  const labels: Record<string, string> = { ats: 'ATS', generic_ats: '通用 ATS', csv: 'CSV/JSON 导入', json: 'CSV/JSON 导入', csv_json: 'CSV/JSON 导入', authorized_resume_source: '授权简历源', boss: 'Boss 兼容入口', resume_batch: '简历批处理' };
  return labels[type] ?? type;
}

function boundaryLabel(mode: string | undefined): string {
  const labels: Record<string, string> = { rules_only: '纯规则 · 不调用模型', private_endpoint: '企业私有模型端点', approved_cloud: '已批准云端模型' };
  return labels[mode ?? ''] ?? mode ?? '按组织策略执行';
}

export function DataSourcesWorkspace() {
  const [connections, setConnections] = useState<IntegrationConnection[]>([]);
  const [boundary, setBoundary] = useState<DataBoundary>({});
  const [loading, setLoading] = useState(true);
  const [syncingId, setSyncingId] = useState<string | null>(null);
  const [entityType, setEntityType] = useState('candidate');

  const loadConnections = useCallback(async () => {
    setLoading(true);
    try {
      const response = await authFetch('/api/integrations');
      const result: { success?: boolean; data?: { connections?: IntegrationConnection[]; data_boundary?: DataBoundary; ai_policy?: DataBoundary } | IntegrationConnection[]; error?: string } = await response.json();
      if (!response.ok || !result.success) throw new Error(result.error || '数据源加载失败');
      if (Array.isArray(result.data)) {
        setConnections(normalizeIntegrationConnections(result.data));
        setBoundary({});
      } else {
        const normalized = normalizeIntegrationConnections(result.data?.connections ?? []);
        setConnections(normalized);
        const endpointClassification = normalized.some((connection) => connection.model_endpoint_classification === 'approved_cloud')
          ? 'approved_cloud'
          : normalized.some((connection) => connection.model_endpoint_classification === 'private') ? 'private' : 'none';
        setBoundary(result.data?.data_boundary ?? result.data?.ai_policy ?? {
          ai_mode: endpointClassification === 'approved_cloud' ? 'approved_cloud' : endpointClassification === 'private' ? 'private_endpoint' : 'rules_only',
          model_endpoint_classification: endpointClassification,
          external_processors: normalized.flatMap((connection) => connection.external_processors ?? []),
        });
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '数据源加载失败');
      setConnections([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void loadConnections(); }, [loadConnections]);

  async function importPage(connectionId: string, file: File) {
    setSyncingId(connectionId);
    try {
      const content = await file.text();
      const currentCursor = connections.find((connection) => connection.id === connectionId)?.last_sync_cursor ?? null;
      const nextCursor = crypto.randomUUID();
      const body = file.name.toLowerCase().endsWith('.json')
        ? { format: 'json', records: JSON.parse(content) as unknown, entity_type: entityType, cursor_before: currentCursor, cursor_after: nextCursor }
        : { format: 'csv', content, entity_type: entityType, cursor_before: currentCursor, cursor_after: nextCursor };
      const response = await authFetch(`/api/integrations/${connectionId}/sync`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const result: { success?: boolean; error?: string } = await response.json();
      if (!response.ok || !result.success) throw new Error(result.error || '导入失败');
      toast.success('本页数据已导入');
      await loadConnections();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '导入失败');
    } finally {
      setSyncingId(null);
    }
  }

  async function setAiPolicy(mode: 'rules_only' | 'private_endpoint' | 'approved_cloud') {
    try {
      const response = await authFetch('/api/integrations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'set_ai_policy',
          ai_execution_mode: mode,
          approved_cloud_processors: mode === 'approved_cloud'
            ? boundary.deployment_processors ?? []
            : [],
        }),
      });
      const result: { success?: boolean; error?: string } = await response.json();
      if (!response.ok || !result.success) throw new Error(result.error || 'AI 策略保存失败');
      toast.success(mode === 'rules_only' ? '已切换为纯规则模式' : '企业 AI 处理边界已批准');
      await loadConnections();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'AI 策略保存失败');
    }
  }

  const processors = useMemo(() => {
    const values = new Set(boundary.external_processors ?? []);
    for (const connection of connections) for (const processor of connection.external_processors ?? []) values.add(processor);
    return [...values];
  }, [boundary.external_processors, connections]);
  const bossEnabled = connections.some((connection) => connection.enabled && /boss/i.test(connection.name));
  const resumeBatchEnabled = connections.some((connection) => connection.enabled && ['resume_batch', 'authorized_resume_source', 'csv_json'].includes(connection.connection_type));

  return (
    <div className="space-y-6">
      <div className="flex flex-col justify-between gap-4 md:flex-row md:items-end">
        <div><p className="text-xs font-semibold uppercase tracking-[0.2em] text-blue-700">Controlled ingress</p><h2 className="mt-2 text-2xl font-semibold tracking-tight text-slate-950">数据源</h2><p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">只接入现有 ATS 或已授权简历来源。这里清楚展示数据去向、模型边界和外部处理方。</p></div>
        <Button onClick={() => void loadConnections()} disabled={loading}><RefreshCw className={`mr-2 h-4 w-4 ${loading ? 'animate-spin' : ''}`} />刷新状态</Button>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card className="gap-4 border-slate-200 shadow-none"><CardHeader className="pb-0"><CardTitle className="flex items-center gap-2 text-base"><HardDrive className="h-4 w-4 text-blue-700" />业务数据</CardTitle></CardHeader><CardContent><p className="text-sm font-medium text-slate-900">企业私有数据库</p><p className="mt-2 text-xs leading-5 text-slate-500">职位、候选人、证据、人工决策和结果事件按组织隔离存储。</p></CardContent></Card>
        <Card className="gap-4 border-slate-200 shadow-none"><CardHeader className="pb-0"><CardTitle className="flex items-center gap-2 text-base"><Bot className="h-4 w-4 text-blue-700" />模型执行边界</CardTitle></CardHeader><CardContent><p className="text-sm font-medium text-slate-900">{boundaryLabel(boundary.effective_mode ?? boundary.ai_mode)}</p><p className="mt-2 text-xs leading-5 text-slate-500">企业批准：{boundaryLabel(boundary.ai_mode)} · 部署上限：{boundaryLabel(boundary.deployment_mode)}</p></CardContent></Card>
        <Card className="gap-4 border-slate-200 shadow-none"><CardHeader className="pb-0"><CardTitle className="flex items-center gap-2 text-base"><Cloud className="h-4 w-4 text-blue-700" />外部处理方</CardTitle></CardHeader><CardContent>{processors.length ? <div className="flex flex-wrap gap-2">{processors.map((processor) => <Badge key={processor} variant="outline">{processor}</Badge>)}</div> : <p className="text-sm font-medium text-emerald-800">未声明外部处理方</p>}<p className="mt-2 text-xs leading-5 text-slate-500">启用云端模型或外部 ATS 后，请在此披露实际处理方。</p></CardContent></Card>
      </div>

      <Alert className={boundary.effective_mode === 'approved_cloud' ? 'border-amber-300 bg-amber-50' : 'border-emerald-200 bg-emerald-50'}>
        {boundary.effective_mode === 'approved_cloud' ? <TriangleAlert className="h-4 w-4 text-amber-700" /> : <ShieldCheck className="h-4 w-4 text-emerald-700" />}
        <AlertTitle>{boundary.effective_mode === 'approved_cloud' ? '当前存在经批准的外部模型处理' : '当前按私有处理边界运行'}</AlertTitle>
        <AlertDescription>{boundary.effective_mode === 'approved_cloud' ? '发送到外部模型的内容会先去标识化；本部署不能宣称数据完全不出域。' : '企业未批准、配置缺失或模式不一致时，系统自动回退到纯规则模式，不构造模型客户端。'}</AlertDescription>
      </Alert>

      <Card className="border-slate-200 shadow-none">
        <CardHeader><CardTitle>企业 AI 批准</CardTitle><CardDescription>部署配置只是能力上限。管理员必须为本企业单独批准；云端模式会同时固定披露的外部处理方。</CardDescription></CardHeader>
        <CardContent className="flex flex-wrap gap-3">
          {boundary.deployment_mode === 'approved_cloud' && (
            <p className="w-full text-sm text-slate-600">拟批准处理方：{boundary.deployment_processors?.join('、') || '部署未声明，无法启用'}</p>
          )}
          <Button onClick={() => void setAiPolicy('rules_only')}>使用纯规则</Button>
          {boundary.deployment_mode && boundary.deployment_mode !== 'rules_only' && (
            <Button onClick={() => void setAiPolicy(boundary.deployment_mode as 'private_endpoint' | 'approved_cloud')}>
              {boundary.deployment_mode === 'approved_cloud' ? '批准处理方并启用云端' : '批准并启用私有端点'}
            </Button>
          )}
        </CardContent>
      </Card>

      <DemoResetCard />

      <Card className="border-slate-200 shadow-none">
        <CardHeader><CardTitle>已连接的数据源</CardTitle><CardDescription>管理员可直接导入职位或附带完整授权证据的候选人；每页最多 100 条，实体、映射和游标在同一事务提交。</CardDescription></CardHeader>
        <CardContent>
          <div className="mb-4 max-w-xs space-y-2"><Label htmlFor="integration-entity-type">本次数据类型</Label><Select value={entityType} onValueChange={setEntityType}><SelectTrigger id="integration-entity-type" className="w-full"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="candidate">候选人</SelectItem><SelectItem value="job">职位</SelectItem><SelectItem value="outcome">招聘结果</SelectItem></SelectContent></Select></div>
          {loading ? <div className="space-y-3"><Skeleton className="h-20" /><Skeleton className="h-20" /></div> : connections.length === 0 ? (
            <div className="rounded-xl border border-dashed border-slate-300 p-8 text-center"><Database className="mx-auto h-8 w-8 text-slate-400" /><p className="mt-3 font-medium text-slate-800">尚未配置连接</p><p className="mt-2 text-sm text-slate-500">可先使用受控的 CSV/JSON 导入，再由管理员配置通用 ATS 连接。</p></div>
          ) : (
            <div className="space-y-3">{connections.map((connection) => (
              <div key={connection.id} className="grid gap-4 rounded-xl border border-slate-200 p-4 md:grid-cols-[auto_1fr_auto] md:items-center">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-slate-100 text-slate-700">{connection.connection_type === 'csv' || connection.connection_type === 'json' ? <FileJson2 className="h-5 w-5" /> : <Server className="h-5 w-5" />}</div>
                <div><div className="flex flex-wrap items-center gap-2"><p className="font-medium text-slate-950">{connection.name}</p><Badge variant={connection.enabled ? 'default' : 'secondary'}>{connection.enabled ? '已启用' : '已停用'}</Badge><Badge variant="outline">{sourceLabel(connection.connection_type)}</Badge></div><p className="mt-2 text-xs text-slate-500">上次同步：{formatDate(connection.last_sync_at)}{connection.last_sync_status ? ` · ${connection.last_sync_status}` : ''}</p>{connection.last_sync_error && <p className="mt-1 text-xs text-red-700">{connection.last_sync_error}</p>}</div>
                <div><input id={`integration-file-${connection.id}`} className="sr-only" type="file" accept=".csv,.json,text/csv,application/json" disabled={!connection.enabled || syncingId === connection.id} onChange={(event) => { const file = event.target.files?.[0]; if (file) void importPage(connection.id, file); event.currentTarget.value = ''; }} /><Button disabled={!connection.enabled || syncingId === connection.id} onClick={() => document.getElementById(`integration-file-${connection.id}`)?.click()}><FileUp className="mr-2 h-4 w-4" />{syncingId === connection.id ? '导入中…' : '导入一页'}</Button></div>
              </div>
            ))}</div>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="border-slate-200 shadow-none"><CardHeader><CardTitle className="flex items-center gap-2 text-base"><FileUp className="h-4 w-4 text-primary" />受控文件导入</CardTitle><CardDescription>CSV/JSON 是默认兼容基线，导入前需要确认来源授权。</CardDescription></CardHeader><CardContent><Button disabled={!resumeBatchEnabled} asChild={resumeBatchEnabled}>{resumeBatchEnabled ? <Link href="/resume-batch">进入简历批处理</Link> : <span>需要管理员启用</span>}</Button></CardContent></Card>
        <Card className="border-slate-200 shadow-none"><CardHeader><CardTitle className="flex items-center gap-2 text-base"><Search className="h-4 w-4 text-primary" />Boss 兼容工具</CardTitle><CardDescription>仅为一版兼容入口，不属于核心招聘决策流程；不得绕过平台授权或权限。</CardDescription></CardHeader><CardContent><Button disabled={!bossEnabled} asChild={bossEnabled}>{bossEnabled ? <Link href="/boss-search">进入已启用的兼容工具</Link> : <span>需要管理员明确启用</span>}</Button></CardContent></Card>
      </div>

      <Card className="border-slate-200 bg-slate-950 text-white shadow-none"><CardContent className="grid gap-4 pt-0 md:grid-cols-[auto_1fr]"><LockKeyhole className="h-6 w-6 text-blue-300" /><div><p className="font-medium">数据边界不是一句“私有部署”口号</p><p className="mt-2 text-sm leading-6 text-slate-300">连接密钥应加密保存，候选人授权失效时停止新处理，外部写回先记录人工批准意图，再由独立任务执行。</p></div></CardContent></Card>
    </div>
  );
}
