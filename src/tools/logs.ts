import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { getCredentials, listLogs } from '../client.js';
import { parseToolArgs } from './args.js';
import type { CallToolResult } from './types.js';
import { errorResult, PAGE_PARAMS_PROPERTIES, requireCredentials, textResult } from './shared.js';

const LOG_TAGS = [
  'login',
  'device',
  'email-dispatch',
  'nms-backup',
  'nms-update',
  'nms-error',
  'device-state',
  'device-backup',
  'device-upgrade',
  'device-interface',
  'site',
];

export const LOG_TOOLS: Tool[] = [
  {
    name: 'uisp_list_logs',
    description:
      "List the UISP event/audit log (e.g. logins, device state changes, backups, upgrades). Log messages can embed device MAC/IP addresses. Filter by site, device, severity level, event tag, or a text query.",
    inputSchema: {
      type: 'object',
      properties: {
        siteId: { type: 'string', description: 'Filter to log items for this site.' },
        deviceId: { type: 'array', items: { type: 'string' }, description: 'Filter to log items for these device IDs.' },
        level: { type: 'string', enum: ['info', 'warning', 'error'], description: 'Filter by severity level.' },
        tag: { type: 'string', enum: LOG_TAGS, description: 'Filter by event tag/category.' },
        period: { type: 'number', description: 'Restrict to log items within the last N days.' },
        query: { type: 'string', description: 'Text search across log messages.' },
        ...PAGE_PARAMS_PROPERTIES,
      },
      required: ['count', 'page'],
    },
  },
];

const TOOL_NAMES = new Set(LOG_TOOLS.map((t) => t.name));
export function isLogTool(name: string): boolean {
  return TOOL_NAMES.has(name);
}

export async function handleLogTool(name: string, args: Record<string, unknown>): Promise<CallToolResult> {
  const creds = getCredentials();
  const missing = requireCredentials(creds);
  if (missing) return missing;

  try {
    args = parseToolArgs(name, args);
    if (name === 'uisp_list_logs') {
      return textResult(
        await listLogs(creds!, {
          count: args.count as number,
          page: args.page as number,
          siteId: args.siteId as string | undefined,
          deviceId: args.deviceId as string[] | undefined,
          level: args.level as 'info' | 'warning' | 'error' | undefined,
          tag: args.tag as string | undefined,
          period: args.period as number | undefined,
          query: args.query as string | undefined,
        })
      );
    }

    return errorResult(`Unknown tool: ${name}`);
  } catch (err) {
    return errorResult((err as Error).message);
  }
}
