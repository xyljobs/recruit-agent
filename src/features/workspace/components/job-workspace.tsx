'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  AlertCircle,
  FileText,
  RefreshCw,
  Search,
  Sparkles,
  Target,
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
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { authFetch } from '@/lib/auth-client';
import { useWorkspaceData } from '../hooks/use-workspace-data';
import type { Job } from '../types';

const BATCH_POLL_INTERVAL_MS = 2_000;
const BATCH_POLL_MAX_ATTEMPTS = 60;

interface BatchMatchResult {
  matches?: unknown[];
  top_candidates?: unknown[];
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
    reloadDashboard,
    reloadJobs,
    reloadMatchRecords,
  } = useWorkspaceData();
  const [jdContent, setJdContent] = useState('');
  const [parsedJob, setParsedJob] = useState<Job | null>(null);
  const [jdLoading, setJdLoading] = useState(false);
  const [jobSearch, setJobSearch] = useState('');
  const [manualTitle, setManualTitle] = useState('');
  const [manualDepartment, setManualDepartment] = useState('');
  const [manualLocation, setManualLocation] = useState('');
  const [manualSkills, setManualSkills] = useState('');
  const [savingManual, setSavingManual] = useState(false);
  const [generatingJobId, setGeneratingJobId] = useState<string | null>(null);

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
    setJdLoading(true);
    try {
      const response = await authFetch('/api/jd/parse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jdContent }),
      });
      const result = await response.json();
      if (!result.success) {
        toast.error(result.error || '解析失败');
        return;
      }

      const job: Job = result.data;
      setParsedJob(job);
      await reloadJobs();
      toast.success('JD解析成功！正在搜索匹配候选人...');

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
          toast.info('未找到匹配的候选人，请先添加候选人');
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
        toast.success(`匹配完成！Top ${topMatches.length} 候选人已生成`);
        await Promise.all([reloadMatchRecords(), reloadDashboard()]);
      } catch (error) {
        console.error('自动匹配失败:', error);
        toast.error('自动匹配失败，请手动匹配');
      }
    } catch (error) {
      console.error('JD解析失败:', error);
      toast.error('解析失败，请重试');
    } finally {
      setJdLoading(false);
    }
  }

  async function saveManualCriteria() {
    if (!manualTitle.trim()) {
      toast.error('请填写职位名称');
      return;
    }
    setSavingManual(true);
    try {
      const response = await authFetch('/api/jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'create',
          title: manualTitle.trim(),
          ...(manualDepartment.trim() ? { department: manualDepartment.trim() } : {}),
          ...(manualLocation.trim() ? { location: manualLocation.trim() } : {}),
          skills_required: manualSkills.split(/[，,]/).map(skill => skill.trim()).filter(Boolean),
        }),
      });
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.error || '保存失败');
      setManualTitle('');
      setManualDepartment('');
      setManualLocation('');
      setManualSkills('');
      await reloadJobs();
      toast.success('职位标准已保存为草稿');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '保存职位标准失败');
    } finally {
      setSavingManual(false);
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
      <Card className="border-slate-200 shadow-none">
        <CardHeader>
          <CardTitle>手工定义职位标准</CardTitle>
          <CardDescription>纯规则模式也可使用；先保存草稿，再明确启用职位并生成短名单。</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <div className="space-y-2"><Label htmlFor="manual-job-title">职位名称</Label><Input id="manual-job-title" value={manualTitle} onChange={(event) => setManualTitle(event.target.value)} maxLength={200} /></div>
          <div className="space-y-2"><Label htmlFor="manual-job-department">部门</Label><Input id="manual-job-department" value={manualDepartment} onChange={(event) => setManualDepartment(event.target.value)} maxLength={100} /></div>
          <div className="space-y-2"><Label htmlFor="manual-job-location">地点</Label><Input id="manual-job-location" value={manualLocation} onChange={(event) => setManualLocation(event.target.value)} maxLength={100} /></div>
          <div className="space-y-2"><Label htmlFor="manual-job-skills">必备技能（逗号分隔）</Label><Input id="manual-job-skills" value={manualSkills} onChange={(event) => setManualSkills(event.target.value)} /></div>
          <Button className="md:col-span-2 lg:col-span-1" onClick={() => void saveManualCriteria()} disabled={savingManual || !manualTitle.trim()}>{savingManual ? '保存中…' : '保存职位草稿'}</Button>
        </CardContent>
      </Card>
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FileText className="h-5 w-5 text-blue-600" />
              AI 辅助解析职位描述（可选）
            </CardTitle>
            <CardDescription>
              仅在管理员启用私有端点或经批准云端模式时可用
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
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
            <Button
              className="w-full bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-700 hover:to-blue-800"
              onClick={handleParseJD}
              disabled={jdLoading || !jdContent.trim()}
            >
              {jdLoading ? (
                <>
                  <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                  AI正在解析...
                </>
              ) : (
                <>
                  <Sparkles className="h-4 w-4 mr-2" />
                  AI智能解析
                </>
              )}
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>解析结果</CardTitle>
            <CardDescription>结构化的岗位需求卡片</CardDescription>
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

                {parsedJob.skills_required &&
                  parsedJob.skills_required.length > 0 && (
                    <div>
                      <p className="text-sm text-gray-500 mb-2">技能要求</p>
                      <div className="flex flex-wrap gap-2">
                        {parsedJob.skills_required.map((skill) => (
                          <Badge
                            key={skill}
                            variant="secondary"
                            className="bg-blue-50 text-blue-700 hover:bg-blue-100"
                          >
                            {skill}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  )}

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

                {parsedJob.bonus_skills &&
                  parsedJob.bonus_skills.length > 0 && (
                    <div>
                      <p className="text-sm text-gray-500 mb-2">加分技能</p>
                      <div className="flex flex-wrap gap-2">
                        {parsedJob.bonus_skills.map((skill) => (
                          <Badge
                            key={skill}
                            variant="outline"
                            className="bg-purple-50 text-purple-700 border-purple-200"
                          >
                            {skill}
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
            ) : (
              <div className="h-[300px] flex flex-col items-center justify-center text-gray-400">
                <FileText className="h-16 w-16 mb-4 text-gray-200" />
                <p>解析结果将在这里显示</p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle>职位库</CardTitle>
            <CardDescription>已解析的职位列表</CardDescription>
          </div>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
            <Input
              placeholder="搜索职位..."
              className="pl-9 w-48"
              value={jobSearch}
              onChange={(event) => setJobSearch(event.target.value)}
            />
          </div>
        </CardHeader>
        <CardContent>
          {filteredJobs.length > 0 ? (
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {filteredJobs.map((job) => (
                <Card
                  key={job.id}
                  className="hover:shadow-md transition-shadow"
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
                      <div className="flex flex-wrap items-center justify-between gap-2"><Badge variant="outline">{job.status === 'active' ? '已启用' : job.status === 'closed' ? '已关闭' : '草稿'}</Badge><div className="flex gap-2">{job.status === 'active' && <Button size="sm" onClick={() => void generateShortlist(job.id)} disabled={generatingJobId === job.id}>{generatingJobId === job.id ? '提交中…' : '生成短名单'}</Button>}{job.status === 'active' ? <Button size="sm" variant="outline" onClick={() => void updateJobLifecycle(job.id, 'close')}>关闭职位</Button> : <Button size="sm" variant="outline" onClick={() => void updateJobLifecycle(job.id, 'activate')}>启用职位</Button>}</div></div>
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
                  暂无职位，请先解析JD
                </span>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
