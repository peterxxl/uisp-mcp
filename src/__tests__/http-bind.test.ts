import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { startHttpServer } from '../http.js';

describe('HTTP bind address', () => {
  const servers: Server[] = [];
  const previousHost = process.env.MCP_HTTP_HOST;
  const previousPort = process.env.MCP_HTTP_PORT;

  afterEach(async () => {
    while (servers.length) {
      const server = servers.pop()!;
      if (server.listening) await new Promise<void>((resolve) => server.close(() => resolve()));
    }
    if (previousHost === undefined) delete process.env.MCP_HTTP_HOST;
    else process.env.MCP_HTTP_HOST = previousHost;
    if (previousPort === undefined) delete process.env.MCP_HTTP_PORT;
    else process.env.MCP_HTTP_PORT = previousPort;
  });

  it('binds to 127.0.0.1 when MCP_HTTP_HOST is unset', async () => {
    delete process.env.MCP_HTTP_HOST;
    process.env.MCP_HTTP_PORT = '0';
    const server = startHttpServer();
    servers.push(server);
    if (!server.listening) await new Promise<void>((resolve) => server.once('listening', () => resolve()));
    const address = server.address() as AddressInfo;
    expect(address.address).toBe('127.0.0.1');
  });
});
