'use client';

import { useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import {
  Award,
  Briefcase,
  Building2,
  CheckCircle2,
  Clock,
  RefreshCw,
  Target,
  TrendingUp,
  XCircle,
  Zap,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { authFetch } from '@/lib/auth-client';
import {
  getScoreBg,
  getScoreColor,
  getScoreLabel,
} from '../constants';
import { useWorkspaceData } from '../hooks/use-workspace-data';
import type { MatchRecord } from '../types';

const MatchRadarChart = dynamic(() => import('./match-radar-chart'), {
  ssr: false,
  loading: () => <Skeleton className="h-64 w-full" />,
});

const MATCH_TIMEOUT_MS = 90_000;

export function MatchingWorkspace({
  initialJobId = '',
  initialCandidateId = '',
}: {
  initialJobId?: string;
  initialCandidateId?: string;
}) {
  const { jobs, candidates, reloadMatchRecords } = useWorkspaceData();
  const [selectedJobId, setSelectedJobId] = useState(initialJobId);
  const [selectedCandidateId, setSelectedCandidateId] = useState(initialCandidateId);
  const [matchLoading, setMatchLoading] = useState(false);
  const [matchResult, setMatchResult] = useState<MatchRecord | null>(null);
  const [matchElapsed, setMatchElapsed] = useState(0);

  // 匹配过程计时：让用户看到操作在推进，而非静止转圈
  useEffect(() => {
    if (!matchLoading) return;
    const startedAt = Date.now();
    setMatchElapsed(0);
    const timer = setInterval(() => {
      setMatchElapsed(Math.floor((Date.now() - startedAt) / 1000));
    }, 1000);
    return () => clearInterval(timer);
  }, [matchLoading]);

  async function handleMatch() {
    if (!selectedJobId || !selectedCandidateId) {
      toast.error('请选择职位和候选人');
      return;
    }
    setMatchLoading(true);
    const controller = new AbortController();
    const timeoutTimer = setTimeout(() => controller.abort(), MATCH_TIMEOUT_MS);
    try {
      const response = await authFetch('/api/match', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jobId: selectedJobId,
          candidateId: selectedCandidateId,
        }),
        signal: controller.signal,
      });
      const result = await response.json();
      if (result.success) {
        setMatchResult(result.data);
        await reloadMatchRecords();
        if (result.data.supplement_status === 'unavailable') {
          toast.warning(
            `基础评分已完成（${result.data.overall_score}分），AI补充说明暂不可用`,
          );
        } else {
          toast.success(`匹配完成！综合评分：${result.data.overall_score}分`);
        }
      } else {
        toast.error(result.error || '匹配失败');
      }
    } catch (error) {
      if (controller.signal.aborted) {
        toast.error('匹配耗时过长已中止，请稍后重试');
      } else {
        console.error('匹配失败:', error);
        toast.error('匹配失败，请重试');
      }
    } finally {
      clearTimeout(timeoutTimer);
      setMatchLoading(false);
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <Card className="lg:col-span-1">
        <CardHeader>
          <CardTitle>选择匹配对象</CardTitle>
          <CardDescription>选择职位和候选人进行智能匹配</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Label>选择职位</Label>
            <Select value={selectedJobId} onValueChange={setSelectedJobId}>
              <SelectTrigger>
                <SelectValue placeholder="请选择职位" />
              </SelectTrigger>
              <SelectContent>
                {jobs.map((job) => (
                  <SelectItem key={job.id} value={job.id}>
                    {job.title} - {job.location}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>选择候选人</Label>
            <Select
              value={selectedCandidateId}
              onValueChange={setSelectedCandidateId}
            >
              <SelectTrigger>
                <SelectValue placeholder="请选择候选人" />
              </SelectTrigger>
              <SelectContent>
                {candidates.map((candidate) => (
                  <SelectItem key={candidate.id} value={candidate.id}>
                    {candidate.name} - {candidate.current_position}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button
            className="w-full"
            onClick={handleMatch}
            disabled={
              matchLoading || !selectedJobId || !selectedCandidateId
            }
          >
            {matchLoading ? (
              <>
                <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                AI分析中...
              </>
            ) : (
              <>
                <Target className="h-4 w-4 mr-2" />
                AI智能匹配
              </>
            )}
          </Button>
          {matchLoading && (
            <div className="mt-3 space-y-2 rounded-lg bg-muted/50 p-3 text-xs text-muted-foreground">
              <p className="flex items-center gap-2">
                <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-500" />
                正在读取职位与候选人信息，计算基础评分…
              </p>
              <p className="flex items-center gap-2">
                {matchElapsed >= 3 ? (
                  <RefreshCw className="h-3.5 w-3.5 shrink-0 animate-spin" />
                ) : (
                  <Clock className="h-3.5 w-3.5 shrink-0" />
                )}
                {matchElapsed >= 3
                  ? `基础评分已完成，AI 正在生成补充分析（已 ${matchElapsed} 秒）…`
                  : '等待 AI 补充分析…'}
              </p>
              {matchElapsed >= 30 && (
                <p className="flex items-center gap-2 text-amber-600">
                  <Clock className="h-3.5 w-3.5 shrink-0" />
                  AI 分析耗时较长，仍在进行中，超过 {Math.round(MATCH_TIMEOUT_MS / 1000)} 秒将自动中止
                </p>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="lg:col-span-2">
        <CardHeader>
          <CardTitle>匹配结果</CardTitle>
          <CardDescription>AI多维度评分分析</CardDescription>
        </CardHeader>
        <CardContent>
          {matchResult ? (
            <div className="space-y-6">
              <div className="flex items-center justify-center">
                <div
                  className={`w-32 h-32 rounded-full ${getScoreBg(matchResult.overall_score || 0)} flex items-center justify-center border-4`}
                >
                  <div className="text-center">
                    <p
                      className={`text-4xl font-bold ${getScoreColor(matchResult.overall_score || 0)}`}
                    >
                      {matchResult.overall_score}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {getScoreLabel(matchResult.overall_score || 0)}
                    </p>
                  </div>
                </div>
              </div>

              <div className="h-64">
                <MatchRadarChart match={matchResult} />
              </div>

              <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
                {[
                  {
                    label: '技能评分',
                    score: matchResult.skill_score,
                    icon: <Zap className="h-4 w-4" />,
                    weight: '35%',
                  },
                  {
                    label: '经验评分',
                    score: matchResult.experience_score,
                    icon: <Briefcase className="h-4 w-4" />,
                    weight: '25%',
                  },
                  {
                    label: '薪资评分',
                    score: matchResult.salary_score,
                    icon: <TrendingUp className="h-4 w-4" />,
                    weight: '15%',
                  },
                  {
                    label: '地域评分',
                    score: matchResult.location_score,
                    icon: <Building2 className="h-4 w-4" />,
                    weight: '10%',
                  },
                  {
                    label: '到岗评分',
                    score: matchResult.availability_score,
                    icon: <Clock className="h-4 w-4" />,
                    weight: '10%',
                  },
                  {
                    label: '稳定性评分',
                    score: matchResult.stability_score,
                    icon: <Award className="h-4 w-4" />,
                    weight: '5%',
                  },
                ].map((item) => (
                  <div
                    key={item.label}
                    className={`p-3 rounded-xl ${getScoreBg(item.score || 0)}`}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <div className="flex items-center gap-1">
                        <span className={getScoreColor(item.score || 0)}>
                          {item.icon}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {item.label}
                        </span>
                      </div>
                      <span className="text-xs text-muted-foreground">
                        {item.weight}
                      </span>
                    </div>
                    <p
                      className={`text-xl font-bold ${getScoreColor(item.score || 0)}`}
                    >
                      {item.score || '--'}分
                    </p>
                  </div>
                ))}
              </div>

              {matchResult.match_details && (
                <div className="space-y-4">
                  {matchResult.match_details.strengths.length > 0 && (
                    <div>
                      <h4 className="font-semibold text-emerald-700 mb-2 flex items-center gap-2">
                        <CheckCircle2 className="h-4 w-4" />
                        匹配优势
                      </h4>
                      <ul className="list-disc list-inside space-y-1 text-sm text-muted-foreground">
                        {matchResult.match_details.strengths.map((item) => (
                          <li key={item}>{item}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {matchResult.match_details.gaps.length > 0 && (
                    <div>
                      <h4 className="font-semibold text-amber-700 mb-2 flex items-center gap-2">
                        <XCircle className="h-4 w-4" />
                        需关注
                      </h4>
                      <ul className="list-disc list-inside space-y-1 text-sm text-muted-foreground">
                        {matchResult.match_details.gaps.map((item) => (
                          <li key={item}>{item}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {matchResult.match_details.recommendations && (
                    <div>
                      <h4 className="font-semibold text-blue-700 mb-2">
                        面试建议
                      </h4>
                      <p className="text-sm text-muted-foreground bg-blue-50 p-3 rounded-lg">
                        {matchResult.match_details.recommendations}
                      </p>
                    </div>
                  )}
                  {matchResult.match_details.llm_supplement && (
                    <div>
                      <h4 className="font-semibold text-violet-700 mb-2">
                        AI 补充证据
                      </h4>
                      {matchResult.match_details.llm_supplement.summary && (
                        <p className="text-sm text-muted-foreground mb-2">
                          {matchResult.match_details.llm_supplement.summary}
                        </p>
                      )}
                      {matchResult.match_details.llm_supplement.evidence.length >
                        0 && (
                        <ul className="space-y-2 text-sm text-muted-foreground">
                          {matchResult.match_details.llm_supplement.evidence.map(
                            (item, index) => (
                              <li
                                key={`${item.dimension}-${index}`}
                                className="bg-violet-50 p-3 rounded-lg"
                              >
                                <span className="font-medium text-violet-700">
                                  {item.dimension}：
                                </span>
                                {item.finding}
                                <span className="text-xs text-muted-foreground ml-2">
                                  来源：{item.source}
                                </span>
                              </li>
                            ),
                          )}
                        </ul>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          ) : (
            <div className="h-[400px] flex flex-col items-center justify-center text-muted-foreground">
              <Target className="h-16 w-16 mb-4 text-muted-foreground" />
              <p>选择职位和候选人后，点击「开始智能匹配」</p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
