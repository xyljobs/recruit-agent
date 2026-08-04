import type { ReactNode } from 'react';
import {
  CheckCircle2,
  Clock,
  Phone,
  Send,
  Users,
  XCircle,
} from 'lucide-react';

export const STATUS_CONFIG: Record<
  string,
  { label: string; color: string; bgColor: string; icon: ReactNode }
> = {
  pending: {
    label: '待接触',
    color: 'text-gray-700',
    bgColor: 'bg-gray-100',
    icon: <Clock className="h-4 w-4" />,
  },
  contacted: {
    label: '已联系',
    color: 'text-blue-700',
    bgColor: 'bg-blue-100',
    icon: <Phone className="h-4 w-4" />,
  },
  interviewing: {
    label: '面试中',
    color: 'text-amber-700',
    bgColor: 'bg-amber-100',
    icon: <Users className="h-4 w-4" />,
  },
  offered: {
    label: '已发Offer',
    color: 'text-purple-700',
    bgColor: 'bg-purple-100',
    icon: <Send className="h-4 w-4" />,
  },
  hired: {
    label: '已录用',
    color: 'text-emerald-700',
    bgColor: 'bg-emerald-100',
    icon: <CheckCircle2 className="h-4 w-4" />,
  },
  rejected: {
    label: '已拒绝',
    color: 'text-red-700',
    bgColor: 'bg-red-100',
    icon: <XCircle className="h-4 w-4" />,
  },
  withdrawn: {
    label: '已撤回',
    color: 'text-slate-700',
    bgColor: 'bg-slate-100',
    icon: <XCircle className="h-4 w-4" />,
  },
};

export function getScoreColor(score: number) {
  if (score >= 90) return 'text-emerald-600';
  if (score >= 70) return 'text-blue-600';
  if (score >= 50) return 'text-amber-600';
  return 'text-red-600';
}

export function getScoreBg(score: number) {
  if (score >= 90) return 'bg-emerald-50 border-emerald-200';
  if (score >= 70) return 'bg-blue-50 border-blue-200';
  if (score >= 50) return 'bg-amber-50 border-amber-200';
  return 'bg-red-50 border-red-200';
}

export function getScoreLabel(score: number) {
  if (score >= 90) return '优秀';
  if (score >= 70) return '良好';
  if (score >= 50) return '一般';
  return '不匹配';
}
