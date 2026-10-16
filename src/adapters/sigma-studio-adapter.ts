/**
 * SIGMA Studio Adapter for SIGMA Core.
 * Provides a compatibility boundary for migrating knowledge-source operations to SIGMA Core.
 * This is not a drop-in replacement for the current Studio document store; integration requires
 * an explicit migration of callers, persistence ownership, workspace identity, and data lifecycle.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import type { CoreService } from "../services/core-service.ts";
import type { CoreRepository } from "../persistence/core-repository.ts";
import type { AuthContext } from "../services/auth-service.ts";
import type {
  KnowledgeSemanticType,
  SourceObject,
  SourceLocation,
  BoundingBox,
} from "../models/types.ts";

export interface KnowledgePage {
  id: string;
  sourceId: string;
  pageNumber: number;
  semanticType: KnowledgeSemanticType;
  title?: string | undefined;
  text?: string | undefined;
}

export interface KnowledgeSource {
  id: string;
  workspaceId: string;
  name: string;
  originalPath: string;
  storedPath: string;
  mimeType: string;
  sizeBytes: number;
  pageCount: number;
  importedAt: string;
  updatedAt: string;
  contentHash?: string;
  pages: KnowledgePage[];
}

export interface VectorSearchResult {
  id: string;
  workspaceId: string;
  sourceId: string;
  pageNumber: number;
  chunkIndex: number;
  text: string;
  score: number;
}

export interface KnowledgeRegion {
  x: number;
  y: number;
  width: number;
  height: number;
}

export class SigmaStudioAdapter {
  readonly #coreService: CoreService;
  readonly #repository: CoreRepository;
  readonly #auth: AuthContext;

  constructor(coreService: CoreService, repository: CoreRepository, auth: AuthContext) {
    this.#coreService = coreService;
    this.#repository = repository;
    this.#auth = auth;
  }

  /**
   * Requires an explicitly created Workspace. Adapters must not create or select
   * Workspaces implicitly as a side effect of listing or importing data.
   */
  #assertWorkspaceExists(workspaceId: string): void {
    if (!workspaceId?.trim()) {
      throw new Error("WORKSPACE_SELECTION_REQUIRED: Explicit workspace selection is mandatory");
    }
    if (!this.#repository.getWorkspace(workspaceId)) {
      throw new Error(`WORKSPACE_NOT_FOUND: Workspace '${workspaceId}' does not exist; create/select it explicitly before use`);
    }
  }

  /**
   * Lists all active knowledge sources in the workspace.
   */
  async listSources(workspaceId: string): Promise<KnowledgeSource[]> {
    this.#assertWorkspaceExists(workspaceId);
    const objects = this.#coreService.listObjects(this.#auth, workspaceId);

    return objects.map((obj) => this.#toKnowledgeSource(obj));
  }

  /**
   * Adds files into the canonical repository with SHA-256 deduplication and page indexing.
   */
  async addFiles(
    workspaceId: string,
    files: Array<{ name: string; bytes: Uint8Array; originalPath?: string; pages?: Array<{ pageNumber: number; text?: string | undefined; title?: string | undefined }> }>,
  ): Promise<KnowledgeSource[]> {
    this.#assertWorkspaceExists(workspaceId);
    const results: KnowledgeSource[] = [];

    for (const file of files) {
      const mimeType = file.name.endsWith(".pdf") ? "application/pdf" : "application/octet-stream";
      const registered = await this.#coreService.registerObject(this.#auth, {
        workspaceId,
        name: file.name,
        bytes: file.bytes,
        mimeType,
        ...(file.originalPath === undefined ? {} : { originalPath: file.originalPath }),
        ...(file.pages === undefined ? {} : { pages: file.pages.map((p) => ({
          pageNumber: p.pageNumber,
          ...(p.text === undefined ? {} : { textContent: p.text }),
          semanticType: "unknown",
          ...(p.title === undefined ? {} : { title: p.title }),
        })) }),
      });

      results.push(this.#toKnowledgeSource(registered));
    }

    return results;
  }

  /**
   * Searches the canonical FTS5 index and returns results in SIGMA Studio's format.
   * Enforces fail-closed logic: logical deleted files never appear in search results.
   */
  async search(
    workspaceId: string,
    query: string,
    limit = 12,
  ): Promise<Array<VectorSearchResult & { sourceName: string }>> {
    this.#assertWorkspaceExists(workspaceId);
    const hits = this.#coreService.search(this.#auth, {
      scopeId: workspaceId,
      query,
      limit,
    });

    return hits.map((hit, idx) => ({
      id: hit.locationId,
      workspaceId,
      sourceId: hit.objectId,
      pageNumber: hit.pageNumber,
      chunkIndex: idx,
      text: hit.textSnippet,
      score: hit.score,
      sourceName: hit.sourceName,
    }));
  }

  /**
   * Retrieves a single page and its parent source with access checks.
   */
  async getPage(
    workspaceId: string,
    sourceId: string,
    pageNumber: number,
  ): Promise<{ source: KnowledgeSource; page: KnowledgePage }> {
    const res = this.#coreService.getPage(this.#auth, sourceId, pageNumber);
    if (!res || res.object.scopeId !== workspaceId) {
      throw new Error("knowledge page not found");
    }

    const source = this.#toKnowledgeSource(res.object);
    const page: KnowledgePage = {
      id: res.location.locationId,
      sourceId: res.object.objectId,
      pageNumber: res.location.pageNumber,
      semanticType: res.location.semanticType,
      title: res.location.title,
      text: res.location.textContent,
    };

    return { source, page };
  }

  /**
   * Logically deletes a source. It immediately disappears from search and API retrievals.
   */
  async deleteSource(workspaceId: string, sourceId: string): Promise<boolean> {
    const obj = this.#repository.getSourceObject(sourceId);
    if (!obj || obj.scopeId !== workspaceId) return false;
    return this.#coreService.deleteObject(this.#auth, sourceId);
  }

  /**
   * Restores a deleted source within the 7-day retention period.
   */
  async restoreSource(workspaceId: string, sourceId: string): Promise<boolean> {
    const obj = this.#repository.getSourceObject(sourceId);
    if (!obj || obj.scopeId !== workspaceId) return false;
    return this.#coreService.restoreObject(this.#auth, sourceId);
  }

  /**
   * Updates page semantic type (e.g. problem, explanation, theorem).
   */
  async updatePageSemanticType(
    workspaceId: string,
    sourceId: string,
    pageNumber: number,
    semanticType: KnowledgeSemanticType,
    title?: string,
  ): Promise<KnowledgeSource> {
    const res = await this.getPage(workspaceId, sourceId, pageNumber);
    // Reading a page does not imply permission to mutate its metadata.
    // Enforce write authorization before touching the repository directly.
    if (!this.#auth.isSuperAdmin && !this.#repository.hasPermission(this.#auth.subjectId, workspaceId, "write", new Date().toISOString())) {
      throw new Error(`PERMISSION_DENIED: Subject ${this.#auth.subjectId} lacks permission 'write' on scope '${workspaceId}'`);
    }
    this.#repository.updateLocationSemanticType(res.page.id, semanticType, title);
    const updatedObj = this.#repository.getSourceObject(sourceId)!;
    return this.#toKnowledgeSource(updatedObj);
  }

  #toKnowledgeSource(obj: SourceObject): KnowledgeSource {
    const locs = this.#repository.getSourceLocations(obj.objectId);
    const pages: KnowledgePage[] = locs.map((loc) => ({
      id: loc.locationId,
      sourceId: obj.objectId,
      pageNumber: loc.pageNumber,
      semanticType: loc.semanticType,
      title: loc.title,
      text: loc.textContent,
    }));

    return {
      id: obj.objectId,
      workspaceId: obj.scopeId,
      name: obj.metadata.name,
      originalPath: obj.metadata.originalPath ?? "",
      storedPath: `blob://${obj.objectId}`,
      mimeType: obj.metadata.mimeType,
      sizeBytes: obj.metadata.sizeBytes,
      pageCount: obj.metadata.pageCount ?? pages.length,
      importedAt: obj.createdAt,
      updatedAt: obj.updatedAt,
      contentHash: obj.contentHash,
      pages,
    };
  }
}
