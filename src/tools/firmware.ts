import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { getCredentials, listFirmwares } from '../client.js';
import { parseToolArgs } from './args.js';
import type { CallToolResult } from './types.js';
import { errorResult, requireCredentials, textResult } from './shared.js';

export const FIRMWARE_TOOLS: Tool[] = [
  {
    name: 'uisp_list_firmwares',
    description: "Get the firmware versions available to UISP for its supported device models.",
    inputSchema: { type: 'object', properties: {} },
  },
];

const TOOL_NAMES = new Set(FIRMWARE_TOOLS.map((t) => t.name));
export function isFirmwareTool(name: string): boolean {
  return TOOL_NAMES.has(name);
}

export async function handleFirmwareTool(name: string, args: Record<string, unknown>): Promise<CallToolResult> {
  const creds = getCredentials();
  const missing = requireCredentials(creds);
  if (missing) return missing;

  try {
    args = parseToolArgs(name, args);
    if (name === 'uisp_list_firmwares') {
      return textResult(await listFirmwares(creds!));
    }

    return errorResult(`Unknown tool: ${name}`);
  } catch (err) {
    return errorResult((err as Error).message);
  }
}
