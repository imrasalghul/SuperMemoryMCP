#!/usr/bin/env node
import "dotenv/config";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createServer } from "node:http";
import { z } from "zod";

const apiKey = process.env.SUPERMEMORY_API_KEY;
const configuredBaseUrl = process.env.SUPERMEMORY_BASE_URL;
const containerTag = process.env.SUPERMEMORY_CONTAINER_TAG;

if (!apiKey) throw new Error("SUPERMEMORY_API_KEY is required");
if (!configuredBaseUrl) throw new Error("SUPERMEMORY_BASE_URL is required");

const baseUrl = configuredBaseUrl.replace(/\/+$/, "");
if (!/^https?:\/\//i.test(baseUrl)) {
  throw new Error("SUPERMEMORY_BASE_URL must be an absolute http(s) URL");
}

async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      ...init.headers,
    },
  });
  const text = await response.text();
  let body: unknown;
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = text;
  }
  if (!response.ok) {
    const detail = typeof body === "object" && body !== null
      ? JSON.stringify(body)
      : String(body);
    throw new Error(`Supermemory API ${response.status} ${response.statusText}: ${detail}`);
  }
  return body as T;
}

const tagSchema = z.string().min(1).max(100).regex(/^[a-zA-Z0-9_:-]+$/);
const metadataSchema = z.record(
  z.union([z.string(), z.number(), z.boolean(), z.array(z.string())]),
);

function resolveTag(value?: string): string | undefined {
  return value ?? containerTag;
}

function requireTag(value?: string): string {
  const tag = resolveTag(value);
  if (!tag) {
    throw new Error(
      "containerTag is required. Pass it to the tool or set SUPERMEMORY_CONTAINER_TAG.",
    );
  }
  return tag;
}

function createMcpServer(): McpServer {
  const server = new McpServer({
    name: "supermemory-mcp-server",
    version: "1.0.0",
  });

// Tool 1 of 4: explicitly store one memory directly, bypassing document ingestion.
server.tool(
  "supermemory-save",
  "Store an explicit memory in Supermemory (alias: supermemory_store).",
  {
    content: z.string().min(1).max(10_000).describe("The memory text to store."),
    containerTag: tagSchema.optional().describe("Container tag; defaults to SUPERMEMORY_CONTAINER_TAG."),
    isStatic: z.boolean().optional().describe("Mark a permanent trait or fact."),
    metadata: metadataSchema.optional().describe("Optional memory metadata."),
    forgetAfter: z.string().datetime({ offset: true }).nullable().optional()
      .describe("Optional ISO-8601 expiration time."),
    forgetReason: z.string().nullable().optional().describe("Reason for scheduled forgetting."),
  },
  async ({ content, containerTag: requestedTag, isStatic, metadata, forgetAfter, forgetReason }) => {
    const result = await api<unknown>("/v4/memories", {
      method: "POST",
      body: JSON.stringify({
        containerTag: requireTag(requestedTag),
        memories: [{ content, isStatic, metadata, forgetAfter, forgetReason }],
      }),
    });
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  },
);

// Tool 2 of 4: semantic memory search.
server.tool(
  "supermemory-search",
  "Search memories by semantic similarity (alias: supermemory_search).",
  {
    query: z.string().min(1).describe("Natural-language semantic search query."),
    containerTag: tagSchema.optional().describe("Container tag; defaults to SUPERMEMORY_CONTAINER_TAG."),
    limit: z.number().int().min(1).max(100).optional().default(10),
    threshold: z.number().min(0).max(1).optional(),
    rerank: z.boolean().optional(),
    includeRelatedMemories: z.boolean().optional(),
  },
  async ({ query, containerTag: requestedTag, limit, threshold, rerank, includeRelatedMemories }) => {
    const result = await api<unknown>("/v4/search", {
      method: "POST",
      body: JSON.stringify({
        q: query,
        ...(resolveTag(requestedTag) ? { containerTag: resolveTag(requestedTag) } : {}),
        limit,
        threshold,
        rerank,
        ...(includeRelatedMemories === undefined ? {} : { include: { relatedMemories: includeRelatedMemories } }),
        searchMode: "memories",
      }),
    });
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  },
);

// Tool 3 of 4: forget by exact memory ID/content or agentic best-match query.
server.tool(
  "supermemory-forget",
  "Forget a memory by ID or best-match query (alias: supermemory_forget). Query mode supports dryRun previews.",
  {
    containerTag: tagSchema.optional().describe("Container tag; defaults to SUPERMEMORY_CONTAINER_TAG."),
    id: z.string().min(1).optional().describe("Exact memory ID to forget."),
    content: z.string().min(1).optional().describe("Exact memory content to forget when ID is unknown."),
    query: z.string().min(1).max(2000).optional().describe("Natural-language query identifying memories to forget."),
    reason: z.string().optional().describe("Optional reason for forgetting."),
    dryRun: z.boolean().optional().default(false).describe("For query mode, preview matches without forgetting them."),
    threshold: z.number().min(0).max(1).optional(),
    maxForget: z.number().int().min(1).max(500).optional(),
  },
  async ({ containerTag: requestedTag, id, content, query, reason, dryRun, threshold, maxForget }) => {
    if (Number(Boolean(id)) + Number(Boolean(content)) + Number(Boolean(query)) !== 1) {
      throw new Error("Provide exactly one of id, content, or query.");
    }
    const tag = requireTag(requestedTag);
    const result = query
      ? await api<unknown>("/v4/memories/forget-matching", {
          method: "POST",
          body: JSON.stringify({ containerTag: tag, query, reason, dryRun, threshold, maxForget }),
        })
      : await api<unknown>("/v4/memories", {
          method: "DELETE",
          body: JSON.stringify({ containerTag: tag, ...(id ? { id } : { content }), reason }),
        });
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  },
);

// Tool 4 of 4: retrieve the persistent profile and optional recent context.
server.tool(
  "supermemory-profile",
  "Retrieve the persistent profile and optionally recent context (alias: supermemory_profile).",
  {
    containerTag: tagSchema.optional().describe("Container tag; defaults to SUPERMEMORY_CONTAINER_TAG."),
    query: z.string().min(1).optional().describe("Optional query to include matching recent context."),
    threshold: z.number().min(0).max(1).optional(),
    include: z.array(z.enum(["static", "dynamic", "buckets"])).optional(),
    buckets: z.array(z.string()).optional(),
  },
  async ({ containerTag: requestedTag, query, threshold, include, buckets }) => {
    const result = await api<unknown>("/v4/profile", {
      method: "POST",
      body: JSON.stringify({ containerTag: requireTag(requestedTag), q: query, threshold, include, buckets }),
    });
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  },
);

  return server;
}

if (process.env.MCP_TRANSPORT?.toLowerCase() === "http") {
  const host = process.env.MCP_HOST ?? "127.0.0.1";
  const port = Number(process.env.MCP_PORT ?? 4589);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error("MCP_PORT must be an integer from 1 to 65535");
  }

  const httpServer = createServer((request, response) => {
    const pathname = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`).pathname;
    if (pathname === "/healthz" && request.method === "GET") {
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ status: "ok" }));
      return;
    }
    if (pathname !== "/mcp") {
      response.writeHead(404).end("Not found");
      return;
    }
    if (request.method !== "POST") {
      response.writeHead(405, { Allow: "POST" }).end("Method not allowed");
      return;
    }
    void (async () => {
      const requestServer = createMcpServer();
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
      response.on("close", () => {
        void transport.close();
        void requestServer.close();
      });
      try {
        await requestServer.connect(transport);
        await transport.handleRequest(request, response);
      } catch (error) {
        console.error("MCP HTTP request failed:", error);
        if (!response.headersSent) response.writeHead(500);
        if (!response.writableEnded) response.end();
      }
    })();
  });
  httpServer.listen(port, host, () => {
    console.error(`Supermemory MCP Streamable HTTP listening at http://${host}:${port}/mcp`);
  });
} else {
  const server = createMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
