import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { getCredentials, listOutages } from '../client.js';
import { parseToolArgs } from './args.js';
import type { CallToolResult } from './types.js';
import { errorResult, PAGE_PARAMS_PROPERTIES, requireCredentials, textResult } from './shared.js';

export const OUTAGE_TOOLS: Tool[] = [
  {
    name: 'uisp_list_outages',
    description:
      "List network outages - UISP's alerting surface - each tied to a site and device. Filter by device, type (outage/unreachable), a text query, or in-progress state.",
    inputSchema: {
      type: 'object',
      properties: {
        deviceId: { type: 'string', description: 'Filter to outages for this device ID.' },
        period: { type: 'number', description: 'Restrict to outages within the last N days.' },
        query: { type: 'string', description: 'Text search across outage records.' },
        type: { type: 'string', enum: ['outage', 'unreachable'], description: 'Filter by outage type.' },
        inProgress: { type: 'boolean', description: 'Filter to outages that are still ongoing.' },
        ...PAGE_PARAMS_PROPERTIES,
      },
      required: ['count', 'page'],
    },
  },
];

const TOOL_NAMES = new Set(OUTAGE_TOOLS.map((t) => t.name));
export function isOutageTool(name: string): boolean {
  return TOOL_NAMES.has(name);
}

export async function handleOutageTool(name: string, args: Record<string, unknown>): Promise<CallToolResult> {
  const creds = getCredentials();
  const missing = requireCredentials(creds);
  if (missing) return missing;

  try {
    args = parseToolArgs(name, args);
    if (name === 'uisp_list_outages') {
      return textResult(
        await listOutages(creds!, {
          count: args.count as number,
          page: args.page as number,
          deviceId: args.deviceId as string | undefined,
          period: args.period as number | undefined,
          query: args.query as string | undefined,
          type: args.type as 'outage' | 'unreachable' | undefined,
          inProgress: args.inProgress as boolean | undefined,
        })
      );
    }

    return errorResult(`Unknown tool: ${name}`);
  } catch (err) {
    return errorResult((err as Error).message);
  }
}
