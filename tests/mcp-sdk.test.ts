import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { CoreRepository } from "../src/persistence/core-repository.ts";
import { LocalBlobStore } from "../src/persistence/local-blob-store.ts";
import { AuthService, type AuthContext } from "../src/services/auth-service.ts";
import { BackupService } from "../src/services/backup-service.ts";
import { DeviceQuarantineService } from "../src/services/device-quarantine-service.ts";
import { CoreService } from "../src/services/core-service.ts";
import { createCoreMcpServer } from "../src/mcp/stdio-server.ts";

describe("Official MCP SDK integration", () => {
  it("lists and executes Core tools over MCP protocol transport", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "sigma-core-mcp-test-"));
    const repository = new CoreRepository(join(tempDir, "core.sqlite"));
    const blobStore = new LocalBlobStore(join(tempDir, "blobs"));
    const authService = new AuthService(repository);
    const backupService = new BackupService(repository);
    const quarantineService = new DeviceQuarantineService(repository);
    const coreService = new CoreService(
      repository,
      blobStore,
      authService,
      backupService,
      quarantineService,
    );
    const auth: AuthContext = { subjectId: "mcp-test-admin", isSuperAdmin: true };
    const workspaceId = "mcp-integration-workspace";
    let client: Client | undefined;
    let server: ReturnType<typeof createCoreMcpServer> | undefined;

    try {
      coreService.createWorkspace(auth, workspaceId, "MCP Integration");
      await coreService.registerObject(auth, {
        workspaceId,
        name: "mcp-fixture.txt",
        bytes: Buffer.from("MCP protocol integration fixture"),
        mimeType: "text/plain",
        pages: [{ pageNumber: 1, textContent: "MCP protocol integration fixture" }],
      });

      const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
      server = createCoreMcpServer(coreService, () => auth);
      client = new Client({ name: "sigma-core-integration-test", version: "1.0.0" });
      await server.connect(serverTransport);
      await client.connect(clientTransport);

      const listed = await client.listTools();
      assert.ok(listed.tools.some((tool) => tool.name === "core_search"));

      const result = await client.callTool({
        name: "core_search",
        arguments: { workspaceId, query: "integration fixture" },
      });
      assert.equal(result.isError, undefined);
      const textBlock = result.content.find((block) => block.type === "text");
      assert.ok(textBlock && textBlock.type === "text");
      const hits = JSON.parse(textBlock.text) as Array<{ sourceName: string; pageNumber: number }>;
      assert.equal(hits.length, 1);
      assert.equal(hits[0]!.sourceName, "mcp-fixture.txt");
      assert.equal(hits[0]!.pageNumber, 1);
    } finally {
      await client?.close();
      await server?.close();
      repository.close();
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
