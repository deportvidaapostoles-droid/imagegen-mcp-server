#!/usr/bin/env node
/**
 * CLI entry point.
 *
 * Runs the ImageGen MCP server locally over one of the supported transports:
 *   - `stdio` (default) — for desktop MCP clients
 *   - `http`            — Streamable HTTP on /mcp (same handler used on Vercel)
 *   - `sse`             — legacy HTTP+SSE transport, for older clients
 *
 * The serverless deployment does not use this file: see `api/mcp.ts`.
 */
import { createServer } from "node:http";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { getAuthConfig } from "./auth.js";
import { getCliHelpText, getServerRuntimeConfig, loadDotEnv } from "./config.js";
import { applyCorsHeaders, handleAuthorizationServerMetadata, handleMcpRequest, handleProtectedResourceMetadata, healthPayload, writeJson, } from "./http-transport.js";
import { createMcpServer } from "./mcp-server.js";
loadDotEnv();
const runtimeConfig = getServerRuntimeConfig();
const authConfig = getAuthConfig();
if (runtimeConfig.helpRequested) {
    process.stderr.write(getCliHelpText() + "\n");
    process.exit(0);
}
const shouldEmitRuntimeLogs = runtimeConfig.transportMode !== "stdio" || runtimeConfig.stdioLogsEnabled;
function logRuntime(...args) {
    if (shouldEmitRuntimeLogs) {
        console.error(...args);
    }
}
async function main() {
    [...runtimeConfig.warnings, ...authConfig.warnings].forEach((warning) => logRuntime(`Config warning: ${warning}`));
    const { provider, model, transportMode, host, port } = runtimeConfig;
    if (transportMode === "stdio") {
        const { server, taskStore } = createMcpServer(runtimeConfig, { log: logRuntime });
        taskStore.startCleanupTimer();
        await server.connect(new StdioServerTransport());
        logRuntime(`ImageGen MCP Server running on stdio (provider: ${provider}, model: ${model})`);
        return;
    }
    if (transportMode !== "http" && transportMode !== "sse") {
        throw new Error(`Unknown transport mode: ${transportMode}`);
    }
    const sseTransports = new Map();
    const httpServer = createServer((req, res) => {
        void (async () => {
            const url = new URL(req.url || "/", `http://${req.headers.host ?? "localhost"}`);
            if (url.pathname === "/mcp" ||
                url.pathname === "/api/mcp" ||
                url.pathname.startsWith("/mcp/") ||
                url.pathname.startsWith("/api/mcp/")) {
                await handleMcpRequest(req, res, runtimeConfig, { log: logRuntime, auth: authConfig });
                return;
            }
            if (url.pathname.startsWith("/.well-known/oauth-protected-resource")) {
                handleProtectedResourceMetadata(req, res, authConfig);
                return;
            }
            if (url.pathname.startsWith("/.well-known/oauth-authorization-server")) {
                await handleAuthorizationServerMetadata(req, res, authConfig);
                return;
            }
            applyCorsHeaders(res);
            if (req.method === "OPTIONS") {
                res.writeHead(204).end();
                return;
            }
            if ((url.pathname === "/health" || url.pathname === "/api/health" || url.pathname === "/") &&
                req.method === "GET") {
                writeJson(res, 200, healthPayload(runtimeConfig, authConfig));
                return;
            }
            // ── Legacy HTTP+SSE transport ───────────────────────────────────────
            if (url.pathname === "/sse" && req.method === "GET") {
                const transport = new SSEServerTransport("/message", res);
                const { server, taskStore } = createMcpServer(runtimeConfig, { log: logRuntime });
                taskStore.startCleanupTimer();
                sseTransports.set(transport.sessionId, transport);
                transport.onclose = () => {
                    sseTransports.delete(transport.sessionId);
                    taskStore.stopCleanupTimer();
                    void server.close().catch(() => { });
                };
                await server.connect(transport);
                logRuntime(`SSE connection established: ${transport.sessionId}`);
                return;
            }
            if (url.pathname === "/message" && req.method === "POST") {
                const sessionId = url.searchParams.get("sessionId");
                const transport = sessionId ? sseTransports.get(sessionId) : undefined;
                if (!transport) {
                    writeJson(res, 400, { error: "No session found" });
                    return;
                }
                await transport.handlePostMessage(req, res);
                return;
            }
            writeJson(res, 404, { error: "Not Found" });
        })().catch((error) => {
            logRuntime("Request handling failed:", error);
            if (!res.headersSent) {
                writeJson(res, 500, { error: "Internal server error" });
            }
            else {
                res.end();
            }
        });
    });
    httpServer.listen(port, host, () => {
        logRuntime(`ImageGen MCP Server listening on http://${host}:${port} ` +
            `(${transportMode} mode, provider: ${provider}, model: ${model})`);
        logRuntime(`  MCP endpoint:    http://${host}:${port}/mcp`);
        logRuntime(`  Health endpoint: http://${host}:${port}/health`);
        logRuntime(`  Authentication:  ${authConfig.mode === "oauth"
            ? "OAuth bearer tokens"
            : authConfig.mode === "token"
                ? `shared secret (${authConfig.tokens.length} token(s))`
                : "disabled"}`);
        if (transportMode === "sse") {
            logRuntime(`  Legacy SSE:      http://${host}:${port}/sse`);
        }
    });
}
main().catch((error) => {
    console.error("Fatal error:", error);
    process.exit(1);
});
//# sourceMappingURL=index.js.map