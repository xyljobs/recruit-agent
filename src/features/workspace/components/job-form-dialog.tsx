'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { authFetch } from '@/lib/auth-client';
import type { Job } from '../types';

interface JobFormValues {
  title: string;
  department: string;
  location: string;
  salary_range: string;
  experience_required: string;
  education_required: string;
  skills: string;
  bonus_skills: string;
  responsibilities: string;
  benefits: string;
  raw_jd: string;
  bandMin: string;
  bandPreferredMax: string;
  bandHardMax: string;
  hardMaxEnabled: boolean;
}

const EMPTY_VALUES: JobFormValues = {
  title: '',
  department: '',
  location: '',
  salary_range: '',
  experience_required: '',
  education_required: '',
  skills: '',
  bonus_skills: '',
  responsibilities: '',
  benefits: '',
  raw_jd: '',
  bandMin: '',
  bandPreferredMax: '',
  bandHardMax: '',
  hardMaxEnabled: false,
};

function toValues(job: Job | null): JobFormValues {
  if (!job) return EMPTY_VALUES;
  const band = job.screening_rubric?.experience_band ?? null;
  return {
    title: job.title ?? '',
    department: job.department ?? '',
    location: job.location ?? '',
    salary_range: job.salary_range ?? '',
    experience_required: job.experience_required ?? '',
    education_required: job.education_required ?? '',
    skills: (job.skills_required ?? []).join('，'),
    bonus_skills: (job.bonus_skills ?? []).join('，'),
    responsibilities: (job.responsibilities ?? []).join('\n'),
    benefits: (job.benefits ?? []).join('，'),
    raw_jd: job.raw_jd ?? '',
    bandMin: band?.min != null ? String(band.min) : '',
    bandPreferredMax: band?.preferred_max != null ? String(band.preferred_max) : '',
    bandHardMax: band?.hard_max != null ? String(band.hard_max) : '',
    hardMaxEnabled: band?.hard_max_enabled ?? false,
  };
}

function splitList(value: string): string[] {
  return value.split(/[，,]/).map(item => item.trim()).filter(Boolean);
}

function splitLines(value: string): string[] {
  return value.split('\n').map(item => item.trim()).filter(Boolean);
}

function toFiniteYears(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Number.parseFloat(trimmed);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

interface JobFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** null = 新增职位；否则编辑该职位 */
  job: Job | null;
  onSaved: () => Promise<void>;
}

export function JobFormDialog({ open, onOpenChange, job, onSaved }: JobFormDialogProps) {
  const [values, setValues] = useState<JobFormValues>(EMPTY_VALUES);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) setValues(toValues(job));
  }, [open, job]);

  function setField(field: keyof JobFormValues, value: string) {
    setValues(prev => ({ ...prev, [field]: value }));
  }

  async function handleSubmit() {
    if (!values.title.trim()) {
      toast.error('请填写职位名称');
      return;
    }
    setSaving(true);
    try {
      const bandMin = toFiniteYears(values.bandMin);
      const bandPreferredMax = toFiniteYears(values.bandPreferredMax);
      const bandHardMax = toFiniteYears(values.bandHardMax);
      const hasBand = bandMin !== null || bandPreferredMax !== null || bandHardMax !== null;
      const screening_rubric = hasBand
        ? {
          ...(job?.screening_rubric ?? {}),
          experience_band: {
            min: bandMin,
            preferred_max: bandPreferredMax,
            hard_max: bandHardMax,
            source: (job?.screening_rubric?.experience_band?.source ?? 'explicit') as 'explicit' | 'inferred',
            hard_max_enabled: values.hardMaxEnabled,
          },
        }
        : (job?.screening_rubric ?? {});
      const fields = {
        title: values.title.trim(),
        ...(values.department.trim() ? { department: values.department.trim() } : {}),
        ...(values.location.trim() ? { location: values.location.trim() } : {}),
        ...(values.salary_range.trim() ? { salary_range: values.salary_range.trim() } : {}),
        ...(values.experience_required.trim() ? { experience_required: values.experience_required.trim() } : {}),
        ...(values.education_required.trim() ? { education_required: values.education_required.trim() } : {}),
        skills_required: splitList(values.skills),
        bonus_skills: splitList(values.bonus_skills),
        responsibilities: splitLines(values.responsibilities),
        benefits: splitList(values.benefits),
        ...(values.raw_jd.trim() ? { raw_jd: values.raw_jd.trim() } : {}),
        screening_rubric,
      };
      const response = job
        ? await authFetch(`/api/jobs/${job.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(fields),
        })
        : await authFetch('/api/jobs', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'create', ...fields }),
        });
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.error || '保存失败');
      toast.success(job ? '职位已更新' : '职位已创建为草稿，可在职位库中启用');
      onOpenChange(false);
      await onSaved();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '保存职位失败');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{job ? `编辑职位：${job.title}` : '新增职位'}</DialogTitle>
          <DialogDescription>
            带 * 为必填项；技能/福利用逗号分隔，岗位职责每行一条。
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="job-form-title">职位名称 *</Label>
            <Input id="job-form-title" value={values.title} onChange={(event) => setField('title', event.target.value)} maxLength={200} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="job-form-department">部门</Label>
            <Input id="job-form-department" value={values.department} onChange={(event) => setField('department', event.target.value)} maxLength={100} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="job-form-location">工作地点</Label>
            <Input id="job-form-location" value={values.location} onChange={(event) => setField('location', event.target.value)} maxLength={100} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="job-form-salary">薪资范围</Label>
            <Input id="job-form-salary" value={values.salary_range} onChange={(event) => setField('salary_range', event.target.value)} maxLength={100} placeholder="如 25-40K" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="job-form-experience">经验要求</Label>
            <Input id="job-form-experience" value={values.experience_required} onChange={(event) => setField('experience_required', event.target.value)} maxLength={1000} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="job-form-education">学历要求</Label>
            <Input id="job-form-education" value={values.education_required} onChange={(event) => setField('education_required', event.target.value)} maxLength={100} />
          </div>
          <div className="space-y-2 md:col-span-2">
            <div className="grid gap-3 rounded-lg border border-slate-200 bg-slate-50 p-3 sm:grid-cols-3">
              <div className="space-y-2">
                <Label htmlFor="job-form-band-min">最低年限（年）</Label>
                <Input
                  id="job-form-band-min"
                  type="number"
                  min={0}
                  max={100}
                  step={1}
                  value={values.bandMin}
                  onChange={(event) => setField('bandMin', event.target.value)}
                  placeholder="如 3"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="job-form-band-preferred">优先上限（年）</Label>
                <Input
                  id="job-form-band-preferred"
                  type="number"
                  min={0}
                  max={100}
                  step={1}
                  value={values.bandPreferredMax}
                  onChange={(event) => setField('bandPreferredMax', event.target.value)}
                  placeholder="如 5"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="job-form-band-hard">硬上限（年）</Label>
                <Input
                  id="job-form-band-hard"
                  type="number"
                  min={0}
                  max={100}
                  step={1}
                  value={values.bandHardMax}
                  onChange={(event) => setField('bandHardMax', event.target.value)}
                  placeholder="如 6"
                />
              </div>
              <div className="flex items-start gap-2 sm:col-span-3">
                <Checkbox
                  id="job-form-hard-max-enabled"
                  checked={values.hardMaxEnabled}
                  onCheckedChange={(checked) => setValues(prev => ({ ...prev, hardMaxEnabled: checked === true }))}
                  className="mt-0.5"
                />
                <div className="space-y-0.5">
                  <Label htmlFor="job-form-hard-max-enabled" className="font-normal leading-5">
                    将硬上限作为硬门槛（超出者标记为不建议推进）
                  </Label>
                  {job?.screening_rubric?.experience_band?.source === 'inferred' && (
                    <p className="text-xs leading-5 text-amber-700">
                      该上限由 AI 从 JD 推断，勾选后才会作为硬门槛生效
                    </p>
                  )}
                </div>
              </div>
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="job-form-skills">必备技能（逗号分隔）</Label>
            <Input id="job-form-skills" value={values.skills} onChange={(event) => setField('skills', event.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="job-form-bonus-skills">加分技能（逗号分隔）</Label>
            <Input id="job-form-bonus-skills" value={values.bonus_skills} onChange={(event) => setField('bonus_skills', event.target.value)} />
          </div>
          <div className="space-y-2 md:col-span-2">
            <Label htmlFor="job-form-responsibilities">岗位职责（每行一条）</Label>
            <Textarea id="job-form-responsibilities" className="min-h-[96px]" value={values.responsibilities} onChange={(event) => setField('responsibilities', event.target.value)} />
          </div>
          <div className="space-y-2 md:col-span-2">
            <Label htmlFor="job-form-benefits">福利待遇（逗号分隔）</Label>
            <Input id="job-form-benefits" value={values.benefits} onChange={(event) => setField('benefits', event.target.value)} />
          </div>
          <div className="space-y-2 md:col-span-2">
            <Label htmlFor="job-form-raw-jd">职位描述原文（可选，用于回填与AI解析）</Label>
            <Textarea id="job-form-raw-jd" className="min-h-[140px]" value={values.raw_jd} onChange={(event) => setField('raw_jd', event.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={saving}>取消</Button>
          <Button onClick={() => void handleSubmit()} disabled={saving || !values.title.trim()}>
            {saving ? '保存中…' : job ? '保存修改' : '创建职位'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
