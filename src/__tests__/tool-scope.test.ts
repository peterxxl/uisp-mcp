import { afterEach, describe, expect, it } from 'vitest';
import { getAllTools } from '../tools/index.js';

/**
 * Hard scope boundary (see README's Scope section): this connector must
 * NEVER expose a tool that creates/updates/deletes/restores/authorizes/
 * upgrades/reboots/suspends anything, or that reaches the device-credential
 * vault, API-token administration, or the raw per-device UDAPI proxy - UISP's
 * own API exposes all of those as documented endpoints, and none of them
 * belong in a read-only connector. Pin the exact tool set so an accidental
 * addition - a copy-pasted "create_site", "authorize_device",
 * "restore_backup", "get_credentials", or any other write/admin tool -
 * fails this test immediately rather than silently shipping.
 */
describe('ALL_TOOLS scope boundary', () => {
  const EXPECTED_TOOL_NAMES = [
    // Sites
    'uisp_list_sites',
    'uisp_get_site',
    'uisp_search_sites',
    'uisp_list_site_clients',
    'uisp_get_site_statistics',
    'uisp_get_site_traffic_summary',
    // Devices
    'uisp_list_devices',
    'uisp_get_device',
    'uisp_get_device_detail',
    'uisp_get_device_statistics',
    'uisp_list_device_interfaces',
    'uisp_get_device_by_mac',
    'uisp_list_discovered_devices',
    // Outages
    'uisp_list_outages',
    // Logs
    'uisp_list_logs',
    // Data Links
    'uisp_list_data_links',
    'uisp_get_data_link',
    'uisp_list_site_data_links',
    // Gateways
    'uisp_list_gateways',
    'uisp_get_gateway',
    // Tasks
    'uisp_list_tasks',
    'uisp_get_tasks_in_progress',
    // Firmware
    'uisp_list_firmwares',
    // Speed Test
    'uisp_get_speed_tests',
    // System
    'uisp_get_version',
    'uisp_get_network_statistics',
    'uisp_get_summary',
    // CRM (read-only)
    'uisp_search_clients',
    'uisp_get_client',
    'uisp_list_client_services',
    'uisp_list_invoices',
    'uisp_get_invoice',
    'uisp_list_overdue_invoices',
    'uisp_list_debtors',
    'uisp_list_payments',
    'uisp_map_client_site',
  ].sort();

  afterEach(() => {
    delete process.env.UISP_ENABLE_WRITES;
  });

  it('exposes exactly the read-only NMS and CRM tools when writes are disabled', () => {
    delete process.env.UISP_ENABLE_WRITES;
    const names = getAllTools().map((t) => t.name).sort();
    expect(names).toEqual(EXPECTED_TOOL_NAMES);
    expect(names).not.toContain('uisp_set_wifi_password');
    expect(names).toHaveLength(EXPECTED_TOOL_NAMES.length);
  });

  it('adds only uisp_set_wifi_password when UISP_ENABLE_WRITES=true', () => {
    process.env.UISP_ENABLE_WRITES = 'true';
    const names = getAllTools().map((t) => t.name).sort();
    expect(names).toEqual([...EXPECTED_TOOL_NAMES, 'uisp_set_wifi_password'].sort());
  });

  it('never exposes a write, authorization, restore, credential-vault, or token-admin tool', () => {
    // Forbidden as a whole underscore-token, not a substring - so this does
    // NOT false-positive on legitimate tokens like 'status' or 'discovered'.
    const FORBIDDEN_TOKENS = new Set([
      'create',
      'update',
      'delete',
      'restore',
      'authorize',
      'upgrade',
      'reboot',
      'suspend',
      'reset',
      'login',
      'logout',
      'move',
      'clone',
      'credentials',
      'credential',
      'vault',
      'token',
      'udapi',
      'scan',
      'discover',
    ]);

    process.env.UISP_ENABLE_WRITES = 'true';
    for (const tool of getAllTools()) {
      const tokens = tool.name.split('_');
      for (const token of tokens) {
        expect(
          FORBIDDEN_TOKENS.has(token),
          `Tool "${tool.name}" contains forbidden token "${token}" - this connector must stay read-only except for uisp_set_wifi_password.`
        ).toBe(false);
      }
    }
  });

  it('every tool name is prefixed with uisp_', () => {
    process.env.UISP_ENABLE_WRITES = 'true';
    for (const tool of getAllTools()) {
      expect(tool.name.startsWith('uisp_')).toBe(true);
    }
    const writeNamed = getAllTools().filter((tool) => tool.name.includes('password') || tool.name.split('_').includes('set'));
    expect(writeNamed.map((tool) => tool.name)).toEqual(['uisp_set_wifi_password']);
  });
});
