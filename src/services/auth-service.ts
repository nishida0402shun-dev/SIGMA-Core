/**
 * Shared Authorization Service for SIGMA Core.
 * Enforces fail-closed security and permission policies across UI, API, and MCP access points.
 */

import type { CoreRepository } from "../persistence/core-repository.ts";
import type { Permission } from "../models/types.ts";

export interface AuthContext {
  subjectId: string;
  isSuperAdmin?: boolean;
}

export class AuthService {
  readonly #repository: CoreRepository;

  constructor(repository: CoreRepository) {
    this.#repository = repository;
  }

  /**
   * Asserts whether a subject has permission on a given scope.
   * Throws an Error with a machine-readable message if authorization fails.
   */
  assertPermission(
    auth: AuthContext | undefined,
    scopeId: string,
    permission: Permission,
    nowUtc = new Date().toISOString(),
  ): void {
    if (!auth || !auth.subjectId) {
      throw new Error(`AUTHENTICATION_REQUIRED: Missing authentication context for scope ${scopeId}`);
    }

    if (auth.isSuperAdmin) {
      return;
    }

    const allowed = this.#repository.hasPermission(auth.subjectId, scopeId, permission, nowUtc);
    if (!allowed) {
      throw new Error(
        `PERMISSION_DENIED: Subject ${auth.subjectId} lacks permission '${permission}' on scope '${scopeId}'`,
      );
    }
  }

  /**
   * Safe check returning boolean without throwing.
   */
  hasPermission(
    auth: AuthContext | undefined,
    scopeId: string,
    permission: Permission,
    nowUtc = new Date().toISOString(),
  ): boolean {
    try {
      this.assertPermission(auth, scopeId, permission, nowUtc);
      return true;
    } catch {
      return false;
    }
  }
}
