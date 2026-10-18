import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { AuthService } from "../src/services/auth-service.ts";
import type { CoreRepository } from "../src/persistence/core-repository.ts";

describe("AuthService fail-closed context validation", () => {
  const calls: Array<{ subjectId: string; scopeId: string; permission: string }> = [];
  const repository = {
    hasPermission(subjectId: string, scopeId: string, permission: "read" | "write" | "delete" | "restore" | "admin") {
      calls.push({ subjectId, scopeId, permission });
      return true;
    },
  } as unknown as CoreRepository;
  const auth = new AuthService(repository);

  it("rejects a missing context", () => {
    assert.throws(() => auth.assertPermission(undefined, "workspace-1", "read"), /AUTHENTICATION_REQUIRED/);
  });

  it("rejects whitespace-only subject and scope identifiers", () => {
    assert.throws(() => auth.assertPermission({ subjectId: "   " }, "workspace-1", "read"), /AUTHENTICATION_REQUIRED/);
    assert.throws(() => auth.assertPermission({ subjectId: "user-1" }, "  ", "read"), /SCOPE_ID_REQUIRED/);
  });

  it("does not treat a truthy non-boolean super-admin value as a bypass", () => {
    assert.throws(
      () => auth.assertPermission({ subjectId: "user-1", isSuperAdmin: "true" as unknown as boolean }, "workspace-1", "read"),
      /PERMISSION_DENIED/,
    );
    assert.deepEqual(calls.at(-1), {
      subjectId: "user-1",
      scopeId: "workspace-1",
      permission: "read",
    });
  });

  it("does not query permissions when the scope is empty", () => {
    const before = calls.length;
    assert.equal(auth.hasPermission({ subjectId: "user-1", isSuperAdmin: true }, "", "read"), false);
    assert.equal(calls.length, before);
  });
});
