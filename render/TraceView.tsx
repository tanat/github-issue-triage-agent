'use client';

import type { UIMessage, UIMessagePart, UIDataTypes, UITools } from 'ai';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { StepCard, TextStep, type ToolPart } from './StepCard';

type AnyPart = UIMessagePart<UIDataTypes, UITools>;

function extractToolPart(part: AnyPart): ToolPart | null {
  if (part.type === 'dynamic-tool') {
    const p = part as unknown as ToolPart & { state: string };
    return {
      toolName: (part as unknown as { toolName: string }).toolName,
      toolCallId: p.toolCallId,
      state: p.state,
      input: (p as { input?: unknown }).input,
      output: (p as { output?: unknown }).output,
      errorText: (p as { errorText?: string }).errorText,
    };
  }
  if (typeof part.type === 'string' && part.type.startsWith('tool-')) {
    const p = part as unknown as ToolPart & { state: string; type: string };
    return {
      toolName: p.type.slice('tool-'.length),
      toolCallId: p.toolCallId,
      state: p.state,
      input: (p as { input?: unknown }).input,
      output: (p as { output?: unknown }).output,
      errorText: (p as { errorText?: string }).errorText,
    };
  }
  return null;
}

export function TraceView({ messages }: { messages: UIMessage[] }) {
  const assistant = [...messages].reverse().find((m) => m.role === 'assistant');
  if (!assistant) {
    return (
      <div className="text-sm text-muted-foreground">
        Submit an issue URL to start a triage run.
      </div>
    );
  }
  const items: AnyPart[] = assistant.parts ?? [];
  return (
    <ScrollArea className="h-[70vh] pr-3">
      <div className="space-y-2">
        {items.map((part, i) => {
          const tool = extractToolPart(part);
          if (tool) {
            return <StepCard key={`${tool.toolCallId}-${i}`} idx={i + 1} part={tool} />;
          }
          if (part.type === 'text' && (part as { text: string }).text.trim()) {
            return <TextStep key={`text-${i}`} idx={i + 1} text={(part as { text: string }).text} />;
          }
          if (part.type === 'reasoning' && (part as { text?: string }).text) {
            return <TextStep key={`reasoning-${i}`} idx={i + 1} text={(part as { text: string }).text} />;
          }
          if (part.type === 'step-start') {
            return <Separator key={`sep-${i}`} className="my-1" />;
          }
          return null;
        })}
      </div>
    </ScrollArea>
  );
}

export function extractFinalText(messages: UIMessage[]): string {
  const assistant = [...messages].reverse().find((m) => m.role === 'assistant');
  if (!assistant) return '';
  const parts: AnyPart[] = assistant.parts ?? [];
  return parts
    .filter((p) => p.type === 'text')
    .map((p) => (p as { text: string }).text)
    .join('\n');
}
