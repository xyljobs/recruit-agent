'use client';

import { useEffect, useState } from 'react';
import { RotateCcw } from 'lucide-react';
import { toast } from 'sonner';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { authFetch } from '@/lib/auth-client';

/**
 * 演示数据重置控制：GET /api/demo/reset 探测当前组织是否为演示组织，
 * 仅在演示组织的管理员可见（其他环境静默隐藏），POST 执行一键重置并刷新页面。
 */
export function useDemoReset() {
  const [available, setAvailable] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [resetting, setResetting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function loadDemoResetStatus() {
      try {
        const response = await authFetch('/api/demo/reset');
        const result: { success?: boolean; data?: { available?: boolean }; error?: string } = await response.json();
        if (!cancelled && response.ok && result.success) {
          setAvailable(Boolean(result.data?.available));
        }
      } catch {
        // 非演示环境或无权限时静默隐藏入口
      }
    }
    void loadDemoResetStatus();
    return () => {
      cancelled = true;
    };
  }, []);

  async function performReset() {
    setResetting(true);
    try {
      const response = await authFetch('/api/demo/reset', { method: 'POST' });
      const result: { success?: boolean; error?: string } = await response.json();
      if (!response.ok || !result.success) throw new Error(result.error || '重置失败');
      setDialogOpen(false);
      toast.success('演示数据已重置，正在刷新页面');
      setTimeout(() => window.location.reload(), 800);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '重置失败');
    } finally {
      setResetting(false);
    }
  }

  return { available, dialogOpen, setDialogOpen, resetting, performReset };
}

function DemoResetDialog({
  open,
  onOpenChange,
  resetting,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  resetting: boolean;
  onConfirm: () => void;
}) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>重置演示数据？</AlertDialogTitle>
          <AlertDialogDescription>
            将清空主演示组织与第二演示组织的候选人、职位、匹配、短名单、复盘等全部业务数据，并自动恢复种子基线（候选人 7 位 + 职位 3 个）。此操作不可撤销。
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={resetting}>取消</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            disabled={resetting}
            onClick={(event) => { event.preventDefault(); onConfirm(); }}
          >
            {resetting ? '重置中…' : '确认重置'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/** 小按钮入口（登录后首页职位库头部等场景） */
export function DemoResetButton() {
  const { available, dialogOpen, setDialogOpen, resetting, performReset } = useDemoReset();
  if (!available) return null;
  return (
    <>
      <Button
        size="sm"
        variant="outline"
        className="shrink-0 border-red-200 text-red-600 hover:bg-red-50 hover:text-red-700"
        disabled={resetting}
        onClick={() => setDialogOpen(true)}
      >
        <RotateCcw className="h-4 w-4" />
        {resetting ? '重置中…' : '重置演示数据'}
      </Button>
      <DemoResetDialog open={dialogOpen} onOpenChange={setDialogOpen} resetting={resetting} onConfirm={() => void performReset()} />
    </>
  );
}

/** 卡片入口（数据源页「演示环境管理」卡片） */
export function DemoResetCard() {
  const { available, dialogOpen, setDialogOpen, resetting, performReset } = useDemoReset();
  if (!available) return null;
  return (
    <Card className="border-slate-200 shadow-none">
      <CardHeader><CardTitle>演示环境管理</CardTitle><CardDescription>清空两个演示组织的全部业务数据并恢复种子基线（候选人 7 位 + 职位 3 个），保留组织、账号、登录会话与 AI 审批。</CardDescription></CardHeader>
      <CardContent>
        <AlertDialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <AlertDialogTrigger asChild>
            <Button variant="destructive" disabled={resetting}>
              <RotateCcw className="mr-2 h-4 w-4" />{resetting ? '重置中…' : '一键重置演示数据'}
            </Button>
          </AlertDialogTrigger>
          <DemoResetDialog open={dialogOpen} onOpenChange={setDialogOpen} resetting={resetting} onConfirm={() => void performReset()} />
        </AlertDialog>
      </CardContent>
    </Card>
  );
}
