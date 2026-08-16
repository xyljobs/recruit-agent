import { STATUS_CONFIG } from '../constants';
import type { Candidate, MatchRecord } from '../types';

// Excel 单元格最多容纳 32767 个字符，超长简历需截断以避免生成损坏的文件
export const EXCEL_CELL_MAX_CHARS = 32767;

export async function exportCandidates(candidates: Candidate[]) {
  const XLSX = await import('xlsx');
  const data = candidates.map((candidate) => {
    const resumeText = candidate.resume_text || '';
    const truncatedResumeText =
      resumeText.length > EXCEL_CELL_MAX_CHARS
        ? `${resumeText.slice(0, EXCEL_CELL_MAX_CHARS - 12)}…（已截断）`
        : resumeText;
    return {
      姓名: candidate.name,
      邮箱: candidate.email || '',
      电话: candidate.phone || '',
      当前公司: candidate.current_company || '',
      当前职位: candidate.current_position || '',
      工作年限: candidate.experience_years || 0,
      学历: candidate.education || '',
      技能: candidate.skills?.join('、') || '',
      原始简历: truncatedResumeText,
      创建时间: new Date(candidate.created_at).toLocaleString('zh-CN'),
    };
  });
  const worksheet = XLSX.utils.json_to_sheet(data);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, '候选人');
  XLSX.writeFile(
    workbook,
    `候选人列表_${new Date().toLocaleDateString('zh-CN')}.xlsx`,
  );
}

export async function exportMatchRecords(matchRecords: MatchRecord[]) {
  const XLSX = await import('xlsx');
  const data = matchRecords.map((record) => ({
    候选人: record.candidate?.name || '',
    职位: record.job?.title || '',
    综合评分: record.overall_score || 0,
    技能评分: record.skill_score || 0,
    经验评分: record.experience_score || 0,
    学历评分: record.education_score || 0,
    状态: STATUS_CONFIG[record.status]?.label || record.status,
    优势: record.match_details?.strengths?.join('；') || '',
    差距: record.match_details?.gaps?.join('；') || '',
    创建时间: new Date(record.created_at).toLocaleString('zh-CN'),
  }));
  const worksheet = XLSX.utils.json_to_sheet(data);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, '匹配记录');
  XLSX.writeFile(
    workbook,
    `匹配记录_${new Date().toLocaleDateString('zh-CN')}.xlsx`,
  );
}
