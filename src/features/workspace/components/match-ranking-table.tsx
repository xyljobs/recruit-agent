'use client';

import { useMemo, useState } from 'react';
import { AlertCircle, ArrowDown, ArrowUp, ChevronDown } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import {
  buildVerdictRationale,
  collectHardConstraints,
  deriveMatchVerdict,
  formatExperienceYears,
} from '@/lib/matching/verdict';
import { cn } from '@/lib/utils';
import { DECISION_LABELS, getScoreColor } from '../constants';
import type { ShortlistEntry } from '../decision-types';

interface MatchRankingTableProps {
  entries: ShortlistEntry[];
  onOpenProfile: (candidateId: string) => void;
  onGotoDecision: (entryId: string) => void;
}

type SortMode = 'rank' | 'overall' | 'years' | 'confidence';

interface RankingRow {
  entry: ShortlistEntry;
  verdict: ReturnType<typeof deriveMatchVerdict>;
  years: ReturnType<typeof formatExperienceYears>;
  effectiveYears: number;
  rationale: string;
}

function buildRankingRow(entry: ShortlistEntry): RankingRow {
  const skillAnalysis = entry.match_details?.skill_analysis;
  const matched = skillAnalysis?.matched ?? [];
  const missing = skillAnalysis?.missing ?? [];
  const authorization = entry.candidate?.authorization;
  const verdict = deriveMatchVerdict({
    overall_score: entry.overall_score ?? null,
    confidence_score: entry.confidence_score,
    required_skill_total: matched.length + missing.length,
    required_skill_matched: matched.length,
    hard_constraints: collectHardConstraints({
      authorization_is_active: authorization?.is_active,
      processing_expires_at: authorization?.processing_expires_at,
      automated_decision_objected_at: authorization?.automated_decision_objected_at,
      skill_matched: matched,
      skill_missing: missing,
    }),
    boundary_flags: [],
  });
  const years = formatExperienceYears({
    experience_years: entry.candidate?.experience_years,
    verified_experience_years: entry.candidate?.verified_experience_years,
    experience_years_status: entry.candidate?.experience_years_status,
  });
  const effectiveYears = entry.candidate?.verified_experience_years
    ?? entry.candidate?.experience_years
    ?? 0;
  const rationale = buildVerdictRationale({
    llm_summary: entry.match_details?.llm_supplement?.summary,
    evidence_findings: entry.evidence_snapshot,
    gaps: entry.match_details?.gaps,
    missing_information: entry.missing_information,
  });
  return { entry, verdict, years, effectiveYears, rationale };
}

function SortableHeadButton({
  label,
  active,
  ascending,
  onClick,
}: {
  label: string;
  active: boolean;
  ascending: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'inline-flex items-center gap-1 transition-colors hover:text-slate-900',
        active && 'text-blue-700 hover:text-blue-800',
      )}
    >
      {label}
      {active && (ascending ? <ArrowUp className="h-3.5 w-3.5" /> : <ArrowDown className="h-3.5 w-3.5" />)}
    </button>
  );
}

function RankingTable({
  rows,
  dashRank,
  sortMode,
  onSortChange,
  onOpenProfile,
  onGotoDecision,
}: {
  rows: RankingRow[];
  dashRank: boolean;
  sortMode: SortMode;
  onSortChange: (mode: SortMode) => void;
  onOpenProfile: (candidateId: string) => void;
  onGotoDecision: (entryId: string) => void;
}) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="w-20">
            <SortableHeadButton
              label={sortMode === 'overall' ? '综合分' : '排名'}
              active={sortMode === 'rank' || sortMode === 'overall'}
              ascending={sortMode === 'rank'}
              onClick={() => onSortChange(sortMode === 'overall' ? 'rank' : 'overall')}
            />
          </TableHead>
          <TableHead>候选人</TableHead>
          <TableHead className="w-24">
            <SortableHeadButton
              label="年限"
              active={sortMode === 'years'}
              ascending={false}
              onClick={() => onSortChange(sortMode === 'years' ? 'rank' : 'years')}
            />
          </TableHead>
          <TableHead>结论</TableHead>
          <TableHead>判断依据</TableHead>
          <TableHead className="w-24">
            <SortableHeadButton
              label="置信度"
              active={sortMode === 'confidence'}
              ascending={false}
              onClick={() => onSortChange(sortMode === 'confidence' ? 'rank' : 'confidence')}
            />
          </TableHead>
          <TableHead className="w-28">人工决策</TableHead>
          <TableHead className="w-20">操作</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => (
          <TableRow key={row.entry.id}>
            <TableCell className="font-medium text-slate-900">
              {dashRank ? <span className="text-slate-400">—</span> : row.entry.rank}
            </TableCell>
            <TableCell>
              <button
                type="button"
                onClick={() => onOpenProfile(row.entry.candidate_id)}
                className="max-w-44 truncate text-left font-medium text-blue-700 hover:text-blue-900 hover:underline underline-offset-4"
              >
                {row.entry.candidate?.name || `候选人 ${row.entry.rank}`}
              </button>
              {[row.entry.candidate?.current_position, row.entry.candidate?.current_company]
                .filter(Boolean).join(' · ') && (
                <p className="mt-0.5 max-w-44 truncate text-xs text-slate-500">
                  {[row.entry.candidate?.current_position, row.entry.candidate?.current_company]
                    .filter(Boolean).join(' · ')}
                </p>
              )}
            </TableCell>
            <TableCell>
              <span className="text-sm text-slate-800">{row.years.text}</span>
              <Badge variant="outline" className="ml-1.5 border-slate-200 text-slate-600">{row.years.badge}</Badge>
            </TableCell>
            <TableCell>
              <div className="flex max-w-64 flex-wrap items-center gap-1.5">
                <Badge variant="outline" className={row.verdict.tone}>{row.verdict.label}</Badge>
                {row.verdict.boundary_labels.map((label) => (
                  <Badge key={label} variant="outline" className="border-amber-200 bg-amber-50 text-amber-800">{label}</Badge>
                ))}
                {row.verdict.grade === 'not_recommended' && row.verdict.reasons.length > 0 && (
                  row.verdict.reasons.length > 1 ? (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Badge variant="outline" className="max-w-44 cursor-default truncate border-red-200 bg-red-50 text-red-700">
                          {row.verdict.reasons[0]}
                        </Badge>
                      </TooltipTrigger>
                      <TooltipContent className="max-w-80">
                        <p className="whitespace-pre-wrap text-xs leading-5">{row.verdict.reasons.join('\n')}</p>
                      </TooltipContent>
                    </Tooltip>
                  ) : (
                    <Badge variant="outline" className="max-w-44 truncate border-red-200 bg-red-50 text-red-700">
                      {row.verdict.reasons[0]}
                    </Badge>
                  )
                )}
                {row.entry.human_decision === 'overridden' && (
                  <Badge className="bg-violet-100 text-violet-800">已人工覆盖</Badge>
                )}
                {row.verdict.grade === 'not_recommended' && (
                  <span className="text-[10px] leading-4 text-slate-400">可人工覆盖</span>
                )}
              </div>
            </TableCell>
            <TableCell>
              <p className="max-w-72 truncate text-xs leading-5 text-slate-600" title={row.rationale}>
                {row.rationale}
              </p>
            </TableCell>
            <TableCell>
              <span className={cn('text-sm font-medium', getScoreColor(row.entry.confidence_score))}>
                {row.entry.confidence_score}%
              </span>
            </TableCell>
            <TableCell>
              <span className="text-sm text-slate-700">{DECISION_LABELS[row.entry.human_decision]}</span>
            </TableCell>
            <TableCell>
              <Button variant="outline" size="sm" onClick={() => onGotoDecision(row.entry.id)}>去决策</Button>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

export function MatchRankingTable({ entries, onOpenProfile, onGotoDecision }: MatchRankingTableProps) {
  const [sortMode, setSortMode] = useState<SortMode>('rank');

  const rows = useMemo(() => {
    const built = entries.map(buildRankingRow);
    return built.sort((left, right) => {
      switch (sortMode) {
        case 'overall':
          return (right.entry.overall_score ?? 0) - (left.entry.overall_score ?? 0);
        case 'years':
          return right.effectiveYears - left.effectiveYears;
        case 'confidence':
          return right.entry.confidence_score - left.entry.confidence_score;
        case 'rank':
        default:
          return left.entry.rank - right.entry.rank;
      }
    });
  }, [entries, sortMode]);

  const mainRows = useMemo(
    () => rows.filter((row) => row.verdict.grade !== 'not_recommended'),
    [rows],
  );
  const notRecommendedRows = useMemo(
    () => rows.filter((row) => row.verdict.grade === 'not_recommended'),
    [rows],
  );

  if (entries.length === 0) {
    return (
      <Alert>
        <AlertCircle className="h-4 w-4" />
        <AlertTitle>本批暂无排序条目</AlertTitle>
        <AlertDescription>短名单正在准备，请稍后刷新。</AlertDescription>
      </Alert>
    );
  }

  const tableProps = {
    sortMode,
    onSortChange: setSortMode,
    onOpenProfile,
    onGotoDecision,
  } as const;

  return (
    <TooltipProvider>
      <div className="space-y-4">
        <Card className="gap-0 overflow-hidden border-slate-200 py-0 shadow-none">
          <CardContent className="p-0">
            <RankingTable rows={mainRows} dashRank={false} {...tableProps} />
          </CardContent>
        </Card>
        {notRecommendedRows.length > 0 && (
          <Collapsible>
            <CollapsibleTrigger asChild>
              <Button variant="ghost" className="w-full justify-between border border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100">
                <span className="inline-flex items-center gap-2">
                  <AlertCircle className="h-4 w-4 text-red-500" />
                  不建议推进（{notRecommendedRows.length}）
                </span>
                <ChevronDown className="h-4 w-4" />
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <Card className="mt-2 gap-0 overflow-hidden border-slate-200 py-0 shadow-none">
                <CardContent className="p-0">
                  <RankingTable rows={notRecommendedRows} dashRank {...tableProps} />
                </CardContent>
              </Card>
            </CollapsibleContent>
          </Collapsible>
        )}
      </div>
    </TooltipProvider>
  );
}
