import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";

describe("MCP stdio subprocess", () => {
  it("starts the real entrypoint and completes MCP initialization over stdin/stdout", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "sigma-core-mcp-stdio-"));
    const databasePath = join(tempDir, "core.sqlite");
    const blobDirectory = join(tempDir, "blobs");
    const entrypoint = resolve(process.cwd(), "src/mcp/stdio-entry.ts");
    const env = Object.fromEntries(
      Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined),
    );

    let client: Client | undefined;
    let transport: StdioClientTransport | undefined;

    try {
      transport = new StdioClientTransport({
        command: process.execPath,
        args: ["--experimental-strip-types", entrypoint],
        env: {
          ...env,
          SIGMA_CORE_DB_PATH: databasePath,
          SIGMA_CORE_BLOB_DIR: blobDirectory,
          SIGMA_CORE_SUBJECT_ID: "stdio-integration-test",
        },
      });
      client = new Client({ name: "sigma-core-stdio-test", version: "1.0.0" });

      await client.connect(transport);
      const result = await client.listTools();

      assert.ok(result.tools.some((tool) => tool.name === "core_search"));
      assert.ok(result.tools.some((tool) => tool.name === "core_list_quarantine"));
      assert.ok(result.tools.some((tool) => tool.name === "core_recover_quarantine"));

      // Exercise real tool dispatch, not only MCP initialization/tool discovery.
      // The subprocess subject has no policy in the empty test database, so
      // access to an arbitrary Workspace must fail closed.
      const unauthorizedWorkspace = await client.callTool({
        name: "core_list_sources",
        arguments: { workspaceId: "workspace-not-authorized" },
      });
      assert.equal(unauthorizedWorkspace.isError, true);

      // The published schema rejects invalid arguments before business logic.
      await assert.rejects(
        () => client.callTool({
          name: "core_list_sources",
          arguments: { workspaceId: "" },
        }),
      );
    } finally {
      await client?.close();
      if (!client) await transport?.close();
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
