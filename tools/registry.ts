import { getIssueTool } from './get-issue';
import { searchIssuesTool } from './search-issues';
import { searchCodeTool } from './search-code';
import { readFileTool } from './read-file';
import { listDirectoryTool } from './list-directory';
import { getFileHistoryTool } from './get-file-history';

export const tools = {
  get_issue: getIssueTool,
  search_issues: searchIssuesTool,
  search_code: searchCodeTool,
  read_file: readFileTool,
  list_directory: listDirectoryTool,
  get_file_history: getFileHistoryTool,
} as const;

export type Tools = typeof tools;
export const TOOL_NAMES = Object.keys(tools) as Array<keyof Tools>;
