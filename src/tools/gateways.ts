import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { getCredentials, getGateway, listGateways } from '../client.js';
import { parseToolArgs } from './args.js';
import type { CallToolResult } from './types.js';
import { errorResult, requireCredentials, textResult } from './shared.js';

export const GATEWAY_TOOLS: Tool[] = [
  {
    name: 'uisp_list_gateways',
    description: 'List gateways - routers configured as network gateways - and their NetFlow/QoS/suspend configuration.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'uisp_get_gateway',
    description: "Get a single gateway's detail by ID.",
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string', description: 'Gateway ID (from uisp_list_gateways).' } },
      required: ['id'],
    },
  },
];

const TOOL_NAMES = new Set(GATEWAY_TOOLS.map((t) => t.name));
export function isGatewayTool(name: string): boolean {
  return TOOL_NAMES.has(name);
}

export async function handleGatewayTool(name: string, args: Record<string, unknown>): Promise<CallToolResult> {
  const creds = getCredentials();
  const missing = requireCredentials(creds);
  if (missing) return missing;

  try {
    args = parseToolArgs(name, args);
    if (name === 'uisp_list_gateways') {
      return textResult(await listGateways(creds!));
    }

    if (name === 'uisp_get_gateway') {
      return textResult(await getGateway(creds!, args.id as string));
    }

    return errorResult(`Unknown tool: ${name}`);
  } catch (err) {
    return errorResult((err as Error).message);
  }
}
