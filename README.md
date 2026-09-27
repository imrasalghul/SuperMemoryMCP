# Supermemory MCP Server

A lightweight [Model Context Protocol (MCP)](https://modelcontextprotocol.io/) server that connects MCP clients to [Supermemory](https://supermemory.ai). It exposes four focused tools for saving, searching, forgetting, and retrieving memories.

The server supports **stdio** for local MCP clients and **Streamable HTTP** deployments. It talks directly to the Supermemory API using your API key.

## Features

- Exactly four MCP tools, with names and aliases listed below.
- Semantic search with optional threshold, reranking, and related memories.
- Explicit memory storage with optional metadata, static status, and expiration.
- Forget memories by ID or content, or preview best-match deletion with `dryRun`.
- Retrieve a persistent profile and optionally query-matched recent context.
- Install and run through `npx` from GitHub Packages, or run from source with Node.js.

## Requirements

- A Supermemory API key.
- A Supermemory API base URL. For Supermemory Cloud, use `https://api.supermemory.ai`; self-hosted deployments can provide their own URL.
- Node.js 22 or newer.

## Configuration

| Variable | Required | Description |
| --- | --- | --- |
| `SUPERMEMORY_API_KEY` | Yes | API key sent as a Bearer token to Supermemory. |
| `SUPERMEMORY_BASE_URL` | Yes | Supermemory API base URL, without a trailing slash. |
| `SUPERMEMORY_CONTAINER_TAG` | No | Default container tag for tools that require one. A per-call `containerTag` overrides it. |
| `MCP_TRANSPORT` | No | Set to `http` to use Streamable HTTP. Defaults to stdio. |
| `MCP_HOST` | No | HTTP bind address. Defaults to `127.0.0.1`. |
| `MCP_PORT` | No | HTTP port. Defaults to `4589`. |

Save credentials in your MCP client's environment or a local `.env` file. **Do not commit API keys or include them in container images.** The server loads `.env` when started from the project directory.

Example `.env`:

```dotenv
SUPERMEMORY_API_KEY=your_api_key
SUPERMEMORY_BASE_URL=https://api.supermemory.ai
SUPERMEMORY_CONTAINER_TAG=hermes-work
```

The container tag is required by save, forget, and profile operations unless supplied as a tool argument or configured with `SUPERMEMORY_CONTAINER_TAG`. Search can be used without a tag.

## Run locally

```sh
npm ci
npm run build
npm start
```

For development with TypeScript source:

```sh
npm run dev
```

### Configure an MCP client (stdio)

Point your MCP client to this project and start the server with `node dist/index.js`. The following is a generic JSON example; adapt it to your client's MCP configuration format:

```json
{
  "mcpServers": {
    "supermemory": {
      "command": "node",
      "args": ["/absolute/path/to/SuperMemoryMCP/dist/index.js"],
      "env": {
        "SUPERMEMORY_API_KEY": "your_api_key",
        "SUPERMEMORY_BASE_URL": "https://api.supermemory.ai",
        "SUPERMEMORY_CONTAINER_TAG": "hermes-work"
      }
    }
  }
}
```

Prefer your MCP client's secret or environment-variable mechanism over putting credentials directly in a shared configuration file.

## Run with Streamable HTTP

Set `MCP_TRANSPORT=http` to enable the HTTP transport. The `/mcp` endpoint serves MCP requests, and `/healthz` provides a simple health check.

```sh
MCP_TRANSPORT=http \
MCP_HOST=127.0.0.1 \
MCP_PORT=4589 \
SUPERMEMORY_API_KEY=your_api_key \
SUPERMEMORY_BASE_URL=https://api.supermemory.ai \
SUPERMEMORY_CONTAINER_TAG=hermes-work \
npm start
```

The MCP endpoint is `http://127.0.0.1:4589/mcp`. For remote deployment, bind to an address reachable by the client and protect the endpoint with suitable network controls or an authenticated proxy. The server's HTTP transport does not add its own authentication layer.

## Run with `npx` from GitHub Packages

The package is published as `@imrasalghul/supermemory-mcp-server` to GitHub Packages. GitHub Packages requires a GitHub personal access token (classic) with `read:packages` to install packages, including public packages. Store it in your user-level `~/.npmrc` rather than the repository:

```ini
@imrasalghul:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=${GITHUB_PACKAGES_TOKEN}
```

Set `GITHUB_PACKAGES_TOKEN` in your shell or secret manager to that token. Then configure the server in Codex's `config.toml`:

```toml
[mcp_servers.supermemory]
command = "npx"
args = [
  "--yes",
  "--package",
  "@imrasalghul/supermemory-mcp-server@latest",
  "supermemory-mcp-server",
]
env = {
  SUPERMEMORY_API_KEY = "YOUR_API_KEY",
  SUPERMEMORY_BASE_URL = "https://api.supermemory.ai",
  SUPERMEMORY_CONTAINER_TAG = "hermes-work",
}
env_vars = ["GITHUB_PACKAGES_TOKEN"]
```

Replace `YOUR_API_KEY` with your Supermemory API key. The package runs directly through `npx`; no Docker image is built or run locally. GitHub Packages authentication details are documented in the [GitHub npm registry guide](https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-npm-registry#authenticating-with-a-personal-access-token).

The publishing workflow runs when a `v*` release tag is pushed, builds the package, sets its version from that tag, and publishes it to GitHub Packages using the repository's `GITHUB_TOKEN`. For example, pushing `v1.0.1` publishes version `1.0.1`.

## Tools

The server exposes only these four tools:

| Tool | Alias | Description |
| --- | --- | --- |
| `supermemory-save` | `supermemory_store` | Store an explicit memory, optionally with metadata, static status, or expiration. |
| `supermemory-search` | `supermemory_search` | Search memories by semantic similarity. |
| `supermemory-forget` | `supermemory_forget` | Forget by exact memory ID or content, or identify matches with a query. Query mode supports `dryRun` previews. |
| `supermemory-profile` | `supermemory_profile` | Retrieve a persistent profile and optionally include query-matched recent context. |

## License

No license is currently specified. Check with the repository owner before redistributing or using this project under an assumed open-source license.
