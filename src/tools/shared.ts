import type { UispCredentials } from '../types.js';
import type { CallToolResult } from './types.js';

export function textResult(value: unknown): CallToolResult {
  const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
  return { content: [{ type: 'text', text }] };
}

export function errorResult(message: string): CallToolResult {
  return { content: [{ type: 'text', text: `Error: ${message}` }], isError: true };
}

/** Returns an error CallToolResult if NMS credentials are missing, else null. */
export function requireCredentials(creds: UispCredentials | null): CallToolResult | null {
  if (!creds?.apiKey || !creds.baseUrl) {
    return errorResult('UISP NMS failed: missing credentials. Set UISP_API_KEY and UISP_BASE_URL.');
  }
  return null;
}

/** Returns an error CallToolResult if CRM credentials are missing, else null. */
export function requireCrmCredentials(creds: UispCredentials | null): CallToolResult | null {
  if (!creds?.crmAppKey || !(creds.crmBaseUrl || creds.baseUrl)) {
    return errorResult('UISP CRM failed: missing credentials. Set UISP_CRM_APP_KEY and UISP_BASE_URL (or UISP_CRM_BASE_URL).');
  }
  return null;
}

/** Write tools are off unless this is exactly the string `true`. */
export function writesEnabled(): boolean {
  return process.env.UISP_ENABLE_WRITES === 'true';
}

/** Shared input-schema fragment for the count/page-paginated list endpoints (outages, logs, tasks, site search). */
export const PAGE_PARAMS_PROPERTIES = {
  count: { type: 'number', description: 'Number of results per page.' },
  page: { type: 'number', description: 'Page number (1-indexed).' },
} as const;
