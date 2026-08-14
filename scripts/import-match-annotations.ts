/**
 * 将匿名双人标注工作簿合并到匹配基准 JSON。
 *
 * 用法：
 *   pnpm eval:import-annotations <标注.xlsx> <基准.json> [输出.json]
 *
 * 输出文件包含标注者姓名和证据摘要，应保存在 private-evaluation 等 Git 忽略目录。
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, extname, resolve } from 'node:path';
import * as XLSX from 'xlsx';
import type { MatchCandidateInput, MatchJobInput } from '@/lib/matching/scorer';

const LABEL_RANKS = {
  强推: 1,
  可谈: 2,
  不推: 3,
} as const;

type AnnotationLabel = keyof typeof LABEL_RANKS;

interface SourceBenchmarkCandidate {
  id: string;
  human_rank: number;
  profile: MatchCandidateInput;
}

interface SourceBenchmark {
  job: MatchJobInput;
  candidates: SourceBenchmarkCandidate[];
}

interface ParsedAnnotation {
  annotatorId: string;
  label: AnnotationLabel;
  rank: number;
  hardFail: boolean;
  hardFailReason: string;
  evidence: string;
  missingInformation: string;
  questions: string;
}

interface ExperienceReview {
  confirmedYears: number | null;
  status: 'confirmed' | 'partial' | 'unknown';
  decision: string;
  evidence: string;
  reviewer: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function readText(row: Record<string, unknown>, column: string): string {
  const value = row[column];
  return value === undefined || value === null ? '' : String(value).trim();
}

function readNumber(row: Record<string, unknown>, column: string): number | null {
  const value = row[column];
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const parsed = Number(String(value ?? '').trim());
  return Number.isFinite(parsed) ? parsed : null;
}

function parseLabel(value: string, context: string): AnnotationLabel {
  if (value in LABEL_RANKS) return value as AnnotationLabel;
  throw new Error(`${context} 的标签必须是“强推 / 可谈 / 不推”之一`);
}

function parseBoolean(value: string, context: string): boolean {
  if (value === '是') return true;
  if (value === '否') return false;
  throw new Error(`${context} 的硬性淘汰必须填写“是”或“否”`);
}

function parseBenchmark(value: unknown): SourceBenchmark {
  if (!isRecord(value) || !isRecord(value.job) || !Array.isArray(value.candidates)) {
    throw new Error('基准 JSON 必须包含 job 和 candidates');
  }
  const candidates = value.candidates.map((candidate, index): SourceBenchmarkCandidate => {
    if (!isRecord(candidate) || typeof candidate.id !== 'string' || !isRecord(candidate.profile)) {
      throw new Error(`基准 candidates[${index}] 格式无效`);
    }
    const humanRank = Number(candidate.human_rank);
    if (!Number.isFinite(humanRank)) {
      throw new Error(`基准候选人 ${candidate.id} 缺少 human_rank`);
    }
    return {
      id: candidate.id,
      human_rank: humanRank,
      profile: candidate.profile as MatchCandidateInput,
    };
  });
  return { job: value.job as MatchJobInput, candidates };
}

function readSheetRows(
  workbook: XLSX.WorkBook,
  sheetName: string,
): Record<string, unknown>[] {
  const sheet = workbook.Sheets[sheetName];
  if (!sheet) throw new Error(`工作簿缺少“${sheetName}”工作表`);
  return XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
    range: 3,
    defval: '',
    raw: true,
  });
}

function rowsByCandidateId(
  rows: readonly Record<string, unknown>[],
  sheetName: string,
): Map<string, Record<string, unknown>> {
  const result = new Map<string, Record<string, unknown>>();
  for (const row of rows) {
    const candidateId = readText(row, 'candidate_id');
    if (!candidateId) continue;
    if (result.has(candidateId)) throw new Error(`${sheetName} 存在重复编号 ${candidateId}`);
    result.set(candidateId, row);
  }
  return result;
}

function parseAnnotation(
  row: Record<string, unknown>,
  candidateId: string,
  sheetName: string,
): ParsedAnnotation {
  const label = parseLabel(readText(row, '标签'), `${sheetName}/${candidateId}`);
  const annotatorId = readText(row, '标注者');
  if (!annotatorId) throw new Error(`${sheetName}/${candidateId} 缺少标注者`);
  const hardFail = parseBoolean(readText(row, '硬性淘汰'), `${sheetName}/${candidateId}`);
  const evidence = readText(row, '证据出处');
  if (!evidence) throw new Error(`${sheetName}/${candidateId} 缺少证据出处`);
  const hardFailReason = readText(row, '硬性淘汰原因');
  if (hardFail && !hardFailReason) {
    throw new Error(`${sheetName}/${candidateId} 标记硬性淘汰后必须填写原因`);
  }
  return {
    annotatorId,
    label,
    rank: LABEL_RANKS[label],
    hardFail,
    hardFailReason,
    evidence,
    missingInformation: readText(row, '缺失信息'),
    questions: readText(row, '待确认问题'),
  };
}

function parseExperienceReviews(
  rows: readonly Record<string, unknown>[],
): Map<string, ExperienceReview> {
  const result = new Map<string, ExperienceReview>();
  for (const row of rows) {
    const candidateId = readText(row, 'candidate_id');
    if (!candidateId) continue;
    const confirmedYears = readNumber(row, 'HR确认年限');
    const decision = readText(row, '处理结论');
    const evidence = readText(row, '复核依据');
    const reviewer = readText(row, '复核人');
    if (!decision || !evidence || !reviewer) {
      throw new Error(`年限复核/${candidateId} 必须填写处理结论、复核依据和复核人`);
    }
    const status = decision.includes('部分确认')
      ? 'partial'
      : decision.includes('无法确认')
        ? 'unknown'
        : 'confirmed';
    if (status === 'confirmed' && (confirmedYears === null || confirmedYears < 0)) {
      throw new Error(`年限复核/${candidateId} 的确认结论缺少有效年限`);
    }
    result.set(candidateId, {
      confirmedYears: status === 'confirmed' ? confirmedYears : null,
      status,
      decision,
      evidence,
      reviewer,
    });
  }
  return result;
}

function main(): void {
  const workbookArgument = process.argv[2];
  const benchmarkArgument = process.argv[3];
  if (!workbookArgument || !benchmarkArgument) {
    throw new Error('用法: pnpm eval:import-annotations <标注.xlsx> <基准.json> [输出.json]');
  }
  const workbookPath = resolve(process.cwd(), workbookArgument);
  const benchmarkPath = resolve(process.cwd(), benchmarkArgument);
  const outputPath = process.argv[4]
    ? resolve(process.cwd(), process.argv[4])
    : resolve(
      process.cwd(),
      'private-evaluation',
      'match-benchmarks',
      `${basename(benchmarkPath, extname(benchmarkPath))}.annotated.json`,
    );

  const workbook = XLSX.readFile(workbookPath, { cellDates: true });
  const benchmark = parseBenchmark(JSON.parse(readFileSync(benchmarkPath, 'utf8')) as unknown);
  const hrRows = rowsByCandidateId(readSheetRows(workbook, 'HR标注'), 'HR标注');
  const expertRows = rowsByCandidateId(readSheetRows(workbook, '业务专家标注'), '业务专家标注');
  const adjudicationRows = rowsByCandidateId(readSheetRows(workbook, '仲裁'), '仲裁');
  const experienceReviews = parseExperienceReviews(readSheetRows(workbook, '年限复核'));

  const outputCandidates = benchmark.candidates.map(candidate => {
    const hrRow = hrRows.get(candidate.id);
    const expertRow = expertRows.get(candidate.id);
    if (!hrRow || !expertRow) throw new Error(`候选人 ${candidate.id} 缺少双人标注`);
    const hr = parseAnnotation(hrRow, candidate.id, 'HR标注');
    const expert = parseAnnotation(expertRow, candidate.id, '业务专家标注');
    if (hr.annotatorId === expert.annotatorId) {
      throw new Error(`候选人 ${candidate.id} 的两份标注不能来自同一标注者`);
    }

    const agrees = hr.label === expert.label && hr.hardFail === expert.hardFail;
    const adjudicationRow = adjudicationRows.get(candidate.id);
    let finalLabel: AnnotationLabel;
    let finalHardFail: boolean;
    let adjudicationReason = '';
    if (agrees) {
      finalLabel = hr.label;
      finalHardFail = hr.hardFail;
    } else {
      if (!adjudicationRow) throw new Error(`候选人 ${candidate.id} 存在分歧但缺少仲裁行`);
      finalLabel = parseLabel(readText(adjudicationRow, '最终标签'), `仲裁/${candidate.id}`);
      finalHardFail = parseBoolean(
        readText(adjudicationRow, '最终硬性淘汰'),
        `仲裁/${candidate.id}`,
      );
      adjudicationReason = readText(adjudicationRow, '仲裁理由');
      if (!adjudicationReason || !readText(adjudicationRow, '仲裁人')) {
        throw new Error(`仲裁/${candidate.id} 必须填写仲裁理由和仲裁人`);
      }
    }

    const experienceReview = experienceReviews.get(candidate.id);
    const profile = experienceReview
      ? {
          ...candidate.profile,
          experience_years: experienceReview.confirmedYears,
          verified_experience_years: experienceReview.confirmedYears,
          experience_years_status: experienceReview.status,
          experience_years_evidence: experienceReview.evidence,
        }
      : candidate.profile;
    return {
      ...candidate,
      human_rank: LABEL_RANKS[finalLabel],
      hard_fail: finalHardFail,
      profile,
      annotations: [
        {
          annotator_id: hr.annotatorId,
          human_rank: hr.rank,
          hard_fail: hr.hardFail,
          hard_fail_reason: hr.hardFailReason,
          evidence: hr.evidence,
          missing_information: hr.missingInformation,
          questions: hr.questions,
        },
        {
          annotator_id: expert.annotatorId,
          human_rank: expert.rank,
          hard_fail: expert.hardFail,
          hard_fail_reason: expert.hardFailReason,
          evidence: expert.evidence,
          missing_information: expert.missingInformation,
          questions: expert.questions,
        },
      ],
      adjudication: agrees ? null : { reason: adjudicationReason },
      experience_review: experienceReview ?? null,
    };
  });

  const output = {
    metadata: {
      source_benchmark: basename(benchmarkPath),
      annotation_workbook: basename(workbookPath),
      imported_at: new Date().toISOString(),
      privacy: 'PRIVATE: contains annotator names and resume evidence summaries; do not publish.',
    },
    job: benchmark.job,
    candidates: outputCandidates,
  };
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
  console.log(`已导入 ${outputCandidates.length} 名候选人的双人标注: ${outputPath}`);
}

main();
