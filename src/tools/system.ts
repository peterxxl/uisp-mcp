import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { getCredentials, getNetworkStatistics, getSummary, getVersion } from '../client.js';
import { parseToolArgs } from './args.js';
import type { CallToolResult } from './types.js';
import { projectStatistics } from '../nms-project.js';
import { errorResult, requireCredentials, textResult } from './shared.js';

export const SYSTEM_TOOLS: Tool[] = [
  {
    name: 'uisp_get_version',
    description: 'Get the UISP version, deployment type and build info. Useful as a credential/connectivity sanity check.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'uisp_get_network_statistics',
    description:
      'Get network-wide statistics: client/site counts, network health, signal/link/ISP scores, utilization, and outage counts. interval is the UISP bucket (hour, day, month, quarter, year). limit or period is how many recent buckets to return (default 24, newest first) so the time series does not fill the context. detail "full" keeps raw points on that page. Summary scalars are always included.',
    inputSchema: {
      type: 'object',
      properties: {
        interval: {
          type: 'string',
          enum: ['hour', 'day', 'month', 'quarter', 'year'],
          description: 'Time bucket requested from UISP.',
        },
        siri: { type: 'boolean', description: 'Include the SIRI (Signal Interference Ratio Index) score. Defaults to false.' },
        limit: { type: 'number', description: 'How many recent buckets to return, 1-500. Defaults to 24. Overrides period.' },
        period: { type: 'number', description: 'Alias of limit: number of recent buckets. Defaults to 24.' },
        offset: { type: 'number', description: 'Skip this many newest buckets. Defaults to 0.' },
        detail: { type: 'string', enum: ['compact', 'full'], description: 'compact (default) drops nested blobs inside each point. full keeps the raw point.' },
      },
      required: ['interval'],
    },
  },
  {
    name: 'uisp_get_summary',
    description:
      "Get badge-count-like values across the instance: unread logs/outages/firmwares, active/all client and site counts, devices needing authorization, firmware up-to-dateness. Each *Timestamp param scopes that count to items newer than the given epoch-ms timestamp — pass 0 for the instance's current totals.",
    inputSchema: {
      type: 'object',
      properties: {
        logsLevel: {
          type: 'array',
          items: { type: 'string', enum: ['info', 'warning', 'error'] },
          description: 'Which log severities to count toward logsUnreadCount.',
        },
        outagesTimestamp: { type: 'number', description: 'Epoch-ms timestamp; only outages newer than this count toward outagesUnreadCount.' },
        logsTimestamp: { type: 'number', description: 'Epoch-ms timestamp; only logs newer than this count toward logsUnreadCount.' },
        firmwaresTimestamp: { type: 'number', description: 'Epoch-ms timestamp; only firmwares newer than this count toward firmwaresUnreadCount.' },
      },
      required: ['logsLevel'],
    },
  },
];

const TOOL_NAMES = new Set(SYSTEM_TOOLS.map((t) => t.name));
export function isSystemTool(name: string): boolean {
  return TOOL_NAMES.has(name);
}

export async function handleSystemTool(name: string, args: Record<string, unknown>): Promise<CallToolResult> {
  const creds = getCredentials();
  const missing = requireCredentials(creds);
  if (missing) return missing;

  try {
    args = parseToolArgs(name, args);
    if (name === 'uisp_get_version') {
      return textResult(await getVersion(creds!));
    }

    if (name === 'uisp_get_network_statistics') {
      const interval = args.interval as 'hour' | 'day' | 'month' | 'quarter' | 'year';
      const body = await getNetworkStatistics(creds!, {
        interval,
        siri: args.siri as boolean | undefined,
      });
      return textResult(
        projectStatistics(body, {
          limit: (args.limit as number | undefined) ?? (args.period as number | undefined) ?? 24,
          offset: args.offset as number,
          detail: args.detail === 'full' ? 'full' : 'compact',
          interval,
        })
      );
    }

    if (name === 'uisp_get_summary') {
      return textResult(
        await getSummary(creds!, {
          logsLevel: args.logsLevel as Array<'info' | 'warning' | 'error'>,
          outagesTimestamp: args.outagesTimestamp as number | undefined,
          logsTimestamp: args.logsTimestamp as number | undefined,
          firmwaresTimestamp: args.firmwaresTimestamp as number | undefined,
        })
      );
    }

    return errorResult(`Unknown tool: ${name}`);
  } catch (err) {
    return errorResult((err as Error).message);
  }
}
