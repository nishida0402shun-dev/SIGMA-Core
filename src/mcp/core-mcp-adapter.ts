/**
 * Model Context Protocol (MCP) Adapter for SIGMA Core (FR-011, 9.3).
 * Exposes search, page retrieval, provenance tracking, and safe mutations
 * over standard MCP tool definitions via the shared CoreService layer.
 */

import type { CoreService } from "../services/core-service.ts";
import type { AuthContext } from "../services/auth-service.ts";

export interface McpToolCallRequest {
  name: string;
  arguments: Record<string, unknown>;
}

export interface McpToolCallResponse {
  isError?: boolean;
  content: Array<{ type: "text"; text: string }>;
}

export class CoreMcpAdapter {
  readonly #coreService: CoreService;

  constructor(coreService: CoreService) {
    this.#coreService = coreService;
  }

  /**
   * Dispatches MCP tool calls to the shared CoreService layer.
   * Enforces validation, authorization, and fail-closed error handling.
   */
  async handleToolCall(auth: AuthContext, request: McpToolCallRequest): Promise<McpToolCallResponse> {
    try {
      switch (request.name) {
        case "core_search": {
          const workspaceId = String(request.arguments.workspaceId || "");
          const query = String(request.arguments.query || "");
          const limit = Number(request.arguments.limit || 10);
          if (!workspaceId || !query) {
            return this.#error("workspaceId and query are required");
          }
          const hits = this.#coreService.search(auth, { scopeId: workspaceId, query, limit });
          return this.#json(hits);
        }

        case "core_list_sources": {
          const workspaceId = String(request.arguments.workspaceId || "");
          if (!workspaceId) return this.#error("workspaceId is required");
          const sources = this.#coreService.listObjects(auth, workspaceId);
          return this.#json(sources);
        }

        case "core_get_source": {
          const objectId = String(request.arguments.objectId || "");
          if (!objectId) return this.#error("objectId is required");
          const source = this.#coreService.getObject(auth, objectId);
          if (!source) return this.#error("Source object not found or deleted");
          return this.#json(source);
        }

        case "core_get_page": {
          const objectId = String(request.arguments.objectId || "");
          const pageNumber = Number(request.arguments.pageNumber || 1);
          if (!objectId) return this.#error("objectId is required");
          const page = this.#coreService.getPage(auth, objectId, pageNumber);
          if (!page) return this.#error("Page not found or object deleted");
          return this.#json(page);
        }

        case "core_delete_source": {
          const objectId = String(request.arguments.objectId || "");
          if (!objectId) return this.#error("objectId is required");
          const success = this.#coreService.deleteObject(auth, objectId);
          return this.#json({ success });
        }

        case "core_restore_source": {
          const objectId = String(request.arguments.objectId || "");
          if (!objectId) return this.#error("objectId is required");
          const success = this.#coreService.restoreObject(auth, objectId);
          return this.#json({ success });
        }

        case "core_list_quarantine": {
          const items = this.#coreService.listQuarantined(auth);
          return this.#json(items);
        }

        case "core_recover_quarantine": {
          const quarantineId = String(request.arguments.quarantineId || "");
          if (!quarantineId) return this.#error("quarantineId is required");
          const success = await this.#coreService.recoverQuarantinedItem(auth, quarantineId);
          return this.#json({ success });
        }

        default:
          return this.#error(`Unknown MCP tool: ${request.name}`);
      }
    } catch (err: any) {
      return this.#error(err?.message || String(err));
    }
  }

  #json(data: unknown): McpToolCallResponse {
    return {
      content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
    };
  }

  #error(message: string): McpToolCallResponse {
    return {
      isError: true,
      content: [{ type: "text", text: `ERROR: ${message}` }],
    };
  }
}
