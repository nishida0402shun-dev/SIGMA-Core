/**
 * Official MCP SDK transport for SIGMA Core.
 *
 * Authentication is injected by the host bootstrap; this module never grants
 * super-admin privileges or trusts identity supplied by MCP tool arguments.
 */
import { McpServer } from "@modelcontextprotocol/server";
import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";
import * as z from "zod/v4";
import type { CoreService } from "../services/core-service.ts";
import type { AuthContext } from "../services/auth-service.ts";
import { CoreMcpAdapter } from "./core-mcp-adapter.ts";

export type AuthContextProvider = () => AuthContext | Promise<AuthContext>;

export function createCoreMcpServer(
  coreService: CoreService,
  getAuthContext: AuthContextProvider,
): McpServer {
  const server = new McpServer({ name: "sigma-core", version: "0.1.0" });
  const adapter = new CoreMcpAdapter(coreService);

  const register = (
    name: string,
    description: string,
    inputSchema: z.ZodObject<any>,
  ) => {
    server.registerTool(name, { description, inputSchema }, async (args) => {
      const auth = await getAuthContext();
      const response = await adapter.handleToolCall(auth, {
        name,
        arguments: args as Record<string, unknown>,
      });
      // CoreMcpAdapter returns the MCP content/isError wire shape; this cast
      // bridges the SDK's broader tool-result union (which also includes elicitation).
      return response as any;
    });
  };

  register(
    "core_search",
    "Search active source pages in an explicitly selected Workspace.",
    z.object({
      workspaceId: z.string().min(1),
      query: z.string().min(1),
      limit: z.number().int().min(1).max(100).optional(),
    }),
  );
  register(
    "core_list_sources",
    "List active source objects in an explicitly selected Workspace.",
    z.object({ workspaceId: z.string().min(1) }),
  );
  register(
    "core_get_source",
    "Get metadata for an active source object.",
    z.object({ objectId: z.string().min(1) }),
  );
  register(
    "core_get_page",
    "Retrieve a specific page and its provenance from an active source object.",
    z.object({ objectId: z.string().min(1), pageNumber: z.number().int().min(1) }),
  );
  register(
    "core_delete_source",
    "Logically delete a source object; it becomes inaccessible immediately.",
    z.object({ objectId: z.string().min(1) }),
  );
  register(
    "core_restore_source",
    "Restore a logically deleted source object within the permitted restore window.",
    z.object({ objectId: z.string().min(1) }),
  );
  register(
    "core_list_quarantine",
    "List only quarantined records the authenticated caller is authorized to read.",
    z.object({}),
  );
  register(
    "core_recover_quarantine",
    "Recover a quarantined item after authorization, identity, deletion, and expiry checks.",
    z.object({ quarantineId: z.string().min(1) }),
  );

  return server;
}

export async function startCoreMcpStdioServer(
  coreService: CoreService,
  getAuthContext: AuthContextProvider,
): Promise<void> {
  const server = createCoreMcpServer(coreService, getAuthContext);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
