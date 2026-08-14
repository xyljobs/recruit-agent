'use client';

import { useMemo, useState } from 'react';
import {
  Briefcase,
  Building2,
  Download,
  Eye,
  Filter,
  GraduationCap,
  Search,
  ShieldOff,
  Users,
  Wand2,
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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { authFetch } from '@/lib/auth-client';
import { getScoreBg, getScoreColor } from '../constants';
import { useWorkspaceData } from '../hooks/use-workspace-data';
import { exportCandidates } from '../lib/export-workbook';
import type { Candidate, CandidateForm } from '../types';
import {
  CandidateDetailDialog,
  CandidateFormDialog,
  EMPTY_CANDIDATE_FORM,
  RevokeCandidateDialog,
  type DuplicateCandidateHint,
} from './candidate-dialogs';

function CandidateCardSkeleton() {
  return (
    <div className="p-4 rounded-lg border">
      <div className="flex items-center gap-4">
        <Skeleton className="h-10 w-10 rounded-full" />
        <div className="space-y-2 flex-1">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-3 w-32" />
        </div>
        <Skeleton className="h-8 w-20" />
      </div>
    </div>
  );
}

export function CandidateWorkspace() {
  const { candidates, matchRecords, loading } = useWorkspaceData();
  const [candidateSearch, setCandidateSearch] = useState('');
  const [candidateFilter, setCandidateFilter] = useState<'all' | 'high'>('all');
  const [selectedCandidate, setSelectedCandidate] =
    useState<Candidate | null>(null);
  const [candidateDetailOpen, setCandidateDetailOpen] = useState(false);
  const [revokeCandidate, setRevokeCandidate] = useState<Candidate | null>(null);
  const [revokeConfirmOpen, setRevokeConfirmOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [quickAddOpen, setQuickAddOpen] = useState(false);
  const [quickAddText, setQuickAddText] = useState('');
  const [quickAddLoading, setQuickAddLoading] = useState(false);
  const [formDialogOpen, setFormDialogOpen] = useState(false);
  const [formInitialValues, setFormInitialValues] =
    useState<CandidateForm | null>(null);
  const [formDuplicates, setFormDuplicates] = useState<DuplicateCandidateHint[]>(
    [],
  );

  const filteredCandidates = useMemo(() => {
    let result = candidates;
    if (candidateSearch.trim()) {
      const search = candidateSearch.toLowerCase();
      result = result.filter(
        (candidate) =>
          candidate.name.toLowerCase().includes(search) ||
          candidate.current_company?.toLowerCase().includes(search) ||
          candidate.current_position?.toLowerCase().includes(search) ||
          candidate.skills?.some((skill) =>
            skill.toLowerCase().includes(search),
          ),
      );
    }
    if (candidateFilter === 'high') {
      const highMatchIds = new Set(
        matchRecords
          .filter((record) => (record.overall_score || 0) >= 70)
          .map((record) => record.candidate_id),
      );
      result = result.filter((candidate) => highMatchIds.has(candidate.id));
    }
    return result;
  }, [candidateFilter, candidateSearch, candidates, matchRecords]);

  async function handleExport() {
    if (candidates.length === 0) {
      toast.error('暂无候选人数据');
      return;
    }
    setExporting(true);
    try {
      await exportCandidates(candidates);
      toast.success('导出成功！');
    } catch {
      toast.error('导出失败，请重试');
    } finally {
      setExporting(false);
    }
  }

  async function handleQuickExtract() {
    const text = quickAddText.trim();
    if (!text) {
      toast.error('请先粘贴简历文本');
      return;
    }
    setQuickAddLoading(true);
    try {
      const response = await authFetch('/api/candidates/extract', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      });
      const result = await response.json();
      if (!result.success) {
        toast.error(result.error || '提取失败');
        return;
      }
      const extracted = result.data?.extracted as Record<string, unknown>;
      const duplicates = Array.isArray(result.data?.duplicates)
        ? (result.data.duplicates as DuplicateCandidateHint[])
        : [];
      const stringField = (value: unknown) =>
        typeof value === 'string' ? value : '';
      const stringArrayField = (value: unknown) =>
        Array.isArray(value)
          ? value.filter((item): item is string => typeof item === 'string')
          : [];
      setFormInitialValues({
        ...EMPTY_CANDIDATE_FORM,
        name: stringField(extracted?.name),
        phone: stringField(extracted?.phone),
        email: stringField(extracted?.email),
        current_city: stringField(extracted?.current_city),
        current_company: stringField(extracted?.current_company),
        current_position: stringField(extracted?.current_position),
        skills: stringArrayField(extracted?.skills),
        experience_years:
          typeof extracted?.experience_years === 'number'
            ? (extracted.experience_years as number)
            : 0,
        education: stringField(extracted?.education),
        salary_expectation: stringField(extracted?.salary_expectation),
        preferred_locations: stringArrayField(extracted?.preferred_locations),
        resume_text: text,
      });
      setFormDuplicates(duplicates);
      setQuickAddOpen(false);
      setQuickAddText('');
      setFormDialogOpen(true);
      toast.success(
        duplicates.length > 0
          ? '提取完成，检测到可能重复的候选人，请核对'
          : '提取完成，请确认字段后保存',
      );
    } catch {
      toast.error('提取失败，请重试');
    } finally {
      setQuickAddLoading(false);
    }
  }

  function handleFormDialogOpenChange(nextOpen: boolean) {
    setFormDialogOpen(nextOpen);
    if (!nextOpen) {
      setFormInitialValues(null);
      setFormDuplicates([]);
    }
  }

  return (
    <>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle>候选人库</CardTitle>
            <CardDescription>管理和筛选候选人信息</CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setQuickAddOpen(true)}
            >
              <Zap className="h-4 w-4 mr-2" />
              快捷入库
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={handleExport}
              disabled={exporting}
            >
              <Download className="h-4 w-4 mr-2" />
              {exporting ? '导出中...' : '导出'}
            </Button>
            <CandidateFormDialog
              open={formDialogOpen}
              onOpenChange={handleFormDialogOpenChange}
              initialValues={formInitialValues}
              duplicates={formDuplicates}
            />
          </div>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col gap-3 mb-4 sm:flex-row">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
              <Input
                placeholder="搜索姓名、公司、职位或技能..."
                className="pl-9"
                value={candidateSearch}
                onChange={(event) => setCandidateSearch(event.target.value)}
              />
            </div>
            <Select
              value={candidateFilter}
              onValueChange={(value) =>
                setCandidateFilter(value as 'all' | 'high')
              }
            >
              <SelectTrigger className="w-40">
                <Filter className="h-4 w-4 mr-2" />
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全部候选人</SelectItem>
                <SelectItem value="high">高匹配度(≥70分)</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {loading ? (
            <div className="space-y-3">
              {[1, 2, 3].map((item) => (
                <CandidateCardSkeleton key={item} />
              ))}
            </div>
          ) : filteredCandidates.length > 0 ? (
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {filteredCandidates.map((candidate) => {
                const matchRecord = matchRecords.find(
                  (record) => record.candidate_id === candidate.id,
                );
                return (
                  <Card
                    key={candidate.id}
                    className="hover:shadow-md transition-shadow"
                  >
                    <CardContent className="pt-4">
                      <div className="flex items-start justify-between mb-3">
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 bg-gradient-to-br from-blue-400 to-blue-600 rounded-full flex items-center justify-center text-white font-semibold">
                            {candidate.name[0]}
                          </div>
                          <div>
                            <h4 className="font-semibold">{candidate.name}</h4>
                            <p className="text-sm text-gray-500">
                              {candidate.current_position || '未知职位'}
                            </p>
                          </div>
                        </div>
                        <div className="flex">
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label={`查看${candidate.name}详情`}
                            onClick={() => {
                              setSelectedCandidate(candidate);
                              setCandidateDetailOpen(true);
                            }}
                          >
                            <Eye className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label={`撤回${candidate.name}授权`}
                            className="text-red-500 hover:text-red-700 hover:bg-red-50"
                            onClick={() => {
                              setRevokeCandidate(candidate);
                              setRevokeConfirmOpen(true);
                            }}
                          >
                            <ShieldOff className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                      <div className="space-y-2 text-sm text-gray-500">
                        {candidate.current_company && (
                          <div className="flex items-center gap-2">
                            <Building2 className="h-4 w-4" />
                            <span>{candidate.current_company}</span>
                          </div>
                        )}
                        {candidate.experience_years !== null && (
                          <div className="flex items-center gap-2">
                            <Briefcase className="h-4 w-4" />
                            <span>{candidate.experience_years}年经验</span>
                          </div>
                        )}
                        {candidate.education && (
                          <div className="flex items-center gap-2">
                            <GraduationCap className="h-4 w-4" />
                            <span>{candidate.education}</span>
                          </div>
                        )}
                      </div>
                      {candidate.skills && candidate.skills.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-3">
                          {candidate.skills.slice(0, 3).map((skill) => (
                            <Badge
                              key={skill}
                              variant="secondary"
                              className="text-xs"
                            >
                              {skill}
                            </Badge>
                          ))}
                          {candidate.skills.length > 3 && (
                            <Badge variant="secondary" className="text-xs">
                              +{candidate.skills.length - 3}
                            </Badge>
                          )}
                        </div>
                      )}
                      {matchRecord && (
                        <div
                          className={`mt-3 p-2 rounded-lg ${getScoreBg(matchRecord.overall_score || 0)} flex items-center justify-between`}
                        >
                          <span className="text-sm">匹配评分</span>
                          <span
                            className={`font-bold ${getScoreColor(matchRecord.overall_score || 0)}`}
                          >
                            {matchRecord.overall_score}分
                          </span>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          ) : (
            <div className="text-center py-12 text-gray-500">
              <Users className="h-16 w-16 mx-auto mb-4 text-gray-300" />
              <p>
                {candidateSearch || candidateFilter !== 'all'
                  ? '未找到匹配的候选人'
                  : '暂无候选人，点击上方按钮添加'}
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      <CandidateDetailDialog
        candidate={selectedCandidate}
        matchRecord={
          selectedCandidate
            ? matchRecords.find(
                (record) => record.candidate_id === selectedCandidate.id,
              ) ?? null
            : null
        }
        open={candidateDetailOpen}
        onOpenChange={setCandidateDetailOpen}
      />
      <RevokeCandidateDialog
        candidate={revokeCandidate}
        open={revokeConfirmOpen}
        onOpenChange={setRevokeConfirmOpen}
      />
      <Dialog open={quickAddOpen} onOpenChange={setQuickAddOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>简历快捷入库</DialogTitle>
            <DialogDescription>
              粘贴从招聘平台复制的简历文本，AI
              将自动提取字段并预填入库表单；未启用 AI 时使用本地规则提取
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 py-2">
            <Textarea
              value={quickAddText}
              onChange={(event) => setQuickAddText(event.target.value)}
              placeholder="粘贴简历文本（姓名、联系方式、技能、工作经历等）..."
              className="min-h-[220px]"
            />
            <p className="text-xs text-gray-400">
              最多 20000 字符；提取后请核对字段并补充授权信息再保存
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setQuickAddOpen(false)}>
              取消
            </Button>
            <Button
              onClick={handleQuickExtract}
              disabled={quickAddLoading}
              className="bg-blue-600 hover:bg-blue-700"
            >
              <Wand2 className="h-4 w-4 mr-2" />
              {quickAddLoading ? '提取中...' : 'AI 提取'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
