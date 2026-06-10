import type { LucideIcon } from 'lucide-react';
import {
  FileCode,
  FileSearch,
  FolderTree,
  GitBranch,
  History,
  Search,
  Sparkles,
  Wrench,
} from 'lucide-react';

export interface ToolMeta {
  label: string;
  Icon: LucideIcon;
  /** Tailwind classes for the icon chip (bg + text). */
  chip: string;
}

const FALLBACK: ToolMeta = {
  label: 'tool',
  Icon: Wrench,
  chip: 'bg-muted text-muted-foreground',
};

const TOOL_META: Record<string, ToolMeta> = {
  get_issue: {
    label: 'get_issue',
    Icon: FileSearch,
    chip: 'bg-violet-500/12 text-violet-600 dark:text-violet-300',
  },
  search_issues: {
    label: 'search_issues',
    Icon: Search,
    chip: 'bg-blue-500/12 text-blue-600 dark:text-blue-300',
  },
  search_code: {
    label: 'search_code',
    Icon: FileCode,
    chip: 'bg-emerald-500/12 text-emerald-600 dark:text-emerald-300',
  },
  read_file: {
    label: 'read_file',
    Icon: FileCode,
    chip: 'bg-amber-500/14 text-amber-700 dark:text-amber-300',
  },
  list_directory: {
    label: 'list_directory',
    Icon: FolderTree,
    chip: 'bg-cyan-500/12 text-cyan-700 dark:text-cyan-300',
  },
  get_file_history: {
    label: 'get_file_history',
    Icon: History,
    chip: 'bg-rose-500/12 text-rose-600 dark:text-rose-300',
  },
};

export function toolMeta(name: string): ToolMeta {
  return TOOL_META[name] ?? { ...FALLBACK, label: name || FALLBACK.label };
}

export const reasoningMeta: ToolMeta = {
  label: 'reasoning',
  Icon: Sparkles,
  chip: 'bg-primary/12 text-primary',
};
