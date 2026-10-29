import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { getCredentials, getTasksInProgress, listTasks } from '../client.js';
import { parseToolArgs } from './args.js';
import type { CallToolResult } from './types.js';
import { errorResult, PAGE_PARAMS_PROPERTIES, requireCredentials, textResult } from './shared.js';

export const TASK_TOOLS: Tool[] = [
  {
    name: 'uisp_list_tasks',
    description: 'List background tasks (e.g. firmware upgrades, backups, mass operations) and their status.',
    inputSchema: {
      type: 'object',
      properties: {
        status: {
          type: 'string',
          enum: ['success', 'failed', 'in-progress', 'canceled', 'queued'],
          description: 'Filter by task status.',
        },
        period: { type: 'number', description: 'Restrict to tasks within the last N days.' },
        ...PAGE_PARAMS_PROPERTIES,
      },
      required: ['count', 'page'],
    },
  },
  {
    name: 'uisp_get_tasks_in_progress',
    description: 'Get the number of tasks currently in progress.',
    inputSchema: { type: 'object', properties: {} },
  },
];

const TOOL_NAMES = new Set(TASK_TOOLS.map((t) => t.name));
export function isTaskTool(name: string): boolean {
  return TOOL_NAMES.has(name);
}

export async function handleTaskTool(name: string, args: Record<string, unknown>): Promise<CallToolResult> {
  const creds = getCredentials();
  const missing = requireCredentials(creds);
  if (missing) return missing;

  try {
    args = parseToolArgs(name, args);
    if (name === 'uisp_list_tasks') {
      return textResult(
        await listTasks(creds!, {
          count: args.count as number,
          page: args.page as number,
          status: args.status as 'success' | 'failed' | 'in-progress' | 'canceled' | 'queued' | undefined,
          period: args.period as number | undefined,
        })
      );
    }

    if (name === 'uisp_get_tasks_in_progress') {
      return textResult(await getTasksInProgress(creds!));
    }

    return errorResult(`Unknown tool: ${name}`);
  } catch (err) {
    return errorResult((err as Error).message);
  }
}
