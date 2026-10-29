import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { CRM_TOOLS, handleCrmTool, isCrmTool } from './crm.js';
import { DATA_LINK_TOOLS, handleDataLinkTool, isDataLinkTool } from './datalinks.js';
import { DEVICE_TOOLS, handleDeviceTool, isDeviceTool } from './devices.js';
import { FIRMWARE_TOOLS, handleFirmwareTool, isFirmwareTool } from './firmware.js';
import { GATEWAY_TOOLS, handleGatewayTool, isGatewayTool } from './gateways.js';
import { handleLogTool, isLogTool, LOG_TOOLS } from './logs.js';
import { handleOutageTool, isOutageTool, OUTAGE_TOOLS } from './outages.js';
import { writesEnabled } from './shared.js';
import { handleSiteTool, isSiteTool, SITE_TOOLS } from './sites.js';
import { handleSpeedTestTool, isSpeedTestTool, SPEED_TEST_TOOLS } from './speedtest.js';
import { handleSystemTool, isSystemTool, SYSTEM_TOOLS } from './system.js';
import { handleTaskTool, isTaskTool, TASK_TOOLS } from './tasks.js';
import { handleWifiTool, isWifiTool, WIFI_TOOLS } from './wifi.js';
import type { CallToolResult } from './types.js';

/** Read-only NMS and CRM tools. Write tools are not part of this list. */
export const READ_ONLY_TOOLS: Tool[] = [
  ...SITE_TOOLS,
  ...DEVICE_TOOLS,
  ...OUTAGE_TOOLS,
  ...LOG_TOOLS,
  ...DATA_LINK_TOOLS,
  ...GATEWAY_TOOLS,
  ...TASK_TOOLS,
  ...FIRMWARE_TOOLS,
  ...SPEED_TEST_TOOLS,
  ...SYSTEM_TOOLS,
  ...CRM_TOOLS,
];

/**
 * Tools advertised to the client. `uisp_set_wifi_password` is included only
 * when UISP_ENABLE_WRITES=true; the read-only catalog is unchanged otherwise.
 */
export function getAllTools(): Tool[] {
  return writesEnabled() ? [...READ_ONLY_TOOLS, ...WIFI_TOOLS] : [...READ_ONLY_TOOLS];
}

/** Read-only catalog captured for callers that import the constant. Prefer getAllTools(). */
export const ALL_TOOLS: Tool[] = READ_ONLY_TOOLS;

export async function dispatchToolCall(name: string, args: Record<string, unknown>): Promise<CallToolResult> {
  if (isSiteTool(name)) return handleSiteTool(name, args);
  if (isDeviceTool(name)) return handleDeviceTool(name, args);
  if (isOutageTool(name)) return handleOutageTool(name, args);
  if (isLogTool(name)) return handleLogTool(name, args);
  if (isDataLinkTool(name)) return handleDataLinkTool(name, args);
  if (isGatewayTool(name)) return handleGatewayTool(name, args);
  if (isTaskTool(name)) return handleTaskTool(name, args);
  if (isFirmwareTool(name)) return handleFirmwareTool(name, args);
  if (isSpeedTestTool(name)) return handleSpeedTestTool(name, args);
  if (isSystemTool(name)) return handleSystemTool(name, args);
  if (isCrmTool(name)) return handleCrmTool(name, args);
  if (isWifiTool(name)) {
    if (!writesEnabled()) {
      return {
        content: [{ type: 'text', text: 'Error: Write tools are disabled. Set UISP_ENABLE_WRITES=true to enable uisp_set_wifi_password. Nothing was changed.' }],
        isError: true,
      };
    }
    return handleWifiTool(name, args);
  }
  return { content: [{ type: 'text', text: `Unknown tool: ${name}` }], isError: true };
}
