import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { getCredentials, getSpeedTests } from '../client.js';
import { parseToolArgs } from './args.js';
import type { CallToolResult } from './types.js';
import { errorResult, requireCredentials, textResult } from './shared.js';

export const SPEED_TEST_TOOLS: Tool[] = [
  {
    name: 'uisp_get_speed_tests',
    description: 'Get detail about running and recent speed tests.',
    inputSchema: { type: 'object', properties: {} },
  },
];

const TOOL_NAMES = new Set(SPEED_TEST_TOOLS.map((t) => t.name));
export function isSpeedTestTool(name: string): boolean {
  return TOOL_NAMES.has(name);
}

export async function handleSpeedTestTool(name: string, args: Record<string, unknown>): Promise<CallToolResult> {
  const creds = getCredentials();
  const missing = requireCredentials(creds);
  if (missing) return missing;

  try {
    args = parseToolArgs(name, args);
    if (name === 'uisp_get_speed_tests') {
      return textResult(await getSpeedTests(creds!));
    }

    return errorResult(`Unknown tool: ${name}`);
  } catch (err) {
    return errorResult((err as Error).message);
  }
}
