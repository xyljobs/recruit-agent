'use client';

import { useEffect, useState } from 'react';
import { Copy, MessageSquare, RefreshCw, Sparkles } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { authFetch } from '@/lib/auth-client';
import { useWorkspaceData } from '../hooks/use-workspace-data';
import type { MatchRecord } from '../types';

export function MatchScriptDialog({
  match,
  open,
  onOpenChange,
}: {
  match: MatchRecord | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { reloadMatchRecords } = useWorkspaceData();
  const [generatedScript, setGeneratedScript] = useState('');
  const [scriptLoading, setScriptLoading] = useState(false);
  const [communicationGoal, setCommunicationGoal] = useState(
    '邀请候选人了解职位机会',
  );

  useEffect(() => {
    if (!open) setGeneratedScript('');
  }, [open]);

  async function handleGenerateScript() {
    if (!match) return;
    setScriptLoading(true);
    try {
      const response = await authFetch('/api/script/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          matchId: match.id,
          communicationGoal,
        }),
      });
      const result = await response.json();
      if (result.success) {
        setGeneratedScript(result.data.script);
        await reloadMatchRecords();
        toast.success('话术生成成功！');
      } else {
        toast.error(result.error || '生成失败');
      }
    } catch (error) {
      console.error('生成话术失败:', error);
      toast.error('生成失败，请重试');
    } finally {
      setScriptLoading(false);
    }
  }

  async function handleCopyScript() {
    await navigator.clipboard.writeText(generatedScript);
    toast.success('话术已复制到剪贴板');
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <MessageSquare className="h-5 w-5 text-blue-600" />
            生成沟通话术
          </DialogTitle>
          <DialogDescription>
            为 {match?.candidate?.name} - {match?.job?.title} 生成个性化话术
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-4">
          <div>
            <Label>沟通目的</Label>
            <Select
              value={communicationGoal}
              onValueChange={setCommunicationGoal}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="邀请候选人了解职位机会">
                  邀请候选人了解职位机会
                </SelectItem>
                <SelectItem value="邀请候选人面试">邀请候选人面试</SelectItem>
                <SelectItem value="发送Offer邀请">发送Offer邀请</SelectItem>
                <SelectItem value="跟进面试结果">跟进面试结果</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {generatedScript ? (
            <div className="space-y-3">
              <div className="p-4 bg-blue-50 rounded-lg border border-blue-200">
                <p className="text-sm whitespace-pre-wrap">{generatedScript}</p>
              </div>
              <Button
                variant="outline"
                className="w-full"
                onClick={handleCopyScript}
              >
                <Copy className="h-4 w-4 mr-2" />
                复制话术
              </Button>
            </div>
          ) : (
            <Button
              className="w-full bg-gradient-to-r from-blue-600 to-purple-600"
              onClick={handleGenerateScript}
              disabled={scriptLoading}
            >
              {scriptLoading ? (
                <>
                  <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                  AI生成中...
                </>
              ) : (
                <>
                  <Sparkles className="h-4 w-4 mr-2" />
                  生成话术
                </>
              )}
            </Button>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            关闭
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
