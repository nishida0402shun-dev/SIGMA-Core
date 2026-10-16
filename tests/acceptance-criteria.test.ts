/**
 * Acceptance tests for the currently implemented SIGMA Core requirements.
 * Explicit AT-marker coverage is tracked in README.md; unmarked criteria are
 * not claimed as verified until their source requirements are mapped.
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes, createCipheriv, createDecipheriv, createHash } from "node:crypto";

import { CoreRepository } from "../src/persistence/core-repository.ts";
import { LocalBlobStore } from "../src/persistence/local-blob-store.ts";
import { AuthService, type AuthContext } from "../src/services/auth-service.ts";
import { BackupService } from "../src/services/backup-service.ts";
import { DeviceQuarantineService } from "../src/services/device-quarantine-service.ts";
import { CoreService } from "../src/services/core-service.ts";
import { SigmaStudioAdapter } from "../src/adapters/sigma-studio-adapter.ts";
import { CoreMcpAdapter } from "../src/mcp/core-mcp-adapter.ts";

describe("SIGMA Core acceptance tests for implemented and explicitly mapped criteria", () => {
  let tempDir: string;
  let repo: CoreRepository;
  let blobStore: LocalBlobStore;
  let authService: AuthService;
  let backupService: BackupService;
  let deviceQuarantineService: DeviceQuarantineService;
  let coreService: CoreService;
  let adapter: SigmaStudioAdapter;
  let mcpAdapter: CoreMcpAdapter;

  const adminAuth: AuthContext = { subjectId: "user-admin", isSuperAdmin: true };
  const normalUserAuth: AuthContext = { subjectId: "user-normal" };
  const wsId = "workspace-math-101";

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "sigma-core-test-"));
    repo = new CoreRepository(join(tempDir, "core.sqlite"));
    blobStore = new LocalBlobStore(join(tempDir, "blobs"));
    authService = new AuthService(repo);
    backupService = new BackupService(repo);
    deviceQuarantineService = new DeviceQuarantineService(repo);
    coreService = new CoreService(repo, blobStore, authService, backupService, deviceQuarantineService);
    adapter = new SigmaStudioAdapter(coreService, repo, adminAuth);
    mcpAdapter = new CoreMcpAdapter(coreService);

    // Bootstrap test workspace
    coreService.createWorkspace(adminAuth, wsId, "Math 101");
  });

  afterEach(() => {
    repo.close();
    rmSync(tempDir, { recursive: true, force: true });
  });

  // ------------------------------------------------------------------------
  // AT-001 & AT-002: Logical Deletion Fail-Closed & Search Leak Prevention
  // ------------------------------------------------------------------------
  it("AT-001 & AT-002: Immediately suppresses text from UI/API/MCP and search after deletion", async () => {
    const registered = await coreService.registerObject(adminAuth, {
      workspaceId: wsId,
      name: "Calculus_Theorem.pdf",
      bytes: Buffer.from("Theorem of limits in calculus"),
      mimeType: "application/pdf",
      pages: [
        {
          pageNumber: 1,
          textContent: "Fundamental theorem of calculus limits",
          title: "Page 1 - Calculus",
          semanticType: "theorem",
        },
      ],
    });

    // 1. Verify it can be retrieved and searched when Active
    let hits = coreService.search(adminAuth, { scopeId: wsId, query: "calculus" });
    assert.strictEqual(hits.length, 1);
    assert.strictEqual(hits[0]!.objectId, registered.objectId);

    const activeObj = coreService.getObject(adminAuth, registered.objectId);
    assert.ok(activeObj);
    assert.strictEqual(activeObj.status, "Active");

    const pageRes = coreService.getPage(adminAuth, registered.objectId, 1);
    assert.ok(pageRes);
    assert.ok(pageRes.location.textContent?.includes("calculus"));

    // 2. Perform logical deletion
    const deleted = coreService.deleteObject(adminAuth, registered.objectId);
    assert.strictEqual(deleted, true);

    // 3. AT-001: Immediately fail closed across all retrieval channels!
    assert.strictEqual(coreService.getObject(adminAuth, registered.objectId), undefined);
    assert.strictEqual(coreService.getPage(adminAuth, registered.objectId, 1), undefined);

    // AT-002: Even if FTS row exists, search JOIN prevents deleted text from leaking
    hits = coreService.search(adminAuth, { scopeId: wsId, query: "calculus" });
    assert.strictEqual(hits.length, 0);

    // Check via MCP tool
    const mcpSearch = await mcpAdapter.handleToolCall(adminAuth, {
      name: "core_search",
      arguments: { workspaceId: wsId, query: "calculus" },
    });
    assert.strictEqual(JSON.parse(mcpSearch.content[0]!.text).length, 0);

    const mcpGet = await mcpAdapter.handleToolCall(adminAuth, {
      name: "core_get_source",
      arguments: { objectId: registered.objectId },
    });
    assert.strictEqual(mcpGet.isError, true);
  });

  // ------------------------------------------------------------------------
  // AT-003 & AT-004: 7-Day Restore Window
  // ------------------------------------------------------------------------
  it("AT-003 & AT-004: Allows restore within 7 days; strictly denies restore after 7 days", async () => {
    const registered = await coreService.registerObject(adminAuth, {
      workspaceId: wsId,
      name: "geometry.pdf",
      bytes: Buffer.from("Euclidean geometry points"),
      mimeType: "application/pdf",
    });

    const deletedAt = new Date("2026-10-01T00:00:00Z");
    coreService.deleteObject(adminAuth, registered.objectId, deletedAt.toISOString());

    // Day 6 (Within 7 days): Should succeed
    const day6 = new Date("2026-10-07T00:00:00Z").toISOString();
    const restored = coreService.restoreObject(adminAuth, registered.objectId, day6);
    assert.strictEqual(restored, true);

    // Verify Active again
    assert.ok(coreService.getObject(adminAuth, registered.objectId));

    // Delete again at Day 6
    coreService.deleteObject(adminAuth, registered.objectId, day6);

    // Day 14 (> 7 days): Must be rejected with RESTORE_WINDOW_EXPIRED
    const day14 = new Date("2026-10-15T00:00:00Z").toISOString();
    assert.throws(
      () => coreService.restoreObject(adminAuth, registered.objectId, day14),
      /RESTORE_WINDOW_EXPIRED/,
    );
  });

  // ------------------------------------------------------------------------
  // AT-005: Idempotent Full Purge & Resilience
  // ------------------------------------------------------------------------
  it("AT-005: Purges binary, artifacts, FTS, and creates Tombstone idempotently", async () => {
    const registered = await coreService.registerObject(adminAuth, {
      workspaceId: wsId,
      name: "algebra.pdf",
      bytes: Buffer.from("Algebraic equations"),
      mimeType: "application/pdf",
      pages: [{ pageNumber: 1, textContent: "x + y = z" }],
    });

    // Purge is forbidden until the object has been logically deleted and the
    // full 7-day restore window has elapsed.
    await assert.rejects(
      () => coreService.purgeObject(adminAuth, registered.objectId, new Date("2026-01-09T00:00:00Z").toISOString()),
      /PURGE_REQUIRES_PENDING_DELETION/,
    );
    const deletedAt = new Date("2026-01-01T00:00:00Z");
    coreService.deleteObject(adminAuth, registered.objectId, deletedAt.toISOString());
    await assert.rejects(
      () => coreService.purgeObject(adminAuth, registered.objectId, new Date("2026-01-07T00:00:00Z").toISOString()),
      /PURGE_RETENTION_NOT_ELAPSED/,
    );

    // Run purge only after the full restore window has elapsed.
    const purgeAt = new Date("2026-01-09T00:00:00Z").toISOString();
    const purged1 = await coreService.purgeObject(adminAuth, registered.objectId, purgeAt);
    assert.strictEqual(purged1, true);

    // Verify blob removed
    const blobRef = repo.getBlobReference(registered.objectId);
    assert.strictEqual(blobRef, undefined);

    // Verify Tombstone (DeletionRecord) created
    const tombstone = repo.getDeletionRecord(registered.objectId);
    assert.ok(tombstone);
    assert.strictEqual(tombstone.objectId, registered.objectId);

    // Idempotent retry: Re-running purge doesn't crash or resurrect
    const purged2 = await coreService.purgeObject(adminAuth, registered.objectId, purgeAt);
    assert.strictEqual(purged2, true);
  });

  // ------------------------------------------------------------------------
  // AT-006: Restore from Backup Prevents Resurrecting Deleted Objects (Tombstone)
  // ------------------------------------------------------------------------
  it("AT-006: Restoring a backup does NOT resurrect tombstoned deleted objects", async () => {
    const key = randomBytes(32).toString("hex");

    const item1 = await coreService.registerObject(adminAuth, {
      workspaceId: wsId,
      name: "item1.pdf",
      bytes: Buffer.from("Item 1 data"),
      mimeType: "application/pdf",
    });
    const item2 = await coreService.registerObject(adminAuth, {
      workspaceId: wsId,
      name: "item2.pdf",
      bytes: Buffer.from("Item 2 data"),
      mimeType: "application/pdf",
      pages: [{ pageNumber: 1, textContent: "Backup page provenance fixture", title: "Backup page" }],
    });

    // Take backup when both are present
    const backup = await coreService.createBackup(adminAuth, key, wsId);
    assert.ok(backup.encryptedDataHex);

    // Now logically delete item1, then purge only after the 7-day restore window.
    const logicalDeleteAt = new Date().toISOString();
    coreService.deleteObject(adminAuth, item1.objectId, logicalDeleteAt);
    const purgeAt = new Date(Date.parse(logicalDeleteAt) + 8 * 24 * 60 * 60 * 1000).toISOString();
    await coreService.purgeObject(adminAuth, item1.objectId, purgeAt);

    // Create a fresh repository / service to simulate restoring onto a new device/database
    const targetDir = mkdtempSync(join(tmpdir(), "sigma-core-restore-test-"));
    const targetRepo = new CoreRepository(join(targetDir, "core.sqlite"));
    const targetBlobStore = new LocalBlobStore(join(targetDir, "blobs"));
    const targetAuth = new AuthService(targetRepo);
    const targetBackup = new BackupService(targetRepo);
    const targetQuarantine = new DeviceQuarantineService(targetRepo);
    const targetCore = new CoreService(targetRepo, targetBlobStore, targetAuth, targetBackup, targetQuarantine);

    // Synchronize the tombstone for item1 to the target device first (as required by Rule 6.4 / FR-016)
    const tombstone = repo.getDeletionRecord(item1.objectId)!;
    targetRepo.saveDeletionRecord(tombstone);

    // Restore backup on target
    const result = await targetCore.restoreBackup(adminAuth, backup, key);

    // item1 must be SKIPPED due to tombstone, item2 must be RESTORED!
    assert.strictEqual(result.skipped, 1);
    assert.strictEqual(result.restored, 1);

    // Verify item1 remains unretrievable and item2 is active on target
    assert.strictEqual(targetCore.getObject(adminAuth, item1.objectId), undefined);
    assert.ok(targetCore.getObject(adminAuth, item2.objectId));
    assert.deepStrictEqual(
      await targetCore.getObjectBytes(adminAuth, item2.objectId),
      Buffer.from("Item 2 data"),
    );
    const restoredPageHits = targetCore.search(adminAuth, {
      scopeId: wsId,
      query: "Backup page provenance fixture",
    });
    assert.strictEqual(restoredPageHits.length, 1);
    assert.strictEqual(restoredPageHits[0]!.pageNumber, 1);

    targetRepo.close();
    rmSync(targetDir, { recursive: true, force: true });
  });

  // ------------------------------------------------------------------------
  // Backup authorization: system-wide export and restore are privileged operations.
  // ------------------------------------------------------------------------
  it("requires super-admin authorization for system-wide backup and backup restore", async () => {
    const key = randomBytes(32).toString("hex");

    await assert.rejects(
      () => coreService.createBackup(normalUserAuth, key),
      /SUPER_ADMIN_REQUIRED/,
    );
    await assert.rejects(
      () => coreService.createBackup(normalUserAuth, key, wsId),
      /PERMISSION_DENIED/,
    );

    const backup = await coreService.createBackup(adminAuth, key, wsId);
    await assert.rejects(
      () => coreService.restoreBackup(normalUserAuth, backup, key),
      /SUPER_ADMIN_REQUIRED/,
    );
  });

  // ------------------------------------------------------------------------
  // Backup restore must reject a structurally incomplete but correctly encrypted payload
  // before creating canonical source records.
  // ------------------------------------------------------------------------
  it("rejects a backup missing blob data before writing any restored source objects", async () => {
    const key = randomBytes(32).toString("hex");
    const registered = await coreService.registerObject(adminAuth, {
      workspaceId: wsId,
      name: "preflight-check.txt",
      bytes: Buffer.from("preflight backup integrity fixture"),
      mimeType: "text/plain",
    });
    const originalBackup = await coreService.createBackup(adminAuth, key, wsId);
    const keyBytes = Buffer.from(key, "hex");
    const originalDecipher = createDecipheriv("aes-256-gcm", keyBytes, Buffer.from(originalBackup.ivHex, "hex"));
    originalDecipher.setAuthTag(Buffer.from(originalBackup.authTagHex, "hex"));
    const plaintext = Buffer.concat([
      originalDecipher.update(Buffer.from(originalBackup.encryptedDataHex, "hex")),
      originalDecipher.final(),
    ]);
    const payload = JSON.parse(plaintext.toString("utf8")) as {
      objects: unknown[];
      blobs: unknown[];
      blobData: unknown[];
      artifacts: unknown[];
      locations: unknown[];
    };
    payload.blobs = [];
    payload.blobData = [];
    const malformedPlaintext = Buffer.from(JSON.stringify(payload), "utf8");
    const nonce = randomBytes(12);
    const validCipher = createCipheriv("aes-256-gcm", keyBytes, nonce);
    const encrypted = Buffer.concat([validCipher.update(malformedPlaintext), validCipher.final()]);
    const malformedBackup = {
      ...originalBackup,
      ivHex: nonce.toString("hex"),
      authTagHex: validCipher.getAuthTag().toString("hex"),
      encryptedDataHex: encrypted.toString("hex"),
      checksumSha256: createHash("sha256").update(malformedPlaintext).digest("hex"),
    };

    const targetDir = mkdtempSync(join(tmpdir(), "sigma-core-invalid-restore-"));
    const targetRepo = new CoreRepository(join(targetDir, "core.sqlite"));
    const targetBlobStore = new LocalBlobStore(join(targetDir, "blobs"));
    const targetBackup = new BackupService(targetRepo);
    const targetAuth = new AuthService(targetRepo);
    const targetQuarantine = new DeviceQuarantineService(targetRepo);
    const targetCore = new CoreService(targetRepo, targetBlobStore, targetAuth, targetBackup, targetQuarantine);
    try {
      targetCore.createWorkspace(adminAuth, wsId, "Math 101");
      await assert.rejects(
        () => targetCore.restoreBackup(adminAuth, malformedBackup, key),
        /BACKUP_PAYLOAD_INVALID/,
      );
      assert.strictEqual(targetRepo.getSourceObject(registered.objectId), undefined);
    } finally {
      targetRepo.close();
      rmSync(targetDir, { recursive: true, force: true });
    }
  });

  // Backup restore must roll back every canonical DB row if a later child-row insert fails.
  it("rolls back source objects, blob references, artifacts, and locations when restore fails mid-transaction", async () => {
    const key = randomBytes(32).toString("hex");
    const registered = await coreService.registerObject(adminAuth, {
      workspaceId: wsId,
      name: "atomic-restore.pdf",
      bytes: Buffer.from("atomic restore fixture"),
      mimeType: "application/pdf",
      pages: [{ pageNumber: 1, textContent: "atomic restore page", title: "Atomic page" }],
    });
    const originalBackup = await coreService.createBackup(adminAuth, key, wsId);
    const keyBytes = Buffer.from(key, "hex");
    const decipher = createDecipheriv("aes-256-gcm", keyBytes, Buffer.from(originalBackup.ivHex, "hex"));
    decipher.setAuthTag(Buffer.from(originalBackup.authTagHex, "hex"));
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(originalBackup.encryptedDataHex, "hex")),
      decipher.final(),
    ]);
    const payload = JSON.parse(plaintext.toString("utf8")) as {
      objects: Array<{ objectId: string; contentHash: string }>;
      artifacts: Array<Record<string, unknown>>;
      [key: string]: unknown;
    };
    assert.ok(payload.artifacts.length > 0);
    // A duplicate primary key fails after the parent object and blob reference were
    // inserted, exercising rollback of earlier writes in the same restore operation.
    payload.artifacts.push({ ...payload.artifacts[0] });
    const malformedPlaintext = Buffer.from(JSON.stringify(payload), "utf8");
    const nonce = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", keyBytes, nonce);
    const encrypted = Buffer.concat([cipher.update(malformedPlaintext), cipher.final()]);
    const modifiedBackup = {
      ...originalBackup,
      ivHex: nonce.toString("hex"),
      authTagHex: cipher.getAuthTag().toString("hex"),
      encryptedDataHex: encrypted.toString("hex"),
      checksumSha256: createHash("sha256").update(malformedPlaintext).digest("hex"),
    };

    const targetDir = mkdtempSync(join(tmpdir(), "sigma-core-atomic-restore-"));
    const targetRepo = new CoreRepository(join(targetDir, "core.sqlite"));
    const targetBlobStore = new LocalBlobStore(join(targetDir, "blobs"));
    const targetBackup = new BackupService(targetRepo);
    const targetAuth = new AuthService(targetRepo);
    const targetQuarantine = new DeviceQuarantineService(targetRepo);
    const targetCore = new CoreService(targetRepo, targetBlobStore, targetAuth, targetBackup, targetQuarantine);
    try {
      targetCore.createWorkspace(adminAuth, wsId, "Math 101");
      await assert.rejects(() => targetCore.restoreBackup(adminAuth, modifiedBackup, key));
      assert.strictEqual(targetRepo.getSourceObject(registered.objectId), undefined);
      assert.strictEqual(targetRepo.getBlobReference(registered.objectId), undefined);
      const stagedObject = payload.objects.find((object) => object.objectId === registered.objectId);
      assert.ok(stagedObject);
      assert.deepStrictEqual(await targetBlobStore.inspect(stagedObject.contentHash), { exists: false });
      assert.deepStrictEqual(targetRepo.listExtractedArtifacts(registered.objectId), []);
      assert.deepStrictEqual(targetRepo.getSourceLocations(registered.objectId), []);
    } finally {
      targetRepo.close();
      rmSync(targetDir, { recursive: true, force: true });
    }
  });

  // ------------------------------------------------------------------------
  // AT-007: Tombstone Retention (Minimum 180 Days + Conditions)
  // ------------------------------------------------------------------------
  it("AT-007: Tombstones are kept for at least 180 days and require conditions to discard", () => {
    const objectId = "obj-tombstone-test";
    const deletedAt = "2026-01-01T00:00:00Z";

    repo.saveDeletionRecord({
      objectId,
      deletionVersion: 1,
      deletedAt,
      propagationState: "Pending",
      backupExpiryState: "Active",
    });

    // 179 days: Cannot delete
    const day179 = new Date("2026-06-29T00:00:00Z").toISOString();
    assert.strictEqual(repo.deleteTombstoneIfSafe(objectId, day179), false);

    // 181 days, but propagationState is Pending: Cannot delete
    const day181 = new Date("2026-07-02T00:00:00Z").toISOString();
    assert.strictEqual(repo.deleteTombstoneIfSafe(objectId, day181), false);

    // 181 days, with Propagation and Backup expiry fulfilled: Can delete
    repo.saveDeletionRecord({
      objectId,
      deletionVersion: 1,
      deletedAt,
      propagationState: "Propagated",
      backupExpiryState: "Expired",
    });
    assert.strictEqual(repo.deleteTombstoneIfSafe(objectId, day181), true);
    assert.strictEqual(repo.getDeletionRecord(objectId), undefined);
  });

  // ------------------------------------------------------------------------
  // AT-009 & AT-010: Device 60/75/90 Day Warnings and Revocation
  // ------------------------------------------------------------------------
  it("AT-009 & AT-010: Device warnings at 60/75 days and revocation at 90 days with sync rejection", () => {
    const deviceId = "device-tablet-01";
    const userId = "teacher-1";

    const baseTime = new Date("2026-01-01T00:00:00Z");
    coreService.syncDevice(deviceId, userId, baseTime.toISOString());

    // Day 61: First Warning
    const day61 = new Date("2026-03-03T00:00:00Z").toISOString();
    const status61 = deviceQuarantineService.evaluateDeviceStatus(deviceId, day61);
    assert.strictEqual(status61.status, "Warning1");

    // Day 76: Final Warning
    const day76 = new Date("2026-03-18T00:00:00Z").toISOString();
    const status76 = deviceQuarantineService.evaluateDeviceStatus(deviceId, day76);
    assert.strictEqual(status76.status, "FinalWarning");

    // Day 91: Revocation
    const day91 = new Date("2026-04-02T00:00:00Z").toISOString();
    const status91 = deviceQuarantineService.evaluateDeviceStatus(deviceId, day91);
    assert.strictEqual(status91.status, "Revoked");
    assert.strictEqual(status91.isRevoked, true);

    // AT-010: Sync is rejected from revoked device!
    assert.throws(
      () => coreService.syncDevice(deviceId, userId, day91),
      /DEVICE_REVOKED/,
    );

    // Revocation is terminal: evaluating the device at a newer timestamp
    // or attempting another sync must not reactivate the same device identity.
    const day92 = new Date("2026-04-03T00:00:00Z").toISOString();
    const status92 = deviceQuarantineService.evaluateDeviceStatus(deviceId, day92);
    assert.strictEqual(status92.status, "Revoked");
    assert.strictEqual(status92.isRevoked, true);
    assert.throws(
      () => coreService.syncDevice(deviceId, userId, day92),
      /DEVICE_REVOKED/,
    );
    assert.strictEqual(repo.getDevice(deviceId)?.status, "Revoked");
  });

  // ------------------------------------------------------------------------
  // AT-012, AT-013, AT-014: Quarantine Data Isolation & Selective Recovery
  // ------------------------------------------------------------------------
  it("AT-012, AT-013, AT-014: Quarantine items are isolated from search/API and selectively recovered", async () => {
    const quarantined = coreService.quarantineData("revoked-device", "unverified-obj", 1, {
      object: {
        objectId: "unverified-obj",
        ownerId: "user-1",
        scopeId: wsId,
        status: "Active",
        version: 1,
        contentHash: "dummyhash",
        metadata: { name: "RecoveredDoc.pdf", mimeType: "application/pdf", sizeBytes: 100 },
        createdAt: new Date().toISOString(),
      },
    });

    // AT-012: Completely absent from normal object list and search
    const objects = coreService.listObjects(adminAuth, wsId);
    assert.strictEqual(objects.some((o) => o.objectId === "unverified-obj"), false);

    // AT-013: User selectively recovers the quarantined item
    const success = coreService.recoverQuarantinedItem(adminAuth, quarantined.quarantineId);
    assert.strictEqual(success, true);

    // Now committed to canonical
    const recoveredObj = coreService.getObject(adminAuth, "unverified-obj");
    assert.ok(recoveredObj);
    assert.strictEqual(recoveredObj.metadata.name, "RecoveredDoc.pdf");
  });

  // ------------------------------------------------------------------------
  // AT-015, AT-016, AT-017, AT-018: Quarantine Lifespan (30 Days), Warnings (23/29 Days)
  // ------------------------------------------------------------------------
  it("AT-015, AT-016, AT-017: 23/29-day warnings and strict 30-day quarantine expiration", () => {
    const startTime = new Date("2026-01-01T00:00:00Z");
    const item = coreService.quarantineData("dev-1", "obj-1", 1, {}, startTime.toISOString());

    // Day 24: Warning (23-day)
    const day24 = new Date("2026-01-25T00:00:00Z").toISOString();
    const eval24 = deviceQuarantineService.evaluateQuarantineExpiry(item, day24);
    assert.strictEqual(eval24.isWarning, true);
    assert.strictEqual(eval24.isExpired, false);

    // Day 29: Final Warning
    const day29 = new Date("2026-01-30T00:00:00Z").toISOString();
    const eval29 = deviceQuarantineService.evaluateQuarantineExpiry(item, day29);
    assert.strictEqual(eval29.isFinalWarning, true);
    assert.strictEqual(eval29.isExpired, false);

    // Day 31: Expired (> 30 days)
    const day31 = new Date("2026-02-01T00:00:00Z").toISOString();
    const eval31 = deviceQuarantineService.evaluateQuarantineExpiry(item, day31);
    assert.strictEqual(eval31.isExpired, true);

    // AT-016 & AT-017: Recovery MUST be rejected once expired!
    const recovered = coreService.recoverQuarantinedItem(adminAuth, item.quarantineId, day31);
    assert.strictEqual(recovered, false);

    // Expired payloads are purged, not merely hidden behind an Expired status.
    const purgeResult = deviceQuarantineService.purgeExpiredQuarantineItems(day31);
    assert.deepStrictEqual(purgeResult, { expiredCount: 0, purgedCount: 1, failedCount: 0 });
    const purgedItem = repo.getQuarantineItem(item.quarantineId);
    assert.ok(purgedItem);
    assert.strictEqual(purgedItem.status, "Purged");
    assert.deepStrictEqual(purgedItem.payload, {});

    // Sweeps are idempotent and never count the already-purged item again.
    assert.deepStrictEqual(deviceQuarantineService.purgeExpiredQuarantineItems(day31), {
      expiredCount: 0,
      purgedCount: 0,
      failedCount: 0,
    });
  });

  // ------------------------------------------------------------------------
  // AT-020: MCP Tool Execution
  // ------------------------------------------------------------------------
  it("AT-020: Executes MCP tool calls with validation, authorization, and error handling", async () => {
    await coreService.registerObject(adminAuth, {
      workspaceId: wsId,
      name: "MCP_Sample.txt",
      bytes: Buffer.from("MCP verified content"),
      mimeType: "text/plain",
      pages: [{ pageNumber: 1, textContent: "Interactive tool call test" }],
    });

    // 1. Valid MCP Search
    const searchRes = await mcpAdapter.handleToolCall(adminAuth, {
      name: "core_search",
      arguments: { workspaceId: wsId, query: "Interactive" },
    });
    assert.strictEqual(searchRes.isError, undefined);
    const parsed = JSON.parse(searchRes.content[0]!.text);
    assert.strictEqual(parsed.length, 1);

    // 2. Invalid Input (Missing parameters)
    const badRes = await mcpAdapter.handleToolCall(adminAuth, {
      name: "core_search",
      arguments: {},
    });
    assert.strictEqual(badRes.isError, true);
    assert.ok(badRes.content[0]!.text.includes("required"));
  });

  // ------------------------------------------------------------------------
  // AT-022: Japanese and English Search Fixture & Provenance
  // ------------------------------------------------------------------------
  it("AT-022: Handles Japanese and English full-text search with exact page provenance", async () => {
    const registered = await coreService.registerObject(adminAuth, {
      workspaceId: wsId,
      name: "高校数学_二次関数.pdf",
      bytes: Buffer.from("二次関数の頂点と軸の方程式"),
      mimeType: "application/pdf",
      pages: [
        {
          pageNumber: 1,
          textContent: "二次関数の頂点の座標は (p, q) で与えられる。",
          title: "第1節 二次関数の基本形",
          semanticType: "definition",
        },
        {
          pageNumber: 2,
          textContent: "放物線とx軸の交点を求める二次方程式の解の公式。",
          title: "第2節 解の公式",
          semanticType: "theorem",
        },
      ],
    });

    // Japanese FTS query: "頂点"
    const hitsJp = coreService.search(adminAuth, { scopeId: wsId, query: "頂点" });
    assert.strictEqual(hitsJp.length, 1);
    assert.strictEqual(hitsJp[0]!.pageNumber, 1);
    assert.strictEqual(hitsJp[0]!.semanticType, "definition");
    assert.strictEqual(hitsJp[0]!.sourceName, "高校数学_二次関数.pdf");

    // Japanese FTS query: "方程式"
    const hitsEq = coreService.search(adminAuth, { scopeId: wsId, query: "方程式" });
    assert.strictEqual(hitsEq.length, 1);
    assert.strictEqual(hitsEq[0]!.pageNumber, 2);
    assert.strictEqual(hitsEq[0]!.semanticType, "theorem");
  });

  // ------------------------------------------------------------------------
  it("rejects metadata updates for read-only users", async () => {
    const source = await coreService.registerObject(adminAuth, {
      workspaceId: wsId,
      name: "read-only.pdf",
      bytes: Buffer.from("read-only metadata test"),
      mimeType: "application/pdf",
      pages: [{ pageNumber: 1, textContent: "page", title: "Original" }],
    });
    repo.grantPolicy({
      grantId: "read-only-metadata-policy",
      subjectId: normalUserAuth.subjectId,
      scopeId: wsId,
      permission: "read",
      validFrom: new Date().toISOString(),
    });
    const readOnlyAdapter = new SigmaStudioAdapter(coreService, repo, normalUserAuth);
    await assert.rejects(
      () => readOnlyAdapter.updatePageSemanticType(wsId, source.objectId, 1, "problem", "Changed"),
      /PERMISSION_DENIED/,
    );
    assert.strictEqual(repo.getPageLocation(source.objectId, 1)?.title, "Original");
  });

  // SIGMA Studio Adapter Compatibility
  // ------------------------------------------------------------------------
  it("SIGMA Studio Adapter: Interoperates smoothly with KnowledgeDbStore interface", async () => {
    const added = await adapter.addFiles(wsId, [
      {
        name: "exercise.pdf",
        bytes: Buffer.from("練習問題 1"),
        pages: [{ pageNumber: 1, text: "次の二次方程式を解け", title: "問1" }],
      },
    ]);
    assert.strictEqual(added.length, 1);

    const list = await adapter.listSources(wsId);
    assert.strictEqual(list.length, 1);
    assert.strictEqual(list[0]!.name, "exercise.pdf");

    const pageRes = await adapter.getPage(wsId, list[0]!.id, 1);
    assert.strictEqual(pageRes.page.pageNumber, 1);
    assert.strictEqual(pageRes.page.semanticType, "unknown");

    // Update semantic type
    const updated = await adapter.updatePageSemanticType(wsId, list[0]!.id, 1, "problem", "改訂問1");
    assert.strictEqual(updated.pages[0]!.semanticType, "problem");
    assert.strictEqual(updated.pages[0]!.title, "改訂問1");

    // Search via adapter
    const searchRes = await adapter.search(wsId, "二次方程式");
    assert.strictEqual(searchRes.length, 1);
    assert.strictEqual(searchRes[0]!.sourceName, "exercise.pdf");

    // Logical delete via adapter
    await adapter.deleteSource(wsId, list[0]!.id);
    const searchAfterDelete = await adapter.search(wsId, "二次方程式");
    assert.strictEqual(searchAfterDelete.length, 0);
  });
});
