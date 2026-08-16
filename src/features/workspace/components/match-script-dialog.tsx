'use client';

import { useEffect, useState } from 'react';
import { Check, Copy, MessageSquare, RefreshCw, Sparkles } from 'lucide-react';
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
  const [scriptSteps, setScriptSteps] = useState<string[]>([]);
  const [communicationGoal, setCommunicationGoal] = useState(
    '邀请候选人了解职位机会',
  );

  useEffect(() => {
    if (!open) setGeneratedScript('');
  }, [open]);

  async function handleGenerateScript() {
    if (!match) return;
    setScriptLoading(true);
    setScriptSteps(['正在准备候选人信息与匹配证据…']);
    try {
      const response = await authFetch('/api/script/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          matchId: match.id,
          communicationGoal,
        }),
      });
      const contentType = response.headers.get('content-type') ?? '';
      if (!response.ok) {
        const result: { error?: string } | null = await response.json().catch(() => null);
        throw new Error(result?.error || '生成失败');
      }
      // JSON 响应：rules_only 模式本地规则即时返回
      if (contentType.includes('application/json')) {
        const result = await response.json();
        if (result.success) {
          setGeneratedScript(result.data.script);
          await reloadMatchRecords();
          toast.success('话术生成成功！');
        } else {
          toast.error(result.error || '生成失败');
        }
        return;
      }
      // NDJSON 流式：status 为生成过程，done 携带最终话术
      const reader = response.body?.getReader();
      if (!reader) throw new Error('生成失败');
      const decoder = new TextDecoder();
      let buffer = '';
      const outcome: { script?: string; error?: string } = {};
      const handleLine = (line: string) => {
        if (!line.trim()) return;
        const event: { type?: string; text?: string; data?: { script?: string }; error?: string } = JSON.parse(line);
        if (event.type === 'status' && event.text) {
          setScriptSteps((prev) => [...prev, event.text as string]);
        } else if (event.type === 'done' && event.data) {
          outcome.script = event.data.script;
        } else if (event.type === 'error') {
          outcome.error = event.error || '生成失败';
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
      if (!outcome.script) throw new Error('生成失败');
      setGeneratedScript(outcome.script);
      await reloadMatchRecords();
      toast.success('话术生成成功！');
    } catch (error) {
      console.error('生成话术失败:', error);
      toast.error(error instanceof Error ? error.message : '生成失败，请重试');
    } finally {
      setScriptLoading(false);
      setScriptSteps([]);
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
                className="w-full"
                onClick={handleCopyScript}
              >
                <Copy className="h-4 w-4 mr-2" />
                复制话术
              </Button>
            </div>
          ) : (
            <>
              <Button
                className="w-full"
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
                    AI生成话术
                  </>
                )}
              </Button>
              {scriptLoading && (
                <div className="mt-3 rounded-lg bg-muted/50 p-3">
                  <p className="mb-2 text-xs font-medium text-muted-foreground">
                    AI 正在生成沟通话术，请稍候：
                  </p>
                  <ul className="space-y-1.5">
                    {scriptSteps.map((step, index) => {
                      const isCurrent = index === scriptSteps.length - 1;
                      return (
                        <li key={`${step}-${index}`} className="flex items-center gap-2 text-xs text-muted-foreground">
                          {isCurrent ? <RefreshCw className="h-3.5 w-3.5 shrink-0 animate-spin text-blue-500" /> : <Check className="h-3.5 w-3.5 shrink-0 text-emerald-500" />}
                          {step}
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )}
            </>
          )}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            关闭
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
