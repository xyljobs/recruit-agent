'use client';

import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  Briefcase,
  Building2,
  ChevronDown,
  GraduationCap,
  LoaderCircle,
  Mail,
  Phone,
  Plus,
  Upload,
} from 'lucide-react';
import { toast } from 'sonner';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Textarea } from '@/components/ui/textarea';
import { authFetch } from '@/lib/auth-client';
import { AUTHORIZATION_NOTICE_VERSION } from '@/lib/privacy/authorization-shared';
import type { ResumeStructure } from '@/lib/recruiting/resume-structure';
import mammoth from 'mammoth';
import { useWorkspaceData } from '../hooks/use-workspace-data';
import { uploadCandidateResumeFile } from '../lib/resume-file';
import type { Candidate, CandidateForm, MatchRecord } from '../types';

interface DecisionExplanation {
  decision_role: string;
  scores: {
    overall: number | null;
  };
  explanation: {
    strengths?: string[];
    gaps?: string[];
    recommendations?: string;
  } | null;
  rights: string[];
}

const AUTHORIZATION_SOURCE_LABELS: Record<string, string> = {
  candidate_portal: '候选人自助页面',
  email: '邮件确认',
  paper: '纸质签署',
  recruitment_platform: '招聘平台授权记录',
  other: '其他可核验渠道',
};

/** 合规留痕里的长引用（来源引用 / 评估编号 / sha256 摘要）：截断展示，hover 看全，点击复制 */
function CopyableReference({ value }: { value: string }) {
  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      toast.success('已复制完整编号');
    } catch {
      toast.error('复制失败，请手动选择');
    }
  };
  return (
    <button
      type="button"
      onClick={() => void handleCopy()}
      title={value}
      className="break-all font-mono text-slate-500 underline decoration-dotted underline-offset-2 transition-colors hover:text-slate-800"
    >
      {value.length > 16 ? `${value.slice(0, 16)}…` : value}
    </button>
  );
}

const MATCH_STATUS_LABELS: Record<string, string> = {
  pending: '待接触',
  contacted: '已联系',
  interviewing: '面试中',
  offered: '已发Offer',
  hired: '已录用',
  rejected: '已拒绝',
  withdrawn: '已撤回',
};

export interface DuplicateCandidateHint {
  id: string;
  name: string;
  created_at: string | null;
  created_by_name: string | null;
  source_job_title: string | null;
  source_job_binding_status: 'active' | 'expired' | null;
  last_match: {
    overall_score: number | null;
    status: string | null;
    job_title: string | null;
  } | null;
}

export const EMPTY_CANDIDATE_FORM: CandidateForm = {
  name: '',
  email: '',
  phone: '',
  current_company: '',
  current_position: '',
  experience_years: 0,
  education: '',
  skills: [],
  resume_text: '',
  current_city: '',
  preferred_locations: [],
  salary_expectation: '',
  salary_min: 0,
  salary_max: 0,
  availability: '',
  job_change_frequency: null,
  authorization: {
    confirmed: false,
    source_type: '',
    source_reference: '',
    proof_type: '',
    proof_reference: '',
    proof_sha256: '',
    controller_name: '',
    controller_contact: '',
    authorized_at: '',
    processing_expires_at: '',
    external_processors_text: '',
    automated_decision_preference: '',
    impact_assessment_reference: '',
    impact_assessment_completed_at: '',
  },
};

export function CandidateFormDialog({
  open: controlledOpen,
  onOpenChange: controlledOnOpenChange,
  initialValues,
  duplicates,
  lockedJobId,
  hideTrigger,
}: {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  initialValues?: CandidateForm | null;
  duplicates?: DuplicateCandidateHint[];
  lockedJobId?: string | null;
  hideTrigger?: boolean;
} = {}) {
  const { reloadCandidates, jobs } = useWorkspaceData();
  const [internalOpen, setInternalOpen] = useState(false);
  const [form, setForm] = useState<CandidateForm>(EMPTY_CANDIDATE_FORM);
  const [skillInput, setSkillInput] = useState('');
  const [locationInput, setLocationInput] = useState('');
  const [duplicateConfirmed, setDuplicateConfirmed] = useState(false);
  const open = controlledOpen ?? internalOpen;
  const setOpen = controlledOnOpenChange ?? setInternalOpen;

  // 快捷入库预填：initialValues 变化时重置表单（授权子表单做深合并）；
  // 从职位页发起入库时锁定职位，强制绑定该职位
  useEffect(() => {
    if (!initialValues && !lockedJobId) return;
    setForm({
      ...EMPTY_CANDIDATE_FORM,
      ...initialValues,
      source_job_id: lockedJobId ?? initialValues?.source_job_id ?? null,
      authorization: {
        ...EMPTY_CANDIDATE_FORM.authorization,
        ...(initialValues?.authorization ?? {}),
      },
    });
  }, [initialValues, lockedJobId]);

  // 重复提示切换时重置二次确认
  useEffect(() => {
    setDuplicateConfirmed(false);
  }, [duplicates]);

  function addSkill() {
    const skill = skillInput.trim();
    if (skill && !form.skills.includes(skill)) {
      setForm((current) => ({ ...current, skills: [...current.skills, skill] }));
      setSkillInput('');
    }
  }

  function addLocation() {
    const location = locationInput.trim();
    if (location && !form.preferred_locations.includes(location)) {
      setForm((current) => ({
        ...current,
        preferred_locations: [...current.preferred_locations, location],
      }));
      setLocationInput('');
    }
  }

  async function handleSubmit() {
    if (!form.name.trim()) {
      toast.error('请填写候选人姓名');
      return;
    }
    if (!form.source_job_id) {
      toast.error('请选择关联职位（候选人入库需绑定职位）');
      return;
    }
    if (duplicates && duplicates.length > 0 && !duplicateConfirmed) {
      toast.error('请先勾选确认：该候选人可能与库中已有记录重复');
      return;
    }
    const authorization = form.authorization;
    if (!authorization.confirmed) {
      toast.error('请明确确认候选人已充分知情并自愿授权');
      return;
    }
    if (
      !authorization.source_type
      || !authorization.source_reference.trim()
      || !authorization.proof_type
      || !authorization.proof_reference.trim()
      || !authorization.controller_name.trim()
      || !authorization.controller_contact.trim()
      || !authorization.authorized_at
      || !authorization.processing_expires_at
      || !authorization.automated_decision_preference
    ) {
      toast.error('请完整填写授权来源、证明材料、告知与处理期限');
      return;
    }
    const externalProcessors = authorization.external_processors_text
      .split('\n')
      .map((value) => value.trim())
      .filter(Boolean);
    if (externalProcessors.length === 0) {
      toast.error('请列明实际参与处理候选人信息的外部处理方');
      return;
    }
    if (
      authorization.automated_decision_preference === 'assistive'
      && (
        !authorization.impact_assessment_reference.trim()
        || !authorization.impact_assessment_completed_at
      )
    ) {
      toast.error('启用自动化辅助匹配前，请关联已完成的个人信息保护影响评估');
      return;
    }

    try {
      const response = await authFetch('/api/candidates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...form,
          authorization: {
            ...authorization,
            authorized_at: new Date(
              authorization.authorized_at,
            ).toISOString(),
            processing_expires_at: new Date(
              authorization.processing_expires_at,
            ).toISOString(),
            impact_assessment_completed_at:
              authorization.impact_assessment_completed_at
                ? new Date(
                    authorization.impact_assessment_completed_at,
                  ).toISOString()
                : '',
            external_processors: externalProcessors,
          },
        }),
      });
      const result = await response.json();
      if (result.success) {
        setOpen(false);
        setForm(EMPTY_CANDIDATE_FORM);
        setDuplicateConfirmed(false);
        await reloadCandidates();
        toast.success('候选人添加成功！');
      } else {
        toast.error(result.error || '添加失败');
      }
    } catch (error) {
      console.error('添加候选人失败:', error);
      toast.error('添加失败，请重试');
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {!hideTrigger && (
        <DialogTrigger asChild>
          <Button size="sm">
            <Plus className="h-4 w-4 mr-2" />
            添加候选人
          </Button>
        </DialogTrigger>
      )}
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>添加候选人</DialogTitle>
          <DialogDescription>录入候选人基本信息</DialogDescription>
        </DialogHeader>
        {duplicates && duplicates.length > 0 && (
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>该候选人可能已存在</AlertTitle>
            <AlertDescription className="space-y-2">
              <p>
                检测到库中已有记录：{duplicates.map((item) => item.name).join('、')}
                。请核对以下历史信息后决定是否继续保存：
              </p>
              <div className="space-y-2">
                {duplicates.map((item) => (
                  <div
                    key={item.id}
                    className="rounded-md border border-red-200 bg-white/70 p-2 text-xs space-y-1"
                  >
                    <p className="font-medium text-slate-900">
                      {item.name}
                      <span className="ml-2 font-normal text-muted-foreground">
                        {item.created_at
                          ? `${new Date(item.created_at).toLocaleDateString('zh-CN')} 入库`
                          : '入库时间未知'}
                      </span>
                    </p>
                    {item.created_by_name && (
                      <p>录入人：{item.created_by_name}</p>
                    )}
                    {item.source_job_title && (
                      <p>
                        曾绑定职位：{item.source_job_title}
                        {item.source_job_binding_status === 'expired' && (
                          <span className="ml-1 text-amber-600">（绑定已过期）</span>
                        )}
                      </p>
                    )}
                    {item.last_match && (
                      <p>
                        最近匹配：{item.last_match.job_title ?? '未知职位'}
                        {item.last_match.overall_score !== null && (
                          <span className="ml-1 font-medium">
                            {item.last_match.overall_score}分
                          </span>
                        )}
                        {item.last_match.status && (
                          <span className="ml-1">
                            · {MATCH_STATUS_LABELS[item.last_match.status] ?? item.last_match.status}
                          </span>
                        )}
                      </p>
                    )}
                  </div>
                ))}
              </div>
              <div className="flex items-start gap-2">
                <input
                  type="checkbox"
                  id="duplicate_confirmed"
                  checked={duplicateConfirmed}
                  onChange={(event) =>
                    setDuplicateConfirmed(event.target.checked)
                  }
                  className="mt-1 rounded"
                />
                <label
                  htmlFor="duplicate_confirmed"
                  className="text-sm font-normal leading-5"
                >
                  我已核对，确认需要继续保存该候选人
                </label>
              </div>
            </AlertDescription>
          </Alert>
        )}
        <div className="grid gap-4 py-4">
          <div>
            <Label>关联职位 *</Label>
            <Select
              value={form.source_job_id ?? ''}
              onValueChange={(source_job_id) =>
                setForm((current) => ({ ...current, source_job_id }))
              }
              disabled={Boolean(lockedJobId)}
            >
              <SelectTrigger>
                <SelectValue placeholder="选择候选人应聘的职位" />
              </SelectTrigger>
              <SelectContent>
                {jobs
                  .filter((job) => job.status === 'active')
                  .map((job) => (
                    <SelectItem key={job.id} value={job.id}>
                      {job.title}
                      {job.department ? ` · ${job.department}` : ''}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground mt-1">
              {lockedJobId
                ? '已从职位发起入库，候选人将绑定该职位'
                : '候选人入库必须绑定职位；职位关闭或招聘定论后绑定自动过期'}
            </p>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label htmlFor="name">姓名 *</Label>
              <Input
                id="name"
                value={form.name}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    name: event.target.value,
                  }))
                }
                placeholder="请输入姓名"
              />
            </div>
            <div>
              <Label htmlFor="phone">电话</Label>
              <Input
                id="phone"
                value={form.phone}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    phone: event.target.value,
                  }))
                }
                placeholder="请输入电话"
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label htmlFor="email">邮箱</Label>
              <Input
                id="email"
                type="email"
                value={form.email}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    email: event.target.value,
                  }))
                }
                placeholder="请输入邮箱"
              />
            </div>
            <div>
              <Label htmlFor="experience">工作年限</Label>
              <Input
                id="experience"
                type="number"
                value={form.experience_years}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    experience_years: Number.parseInt(event.target.value) || 0,
                  }))
                }
                placeholder="0"
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label htmlFor="company">当前公司</Label>
              <Input
                id="company"
                value={form.current_company}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    current_company: event.target.value,
                  }))
                }
                placeholder="请输入公司名称"
              />
            </div>
            <div>
              <Label htmlFor="position">当前职位</Label>
              <Input
                id="position"
                value={form.current_position}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    current_position: event.target.value,
                  }))
                }
                placeholder="请输入职位"
              />
            </div>
          </div>
          <div>
            <Label htmlFor="education">学历</Label>
            <Select
              value={form.education}
              onValueChange={(education) =>
                setForm((current) => ({ ...current, education }))
              }
            >
              <SelectTrigger id="education">
                <SelectValue placeholder="请选择学历" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="大专">大专</SelectItem>
                <SelectItem value="本科">本科</SelectItem>
                <SelectItem value="硕士">硕士</SelectItem>
                <SelectItem value="博士">博士</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label htmlFor="skill-input">技能标签</Label>
            <div className="flex gap-2 mb-2">
              <Input
                id="skill-input"
                placeholder="输入技能后回车"
                value={skillInput}
                onChange={(event) => setSkillInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    addSkill();
                  }
                }}
              />
              <Button type="button" onClick={addSkill}>
                添加
              </Button>
            </div>
            <div className="flex flex-wrap gap-2">
              {form.skills.map((skill) => (
                <Badge
                  key={skill}
                  variant="secondary"
                  className="cursor-pointer hover:bg-red-100 hover:text-red-700"
                  onClick={() =>
                    setForm((current) => ({
                      ...current,
                      skills: current.skills.filter((item) => item !== skill),
                    }))
                  }
                >
                  {skill} ×
                </Badge>
              ))}
            </div>
          </div>
          <div>
            <Label htmlFor="resume">简历摘要</Label>
            <Textarea
              id="resume"
              placeholder="请输入简历摘要或关键信息..."
              value={form.resume_text}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  resume_text: event.target.value,
                }))
              }
              className="min-h-[80px]"
            />
          </div>

          <div className="border-t pt-4 mt-2">
            <h4 className="font-medium mb-3 text-sm text-muted-foreground">
              匹配评分信息（用于智能匹配）
            </h4>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="current_city">当前城市</Label>
                <Input
                  id="current_city"
                  value={form.current_city}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      current_city: event.target.value,
                    }))
                  }
                  placeholder="如：杭州"
                />
              </div>
              <div>
                <Label>期望薪资(K)</Label>
                <div className="flex gap-2">
                  <Input
                    aria-label="期望最低薪资"
                    type="number"
                    placeholder="最低"
                    value={form.salary_min || ''}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        salary_min: Number.parseInt(event.target.value) || 0,
                      }))
                    }
                    className="w-20"
                  />
                  <span className="flex items-center">-</span>
                  <Input
                    aria-label="期望最高薪资"
                    type="number"
                    placeholder="最高"
                    value={form.salary_max || ''}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        salary_max: Number.parseInt(event.target.value) || 0,
                      }))
                    }
                    className="w-20"
                  />
                  <span className="flex items-center">K</span>
                </div>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4 mt-4">
              <div>
                <Label htmlFor="availability">到岗时间</Label>
                <Select
                  value={form.availability}
                  onValueChange={(availability) =>
                    setForm((current) => ({ ...current, availability }))
                  }
                >
                  <SelectTrigger id="availability">
                    <SelectValue placeholder="请选择" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="immediately">随时到岗</SelectItem>
                    <SelectItem value="1week">1周内</SelectItem>
                    <SelectItem value="2weeks">2周内</SelectItem>
                    <SelectItem value="1month">1个月内</SelectItem>
                    <SelectItem value="negotiable">面议</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label htmlFor="location-input">意向城市</Label>
                <Input
                  id="location-input"
                  placeholder="输入后回车"
                  value={locationInput}
                  onChange={(event) => setLocationInput(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault();
                      addLocation();
                    }
                  }}
                />
                <div className="flex flex-wrap gap-1 mt-2">
                  {form.preferred_locations.map((location) => (
                    <Badge
                      key={location}
                      variant="outline"
                      className="cursor-pointer hover:bg-red-100"
                      onClick={() =>
                        setForm((current) => ({
                          ...current,
                          preferred_locations:
                            current.preferred_locations.filter(
                              (item) => item !== location,
                            ),
                        }))
                      }
                    >
                      {location} ×
                    </Badge>
                  ))}
                </div>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4 mt-4">
              <div>
                <Label htmlFor="job_change_frequency">跳槽频率(次/年)</Label>
                <Input
                  id="job_change_frequency"
                  type="number"
                  step="0.1"
                  min="0"
                  max="5"
                  placeholder="如: 0.5"
                  value={form.job_change_frequency ?? ''}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      job_change_frequency: event.target.value
                        ? Number.parseFloat(event.target.value)
                        : null,
                    }))
                  }
                />
                <p className="text-xs text-muted-foreground mt-1">
                  过去3年平均每年跳槽次数，用于稳定性评估
                </p>
              </div>
            </div>
            <div className="mt-6 space-y-4 rounded-lg border border-blue-200 bg-blue-50/40 p-4">
              <div>
                <h4 className="font-medium text-slate-900">授权证据（必填）</h4>
                <p className="mt-1 text-xs leading-5 text-slate-600">
                  授权不会默认选中。请登记候选人实际看到的告知、明确同意的来源和可核验材料；这里只保存材料编号或受控位置。
                </p>
              </div>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div>
                  <Label>授权来源 *</Label>
                  <Select
                    value={form.authorization.source_type}
                    onValueChange={(source_type) =>
                      setForm((current) => ({
                        ...current,
                        authorization: {
                          ...current.authorization,
                          source_type,
                        },
                      }))
                    }
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="请选择实际授权渠道" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="candidate_portal">候选人自助页面</SelectItem>
                      <SelectItem value="email">邮件确认</SelectItem>
                      <SelectItem value="paper">纸质签署</SelectItem>
                      <SelectItem value="recruitment_platform">
                        招聘平台授权记录
                      </SelectItem>
                      <SelectItem value="other">其他可核验渠道</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label htmlFor="authorized_at">授权时间 *</Label>
                  <Input
                    id="authorized_at"
                    type="datetime-local"
                    value={form.authorization.authorized_at}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        authorization: {
                          ...current.authorization,
                          authorized_at: event.target.value,
                        },
                      }))
                    }
                  />
                </div>
                <div>
                  <Label htmlFor="source_reference">来源记录编号 *</Label>
                  <Input
                    id="source_reference"
                    value={form.authorization.source_reference}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        authorization: {
                          ...current.authorization,
                          source_reference: event.target.value,
                        },
                      }))
                    }
                    placeholder="如邮件Message-ID、平台授权流水号"
                  />
                </div>
                <div>
                  <Label>证明材料类型 *</Label>
                  <Select
                    value={form.authorization.proof_type}
                    onValueChange={(proof_type) =>
                      setForm((current) => ({
                        ...current,
                        authorization: {
                          ...current.authorization,
                          proof_type,
                        },
                      }))
                    }
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="请选择材料类型" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="portal_log">自助授权日志</SelectItem>
                      <SelectItem value="email_confirmation">确认邮件</SelectItem>
                      <SelectItem value="signed_document">签署文件</SelectItem>
                      <SelectItem value="platform_record">平台授权记录</SelectItem>
                      <SelectItem value="other">其他证明材料</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="md:col-span-2">
                  <Label htmlFor="proof_reference">
                    证明材料安全存储位置或编号 *
                  </Label>
                  <Input
                    id="proof_reference"
                    value={form.authorization.proof_reference}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        authorization: {
                          ...current.authorization,
                          proof_reference: event.target.value,
                        },
                      }))
                    }
                    placeholder="如合规档案编号或受控存储对象键"
                  />
                </div>
                <div className="md:col-span-2">
                  <Label htmlFor="proof_sha256">材料SHA-256摘要（可选）</Label>
                  <Input
                    id="proof_sha256"
                    value={form.authorization.proof_sha256}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        authorization: {
                          ...current.authorization,
                          proof_sha256: event.target.value.trim(),
                        },
                      }))
                    }
                    placeholder="64位十六进制摘要，用于验证材料未被替换"
                  />
                </div>
                <div>
                  <Label htmlFor="controller_name">个人信息处理者 *</Label>
                  <Input
                    id="controller_name"
                    value={form.authorization.controller_name}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        authorization: {
                          ...current.authorization,
                          controller_name: event.target.value,
                        },
                      }))
                    }
                    placeholder="招聘主体的完整名称"
                  />
                </div>
                <div>
                  <Label htmlFor="controller_contact">权利联系渠道 *</Label>
                  <Input
                    id="controller_contact"
                    value={form.authorization.controller_contact}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        authorization: {
                          ...current.authorization,
                          controller_contact: event.target.value,
                        },
                      }))
                    }
                    placeholder="隐私邮箱、电话或申请入口"
                  />
                </div>
                <div>
                  <Label htmlFor="processing_expires_at">
                    个人信息处理截止时间 *
                  </Label>
                  <Input
                    id="processing_expires_at"
                    type="datetime-local"
                    value={form.authorization.processing_expires_at}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        authorization: {
                          ...current.authorization,
                          processing_expires_at: event.target.value,
                        },
                      }))
                    }
                  />
                </div>
                <div>
                  <Label>自动化决策偏好 *</Label>
                  <Select
                    value={form.authorization.automated_decision_preference}
                    onValueChange={(automated_decision_preference) =>
                      setForm((current) => ({
                        ...current,
                        authorization: {
                          ...current.authorization,
                          automated_decision_preference,
                        },
                      }))
                    }
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="记录候选人的明确选择" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="assistive">
                        同意自动化辅助，最终人工决定
                      </SelectItem>
                      <SelectItem value="human_review_only">
                        拒绝自动化，仅人工评估
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="md:col-span-2">
                  <Label htmlFor="external_processors">外部处理方 *</Label>
                  <Textarea
                    id="external_processors"
                    value={form.authorization.external_processors_text}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        authorization: {
                          ...current.authorization,
                          external_processors_text: event.target.value,
                        },
                      }))
                    }
                    placeholder={
                      '每行一个实际处理方，并注明角色\n例如：XX云服务（候选人数据存储）\nXX大模型服务（去标识化匹配说明）'
                    }
                    className="min-h-[88px]"
                  />
                </div>
                {form.authorization.automated_decision_preference
                  === 'assistive' && (
                  <>
                    <div>
                      <Label htmlFor="impact_assessment_reference">
                        影响评估编号 *
                      </Label>
                      <Input
                        id="impact_assessment_reference"
                        value={
                          form.authorization.impact_assessment_reference
                        }
                        onChange={(event) =>
                          setForm((current) => ({
                            ...current,
                            authorization: {
                              ...current.authorization,
                              impact_assessment_reference:
                                event.target.value,
                            },
                          }))
                        }
                        placeholder="关联已批准的个人信息保护影响评估"
                      />
                    </div>
                    <div>
                      <Label htmlFor="impact_assessment_completed_at">
                        影响评估完成时间 *
                      </Label>
                      <Input
                        id="impact_assessment_completed_at"
                        type="datetime-local"
                        value={
                          form.authorization.impact_assessment_completed_at
                        }
                        onChange={(event) =>
                          setForm((current) => ({
                            ...current,
                            authorization: {
                              ...current.authorization,
                              impact_assessment_completed_at:
                                event.target.value,
                            },
                          }))
                        }
                      />
                    </div>
                  </>
                )}
              </div>
              <div className="rounded-md border bg-card p-3 text-xs leading-5 text-slate-600">
                <p className="font-medium text-slate-800">
                  告知文本版本：{AUTHORIZATION_NOTICE_VERSION}
                </p>
                <p>
                  证据快照将固化处理者、目的、方式、信息种类、处理期限、外部处理方，以及自动化匹配的作用、可能影响和候选人的说明、拒绝、人工复核、撤回与删除权利。
                </p>
              </div>
              <div className="flex items-start gap-2">
                <input
                  type="checkbox"
                  id="authorization_confirmed"
                  checked={form.authorization.confirmed}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      authorization: {
                        ...current.authorization,
                        confirmed: event.target.checked,
                      },
                    }))
                  }
                  className="mt-1 rounded"
                />
                <Label
                  htmlFor="authorization_confirmed"
                  className="text-sm font-normal leading-5 text-slate-700"
                >
                  我确认候选人已在充分知情的前提下自愿、明确作出上述选择，且证明材料可以按登记位置核验。
                </Label>
              </div>
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>
            取消
          </Button>
          <Button
            onClick={handleSubmit}
          >
            添加
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function CandidateDetailPanel({
  candidate,
  matchRecord,
  onBack,
  incompleteHint = false,
}: {
  candidate: Candidate | null;
  matchRecord: MatchRecord | null;
  onBack?: () => void;
  incompleteHint?: boolean;
}) {
  const { reloadMatchRecords, jobs } = useWorkspaceData();
  const [requestReference, setRequestReference] = useState('');
  const [decisionExplanation, setDecisionExplanation] =
    useState<DecisionExplanation | null>(null);
  const [rightsLoading, setRightsLoading] = useState(false);
  const [resumeFile, setResumeFile] = useState<{
    url: string;
    name: string | null;
    size: number | null;
  } | null>(null);
  const [resumeFileState, setResumeFileState] = useState<
    'idle' | 'loading' | 'ready' | 'none' | 'error'
  >('idle');
  const [resumeFileHtml, setResumeFileHtml] = useState<string | null>(null);
  const [resumeFileText, setResumeFileText] = useState<string | null>(null);
  const [resumeFileReloadToken, setResumeFileReloadToken] = useState(0);
  const [resumeUploading, setResumeUploading] = useState(false);
  const resumeFileInputRef = useRef<HTMLInputElement>(null);
  const [resumeSummary, setResumeSummary] = useState<ResumeStructure | null>(null);
  const [resumeSummaryState, setResumeSummaryState] = useState<
    'idle' | 'loading' | 'ready' | 'unavailable' | 'generating'
  >('idle');
  const [canGenerateResumeSummary, setCanGenerateResumeSummary] = useState(false);
  const [resumeSummaryProgress, setResumeSummaryProgress] = useState<string[]>([]);

  // 打开详情时拉取原始简历文件签名 URL；Word 转 HTML、文本直接读取，PDF 用 iframe 原生渲染
  useEffect(() => {
    if (!candidate) {
      setResumeFileState('idle');
      return;
    }
    let active = true;
    setResumeFileState('loading');
    setResumeFile(null);
    setResumeFileHtml(null);
    setResumeFileText(null);
    void (async () => {
      try {
        const response = await authFetch(
          `/api/candidates/${candidate.id}/resume-file`,
        );
        const result = await response.json();
        if (!response.ok || !result.success) {
          throw new Error(result.error || '读取原始简历失败');
        }
        if (!active) return;
        const data = result.data as {
          url: string;
          name: string | null;
          size: number | null;
        } | null;
        if (!data) {
          setResumeFileState('none');
          return;
        }
        setResumeFile(data);
        const lowerName = (data.name ?? '').toLowerCase();
        if (lowerName.endsWith('.docx')) {
          const binaryResponse = await fetch(data.url);
          const converted = await mammoth.convertToHtml({
            arrayBuffer: await binaryResponse.arrayBuffer(),
          });
          if (active) setResumeFileHtml(converted.value);
        } else if (lowerName.endsWith('.txt') || lowerName.endsWith('.md')) {
          const textResponse = await fetch(data.url);
          if (active) setResumeFileText(await textResponse.text());
        }
        if (active) setResumeFileState('ready');
      } catch {
        if (active) setResumeFileState('error');
      }
    })();
    return () => {
      active = false;
    };
  }, [candidate, resumeFileReloadToken]);

  // 简历摘要：优先读取已落库的结构化缓存；无缓存则展示原文 + 「AI生成摘要」按钮
  useEffect(() => {
    if (!candidate?.resume_text) {
      setResumeSummary(null);
      setResumeSummaryState('idle');
      setCanGenerateResumeSummary(false);
      return;
    }
    let active = true;
    setResumeSummary(null);
    setResumeSummaryState('loading');
    setCanGenerateResumeSummary(false);
    setResumeSummaryProgress([]);
    void (async () => {
      try {
        const response = await authFetch(
          `/api/candidates/${candidate.id}/resume-summary`,
        );
        const result = await response.json();
        if (!response.ok || !result.success) {
          throw new Error(result.error || '读取简历摘要失败');
        }
        if (!active) return;
        const data = result.data as {
          structure: ResumeStructure | null;
          canGenerate: boolean;
        };
        setCanGenerateResumeSummary(data.canGenerate);
        if (data.structure) {
          setResumeSummary(data.structure);
          setResumeSummaryState('ready');
        } else {
          setResumeSummaryState('unavailable');
        }
      } catch {
        if (active) setResumeSummaryState('unavailable');
      }
    })();
    return () => {
      active = false;
    };
  }, [candidate?.id, candidate?.resume_text]);

  // 手动触发 AI 生成结构化摘要：NDJSON 流式回传处理过程，done 后已落库并渲染卡片
  async function handleGenerateResumeSummary() {
    if (!candidate) return;
    setResumeSummaryState('generating');
    setResumeSummaryProgress([]);
    try {
      const response = await authFetch(
        `/api/candidates/${candidate.id}/resume-summary`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        },
      );
      if (!response.ok) {
        const result: { error?: string } = await response.json().catch(() => null);
        throw new Error(result?.error || '生成结构化摘要失败');
      }
      const reader = response.body?.getReader();
      if (!reader) throw new Error('生成结构化摘要失败');
      const decoder = new TextDecoder();
      let buffer = '';
      const outcome: { data?: ResumeStructure; error?: string } = {};
      const handleLine = (line: string) => {
        if (!line.trim()) return;
        const event: {
          type?: string;
          message?: string;
          data?: ResumeStructure;
          error?: string;
        } = JSON.parse(line);
        const message = event.message;
        if (event.type === 'progress' && message) {
          setResumeSummaryProgress((previous) => [...previous, message]);
        } else if (event.type === 'done' && event.data) {
          outcome.data = event.data;
        } else if (event.type === 'error') {
          outcome.error = event.error || '生成结构化摘要失败';
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
      if (!outcome.data) throw new Error('生成结构化摘要失败');
      setResumeSummary(outcome.data);
      setResumeSummaryProgress([]);
      setResumeSummaryState('ready');
    } catch (error) {
      setResumeSummaryState(resumeSummary ? 'ready' : 'unavailable');
      toast.error(error instanceof Error ? error.message : '生成结构化摘要失败');
    }
  }

  // 存量候选人补传原始简历文件：选中即上传，成功后原地刷新出原件预览
  async function handleResumeFileUpload(
    event: ChangeEvent<HTMLInputElement>,
  ): Promise<void> {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file || !candidate) return;
    setResumeUploading(true);
    try {
      await uploadCandidateResumeFile(candidate.id, file);
      toast.success('原始简历已保存');
      setResumeFileReloadToken((token) => token + 1);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : '原始简历文件保存失败',
      );
    } finally {
      setResumeUploading(false);
    }
  }

  async function handleDecisionRight(
    action: 'request_explanation' | 'object_to_automated_decision',
  ) {
    if (!candidate) return;
    if (!requestReference.trim()) {
      toast.error('请填写候选人权利申请的记录编号');
      return;
    }
    if (action === 'request_explanation' && !matchRecord) {
      toast.error('当前没有可说明的自动化匹配记录');
      return;
    }

    setRightsLoading(true);
    try {
      const response = await authFetch(
        `/api/candidates/${candidate.id}/decision-rights`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action,
            request_reference: requestReference.trim(),
            ...(action === 'request_explanation'
              ? { job_id: matchRecord?.job_id }
              : {}),
          }),
        },
      );
      const result = await response.json();
      if (!result.success) {
        toast.error(result.error || '权利请求处理失败');
        return;
      }
      if (action === 'request_explanation') {
        setDecisionExplanation(result.data as DecisionExplanation);
        toast.success('已生成可提供给候选人的自动化匹配说明');
      } else {
        setDecisionExplanation(null);
        await reloadMatchRecords();
        toast.success('已记录拒绝，后续仅允许人工评估');
      }
    } catch {
      toast.error('权利请求处理失败');
    } finally {
      setRightsLoading(false);
    }
  }

  const sourceJob = candidate?.source_job_id
    ? jobs.find((job) => job.id === candidate.source_job_id)
    : undefined;

  return (
    <div className="rounded-xl border bg-card">
      <div className="flex items-center justify-between gap-3 border-b px-6 py-4">
        <div className="flex items-baseline gap-2">
          <h2 className="text-lg font-semibold">候选人详情</h2>
          {candidate && (
            <span className="text-sm text-muted-foreground">{candidate.name}</span>
          )}
        </div>
        {onBack && (
          <Button variant="ghost" size="sm" onClick={onBack}>
            <ArrowLeft className="h-4 w-4 mr-1.5" />
            返回列表
          </Button>
        )}
      </div>
      <div className="p-6">
        {incompleteHint && (
          <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-900">
            部分资料需到候选人库查看
          </div>
        )}
        {candidate && (
          <div className="space-y-4">
            <div className="flex items-center gap-4">
              <div className="w-16 h-16 bg-gradient-to-br from-blue-400 to-blue-600 rounded-full flex items-center justify-center text-white text-2xl font-bold">
                {candidate.name[0]}
              </div>
              <div>
                <h3 className="text-xl font-bold">{candidate.name}</h3>
                <p className="text-muted-foreground">{candidate.current_position}</p>
              </div>
            </div>
            <div className="rounded-md border border-blue-100 bg-blue-50/50 px-3 py-2 text-xs space-y-1 text-slate-700">
              <p>
                绑定职位：{sourceJob?.title ?? '未绑定'}
                {candidate.source_job_binding_status === 'active' && (
                  <span className="ml-1 text-blue-600">（有效）</span>
                )}
                {candidate.source_job_binding_status === 'expired' && (
                  <span className="ml-1 text-amber-600">（已过期）</span>
                )}
              </p>
              {candidate.created_by_name && (
                <p>录入人：{candidate.created_by_name}</p>
              )}
            </div>
            <Separator />
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div className="flex items-center gap-2">
                <Mail className="h-4 w-4 text-muted-foreground" />
                <span>{candidate.email || '未填写'}</span>
              </div>
              <div className="flex items-center gap-2">
                <Phone className="h-4 w-4 text-muted-foreground" />
                <span>{candidate.phone || '未填写'}</span>
              </div>
              <div className="flex items-center gap-2">
                <Building2 className="h-4 w-4 text-muted-foreground" />
                <span>{candidate.current_company || '未知'}</span>
              </div>
              <div className="flex items-center gap-2">
                <Briefcase className="h-4 w-4 text-muted-foreground" />
                <span>{candidate.experience_years}年经验</span>
              </div>
              <div className="flex items-center gap-2">
                <GraduationCap className="h-4 w-4 text-muted-foreground" />
                <span>{candidate.education || '未知'}</span>
              </div>
            </div>
            {candidate.skills && candidate.skills.length > 0 && (
              <div>
                <p className="text-sm text-muted-foreground mb-2">技能标签</p>
                <div className="flex flex-wrap gap-2">
                  {candidate.skills.map((skill) => (
                    <Badge key={skill} variant="secondary">
                      {skill}
                    </Badge>
                  ))}
                </div>
              </div>
            )}
            {resumeFileState === 'ready' && resumeFile && (
              <div>
                <div className="mb-2 flex items-center justify-between gap-2">
                  <p className="text-sm text-muted-foreground">原始简历</p>
                  {resumeFile.name && (
                    <span className="truncate text-xs text-muted-foreground">
                      {resumeFile.name}
                    </span>
                  )}
                </div>
                {resumeFileHtml ? (
                  <iframe
                    title="原始简历"
                    sandbox=""
                    srcDoc={resumeFileHtml}
                    className="h-96 w-full rounded-lg border bg-card"
                  />
                ) : resumeFileText !== null ? (
                  <pre className="max-h-96 overflow-y-auto whitespace-pre-wrap rounded-lg bg-muted/50 p-3 text-sm">
                    {resumeFileText}
                  </pre>
                ) : (
                  <iframe
                    title="原始简历"
                    src={resumeFile.url}
                    className="h-[32rem] w-full rounded-lg border"
                  />
                )}
              </div>
            )}
            {resumeFileState === 'loading' && (
              <p className="text-sm text-muted-foreground">正在加载原始简历…</p>
            )}
            {resumeFileState === 'none' && (
              <div>
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm text-muted-foreground">原始简历</p>
                  <input
                    ref={resumeFileInputRef}
                    type="file"
                    accept=".pdf,.docx,.txt,.md"
                    className="hidden"
                    onChange={handleResumeFileUpload}
                  />
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={resumeUploading}
                    onClick={() => resumeFileInputRef.current?.click()}
                  >
                    {resumeUploading ? (
                      <LoaderCircle className="h-4 w-4 animate-spin" />
                    ) : (
                      <Upload className="h-4 w-4" />
                    )}
                    {resumeUploading ? '正在上传…' : '上传原文件'}
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  支持 PDF / Word / 文本，上传后可直接预览原件
                </p>
              </div>
            )}
            {resumeFileState === 'error' && (
              <p className="text-sm text-red-500">
                原始简历加载失败，仅展示下方简历摘要
              </p>
            )}
            {candidate.resume_text && (
              <details open={!resumeFile}>
                <summary className="cursor-pointer select-none text-sm text-muted-foreground">
                  简历摘要
                </summary>
                {resumeSummaryState === 'loading' && (
                  <div className="mt-3 flex items-center gap-2 text-sm text-muted-foreground">
                    <LoaderCircle className="h-4 w-4 animate-spin" />
                    正在读取简历摘要…
                  </div>
                )}
                {resumeSummaryState === 'generating' && (
                  <div className="mt-3 rounded-lg border border-blue-100 bg-blue-50/40 p-3">
                    <div className="flex items-center gap-2 text-sm text-blue-700">
                      <LoaderCircle className="h-4 w-4 animate-spin" />
                      正在生成结构化摘要…
                    </div>
                    <ul className="mt-2 space-y-1">
                      {resumeSummaryProgress.map((message, index) => (
                        <li key={index} className="text-xs text-muted-foreground">
                          {message}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {resumeSummaryState === 'ready' && resumeSummary && (
                  <div className="mt-3 space-y-3">
                    <div className="rounded-lg border border-blue-100 bg-blue-50/50 p-3">
                      <div className="mb-1 flex items-center justify-between gap-2">
                        <p className="text-xs font-medium text-blue-700">候选人定位</p>
                        {canGenerateResumeSummary && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-6 px-2 text-xs"
                            onClick={() => void handleGenerateResumeSummary()}
                          >
                            AI生成摘要
                          </Button>
                        )}
                      </div>
                      <p className="text-sm leading-6">{resumeSummary.summary}</p>
                    </div>
                    {resumeSummary.skills.length > 0 && (
                      <div className="rounded-lg border bg-card p-3">
                        <p className="mb-2 text-xs font-medium text-muted-foreground">技能</p>
                        <div className="flex flex-wrap gap-2">
                          {resumeSummary.skills.map((skill) => (
                            <Badge key={skill} variant="secondary">
                              {skill}
                            </Badge>
                          ))}
                        </div>
                      </div>
                    )}
                    {resumeSummary.experience.length > 0 && (
                      <div className="rounded-lg border bg-card p-3">
                        <p className="mb-2 text-xs font-medium text-muted-foreground">
                          工作 / 项目经历
                        </p>
                        <div className="space-y-2">
                          {resumeSummary.experience.map((item, index) => (
                            <div
                              key={`${item.title}-${index}`}
                              className="rounded-md bg-muted/50 p-2.5"
                            >
                              <p className="text-sm font-medium">{item.title}</p>
                              <p className="mt-1 whitespace-pre-wrap text-sm leading-6 text-muted-foreground">
                                {item.detail}
                              </p>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                    {resumeSummary.highlights.length > 0 && (
                      <div className="rounded-lg border bg-card p-3">
                        <p className="mb-2 text-xs font-medium text-muted-foreground">亮点</p>
                        <ul className="space-y-1.5">
                          {resumeSummary.highlights.map((highlight, index) => (
                            <li key={index} className="flex gap-2 text-sm leading-6">
                              <span className="text-blue-500">•</span>
                              <span>{highlight}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                    <details className="text-xs">
                      <summary className="cursor-pointer text-muted-foreground">
                        查看原文
                      </summary>
                      <p className="mt-2 whitespace-pre-wrap rounded-lg bg-muted/50 p-3 text-sm leading-6">
                        {candidate.resume_text}
                      </p>
                    </details>
                  </div>
                )}
                {(resumeSummaryState === 'unavailable' ||
                  resumeSummaryState === 'idle') && (
                  <div className="mt-2 space-y-2">
                    {candidate.resume_text
                      .split(/\n{2,}/)
                      .map((paragraph, index) => (
                        <p
                          key={index}
                          className="whitespace-pre-wrap rounded-lg bg-muted/50 p-3 text-sm leading-6"
                        >
                          {paragraph.trim()}
                        </p>
                      ))}
                    {canGenerateResumeSummary && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => void handleGenerateResumeSummary()}
                      >
                        AI生成摘要
                      </Button>
                    )}
                  </div>
                )}
              </details>
            )}
            {candidate.authorization && (
              <>
                <Separator />
                <Collapsible className="rounded-lg border border-blue-200 bg-blue-50/40">
                  <CollapsibleTrigger className="group flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2.5 text-left">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span className="text-sm font-medium text-slate-900">
                        授权与合规
                      </span>
                      <Badge
                        variant={
                          candidate.authorization.evidence_status === 'verified'
                            ? 'secondary'
                            : 'destructive'
                        }
                      >
                        {candidate.authorization.evidence_status === 'verified'
                          ? '已核验'
                          : '历史未核验'}
                      </Badge>
                      <span className="text-xs text-slate-600">
                        {candidate.authorization.automated_decision_objected_at
                          ? '候选人已拒绝自动化'
                          : candidate.authorization
                              .automated_decision_preference === 'assistive'
                            ? '自动化辅助 · 人工决定'
                            : '仅人工评估'}
                      </span>
                      {candidate.authorization.processing_expires_at && (
                        <span className="text-xs text-slate-400">
                          有效期至
                          {new Date(
                            candidate.authorization.processing_expires_at,
                          ).toLocaleDateString('zh-CN')}
                        </span>
                      )}
                    </div>
                    <ChevronDown className="h-4 w-4 shrink-0 text-slate-400 transition-transform group-data-[state=open]:rotate-180" />
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    <div className="space-y-1.5 border-t border-blue-200/70 px-3 py-3 text-xs leading-5 text-slate-600">
                      <p>
                        来源：
                        {candidate.authorization.source_type
                          ? AUTHORIZATION_SOURCE_LABELS[
                              candidate.authorization.source_type
                            ] ?? candidate.authorization.source_type
                          : '未记录'}
                        {candidate.authorization.source_reference && (
                          <>
                            {' · '}
                            <CopyableReference
                              value={candidate.authorization.source_reference}
                            />
                          </>
                        )}
                      </p>
                      <p>
                        证明材料：
                        {candidate.authorization.proof_type || '未记录'}
                        {candidate.authorization.proof_reference && (
                          <>
                            {' · '}
                            <CopyableReference
                              value={candidate.authorization.proof_reference}
                            />
                          </>
                        )}
                      </p>
                      <p>
                        告知版本：
                        {candidate.authorization.notice_version || '未记录'}
                      </p>
                      <p>
                        处理期限：
                        {candidate.authorization.processing_expires_at
                          ? new Date(
                              candidate.authorization.processing_expires_at,
                            ).toLocaleDateString('zh-CN')
                          : '未记录'}
                      </p>
                      <p>
                        外部处理方：
                        {candidate.authorization.external_processors?.join('；')
                          || '未记录'}
                      </p>
                      <p>
                        自动化决策：
                        {candidate.authorization.automated_decision_objected_at
                          ? '候选人已拒绝，仅允许人工评估'
                          : candidate.authorization
                              .automated_decision_preference === 'assistive'
                            ? '自动化辅助，最终人工决定'
                            : '仅人工评估'}
                      </p>
                      {candidate.authorization.impact_assessment_reference && (
                        <p className="flex flex-wrap items-center">
                          影响评估：
                          <CopyableReference
                            value={
                              candidate.authorization
                                .impact_assessment_reference
                            }
                          />
                        </p>
                      )}
                      {candidate.authorization.evidence_sha256 && (
                        <p className="flex flex-wrap items-center">
                          证据摘要：
                          <CopyableReference
                            value={candidate.authorization.evidence_sha256}
                          />
                        </p>
                      )}
                    </div>
                    <div className="space-y-3 border-t border-blue-200/70 px-3 py-3">
              <div>
                <p className="font-medium text-slate-900">自动化决策权利</p>
                <p className="mt-1 text-xs leading-5 text-slate-500">
                  候选人来函要求说明或拒绝自动化评估时在此登记，操作会记入审计日志。
                </p>
              </div>
              <div>
                <Label htmlFor="decision_request_reference">
                  权利申请记录编号
                </Label>
                <Input
                  id="decision_request_reference"
                  value={requestReference}
                  onChange={(event) =>
                    setRequestReference(event.target.value)
                  }
                  placeholder="如工单号、邮件Message-ID"
                />
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="outline"
                  disabled={rightsLoading || !matchRecord}
                  onClick={() => handleDecisionRight('request_explanation')}
                >
                  提供匹配说明
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  disabled={rightsLoading}
                  onClick={() =>
                    handleDecisionRight('object_to_automated_decision')
                  }
                >
                  记录拒绝自动化
                </Button>
              </div>
              {decisionExplanation && (
                <div className="space-y-2 rounded-lg border bg-slate-50 p-3 text-sm">
                  <p>{decisionExplanation.decision_role}</p>
                  <p>
                    综合匹配分：
                    <span className="font-semibold">
                      {decisionExplanation.scores.overall ?? '未生成'}
                    </span>
                  </p>
                  {decisionExplanation.explanation?.strengths?.length ? (
                    <p>
                      主要匹配依据：
                      {decisionExplanation.explanation.strengths.join('；')}
                    </p>
                  ) : null}
                  {decisionExplanation.explanation?.gaps?.length ? (
                    <p>
                      待人工核验：
                      {decisionExplanation.explanation.gaps.join('；')}
                    </p>
                  ) : null}
                  {decisionExplanation.explanation?.recommendations && (
                    <p>
                      建议：
                      {decisionExplanation.explanation.recommendations}
                    </p>
                  )}
                </div>
              )}
                    </div>
                  </CollapsibleContent>
                </Collapsible>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export function RevokeCandidateDialog({
  candidate,
  open,
  onOpenChange,
}: {
  candidate: Candidate | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { reloadCandidates } = useWorkspaceData();

  async function handleRevoke() {
    if (!candidate) return;
    try {
      const response = await authFetch(
        `/api/candidates/${candidate.id}/revoke`,
        { method: 'DELETE' },
      );
      const result = await response.json();
      if (result.success) {
        toast.success('授权已撤回，候选人个人信息已删除');
        await reloadCandidates();
      } else {
        toast.error(result.error || '撤回失败');
      }
    } catch {
      toast.error('撤回操作失败');
    } finally {
      onOpenChange(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-amber-500" />
            确认撤回授权
          </DialogTitle>
          <DialogDescription>
            确定要撤回{candidate?.name}的简历授权吗？撤回后，{candidate?.name}
            的姓名、联系方式、简历等个人信息会被删除且无法恢复，只保留看不出身份的招聘统计数字。
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button variant="destructive" onClick={handleRevoke}>
            确认撤回
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
