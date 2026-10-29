import { createServer as createHttpServer, type Server as HttpServer } from 'node:http';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createServer } from './server.js';
import { getCredentials, runWithCredentials } from './client.js';
import { logger } from './utils/logger.js';
import { MAX_REQUEST_BODY_BYTES } from './input-limits.js';
import { verifyS2sHeader, S2S_HEADER } from './s2s-verify.js';

export function startHttpServer(): HttpServer {
  const S2S_SECRET = process.env.CONDUIT_S2S_SECRET || '';
  const port = parseInt(process.env.MCP_HTTP_PORT || '8080', 10);
  // Bind to loopback unless a host is set. Do not publish this port without
  // CONDUIT_S2S_SECRET or another authenticator in front of it. The Docker
  // image sets MCP_HTTP_HOST=0.0.0.0 so container port mapping can reach it.
  const host = process.env.MCP_HTTP_HOST || '127.0.0.1';
  const isGatewayMode = process.env.AUTH_MODE === 'gateway';

  const httpServer = createHttpServer(async (req, res) => {
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);

    if (url.pathname === '/health') {
      // /health is container LIVENESS, not credential-readiness. In gateway
      // mode, credentials arrive per-request via X-UISP-Api-Key/
      // X-UISP-Base-URL, not at startup - checking getCredentials() here
      // would 503 the container permanently regardless of whether any
      // customer has connected yet.
      const creds = getCredentials();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          status: 'ok',
          transport: 'http',
          mode: isGatewayMode ? 'gateway' : 'standalone',
          credentials: { configured: !!creds },
          timestamp: new Date().toISOString(),
        })
      );
      return;
    }

    if (url.pathname !== '/mcp') {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Not found', endpoints: ['/mcp', '/health'] }));
      return;
    }

    if (S2S_SECRET && !verifyS2sHeader(req.headers[S2S_HEADER] as string | undefined, S2S_SECRET)) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          error: 'Missing or invalid X-Gateway-S2S header: this endpoint only accepts requests signed by the gateway.',
        })
      );
      return;
    }

    // Body cap runs only after S2S passes so unauthenticated callers still get 401.
    const contentLength = Number(req.headers['content-length']);
    if (Number.isFinite(contentLength) && contentLength > MAX_REQUEST_BODY_BYTES) {
      res.writeHead(413, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          jsonrpc: '2.0',
          error: { code: -32600, message: `Request body exceeds ${MAX_REQUEST_BODY_BYTES} bytes` },
          id: null,
        })
      );
      return;
    }

    const apiKey = isGatewayMode ? (req.headers['x-uisp-api-key'] as string | undefined) : undefined;
    const baseUrl = isGatewayMode ? (req.headers['x-uisp-base-url'] as string | undefined) : undefined;
    const crmAppKey = isGatewayMode ? (req.headers['x-uisp-crm-app-key'] as string | undefined) : undefined;
    const crmBaseUrl = isGatewayMode ? (req.headers['x-uisp-crm-base-url'] as string | undefined) : undefined;

    const handle = async () => {
      // SECURITY-CRITICAL invariant: this transport MUST stay stateless
      // (sessionIdGenerator: undefined + enableJsonResponse: true).
      // Per-request tenant credentials are carried in an AsyncLocalStorage
      // context opened by runWithCredentials() below. A stateless
      // request->single-response flow keeps the tool call inside that
      // context - switching to a stateful/SSE transport would let a
      // long-lived connection serve later messages under a stale/foreign
      // credential context.
      const server = createServer();
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
        enableJsonResponse: true,
        maxRequestBodySize: MAX_REQUEST_BODY_BYTES,
      });
      res.on('close', () => {
        transport.close();
        server.close();
      });
      await server.connect(transport);
      await transport.handleRequest(req, res);
    };

    const scopedBase = baseUrl || crmBaseUrl;
    const hasNms = !!(apiKey && baseUrl);
    const hasCrm = !!(crmAppKey && scopedBase);
    if (hasNms || hasCrm) {
      await runWithCredentials(
        {
          apiKey: apiKey || '',
          baseUrl: scopedBase || '',
          crmAppKey,
          crmBaseUrl: crmBaseUrl || baseUrl,
        },
        handle
      );
    } else {
      await handle();
    }
  });

  httpServer.listen(port, host, () => {
    logger.info(`HTTP streaming server listening on ${host}:${port}`);
  });

  return httpServer;
}

if (process.env.VITEST !== 'true') {
  if (process.env.MCP_TRANSPORT === 'http') {
    startHttpServer();
  } else {
    import('./index.js');
  }
}
