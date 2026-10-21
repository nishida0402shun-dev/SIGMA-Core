import { afterEach, beforeEach, describe, expect, it } from "./test-shim.ts";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { CoreRepository } from "../src/persistence/core-repository.ts";
import { LocalBlobStore } from "../src/persistence/local-blob-store.ts";
import { AuthService, type AuthContext } from "../src/services/auth-service.ts";
import { BackupService } from "../src/services/backup-service.ts";
import { DeviceQuarantineService } from "../src/services/device-quarantine-service.ts";
import { CoreService } from "../src/services/core-service.ts";
import { SigmaStudioAdapter } from "../src/adapters/sigma-studio-adapter.ts";
import { CoreMcpAdapter } from "../src/mcp/core-mcp-adapter.ts";
import { extractSource } from "../src/extraction.ts";
import { makePdf } from "./pdf-fixture.ts";

const adminAuth: AuthContext = { subjectId: "pdf-admin", isSuperAdmin: true };
const normalUserAuth: AuthContext = { subjectId: "pdf-normal-user" };
const workspaceId = "pdf-workspace";

describe("PDF page extraction and provenance", () => {
  let tempDir: string;
  let repo: CoreRepository;
  let coreService: CoreService;
  let adapter: SigmaStudioAdapter;
  let mcpAdapter: CoreMcpAdapter;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "sigma-pdf-test-"));
    repo = new CoreRepository(join(tempDir, "core.sqlite"));
    const blobStore = new LocalBlobStore(join(tempDir, "blobs"));
    const authService = new AuthService(repo);
    const backupService = new BackupService(repo);
    const quarantineService = new DeviceQuarantineService(repo);
    coreService = new CoreService(repo, blobStore, authService, backupService, quarantineService);
    adapter = new SigmaStudioAdapter(coreService, repo, adminAuth);
    mcpAdapter = new CoreMcpAdapter(coreService);
    coreService.createWorkspace(adminAuth, workspaceId, "PDF tests");
  });

  afterEach(() => {
    repo.close();
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("maps extracted text to the correct 1-based PDF page", async () => {
    const bytes = makePdf({ pages: ["First page content", "Second page content"] });
    const extraction = await extractSource(bytes, "two-page.pdf");

    expect(extraction.status).toBe("complete");
    expect(extraction.pageCount).toBe(2);
    expect(extraction.extractorId).toBe("builtin-pdf");
    expect(extraction.pages.length).toBe(2);
    expect(extraction.pages[0]!.pageNumber).toBe(1);
    expect(extraction.pages[0]!.textContent?.includes("First page content")).toBe(true);
    expect(extraction.pages[1]!.pageNumber).toBe(2);
    expect(extraction.pages[1]!.textContent?.includes("Second page content")).toBe(true);
    assert.ok(extraction.pages[0]!.startOffset === 0);
    assert.equal(extraction.pages[0]!.endOffset, extraction.pages[0]!.textContent!.length);
    assert.ok(extraction.pages[0]!.boundingBox);
    assert.ok(extraction.pages[0]!.boundingBox!.width > 0);
    assert.ok(extraction.pages[0]!.boundingBox!.height > 0);
  });

  it("retrieves a requested page range and rejects invalid or out-of-bounds ranges", async () => {
    const registered = await coreService.registerObject(adminAuth, {
      workspaceId,
      name: "range.pdf",
      bytes: makePdf({ pages: ["Page one", "Page two", "Page three"] }),
      mimeType: "application/pdf",
    });

    const range = coreService.getPageRange(adminAuth, registered.objectId, 2, 3);
    expect(range.pages.length).toBe(2);
    expect(range.pages[0]!.pageNumber).toBe(2);
    expect(range.pages[1]!.pageNumber).toBe(3);
    expect(range.pageCount).toBe(3);

    expect(() => coreService.getPageRange(adminAuth, registered.objectId, 3, 2))
      .toThrow("INVALID_PAGE_RANGE");
    expect(() => coreService.getPageRange(adminAuth, registered.objectId, 1, 4))
      .toThrow("PAGE_RANGE_OUT_OF_BOUNDS");
    expect(() => coreService.getPageRange(adminAuth, registered.objectId, 1, 3, 2))
      .toThrow("PAGE_RANGE_TOO_LARGE");
    expect(() => coreService.getPageRange(normalUserAuth, registered.objectId, 1, 2))
      .toThrow("PERMISSION_DENIED");
  });

  it("rejects a range with missing extracted pages instead of silently trimming it", async () => {
    const registered = await coreService.registerObject(adminAuth, {
      workspaceId,
      name: "gapped.pdf",
      bytes: Buffer.from("gapped fixture"),
      mimeType: "application/pdf",
      pages: [
        { pageNumber: 1, textContent: "page one" },
        { pageNumber: 3, textContent: "page three" },
      ],
    });

    expect(() => coreService.getPageRange(adminAuth, registered.objectId, 1, 3))
      .toThrow("PAGE_RANGE_INCOMPLETE");
  });

  it("marks pages without extractable text as partial and records per-page warnings", async () => {
    const registered = await coreService.registerObject(adminAuth, {
      workspaceId,
      name: "blank-middle.pdf",
      bytes: makePdf({ pages: ["Before blank", null, "After blank"] }),
      mimeType: "application/pdf",
    });

    const artifacts = repo.listExtractedArtifacts(registered.objectId);
    expect(artifacts.length).toBe(1);
    expect(artifacts[0]!.status).toBe("partial");
    expect(artifacts[0]!.pageCount).toBe(3);
    assert.ok(artifacts[0]!.warnings.some((warning) => warning.includes("PDF_PAGE_TEXT_UNAVAILABLE")));

    const range = coreService.getPageRange(adminAuth, registered.objectId, 1, 3);
    expect(range.pages.length).toBe(3);
    assert.equal(range.pages[1]!.textContent, undefined);
    assert.ok(repo.getPageLocation(registered.objectId, 2));
  });

  it("distinguishes a scanned PDF from a text PDF and records an OCR-required failure", async () => {
    const registered = await coreService.registerObject(adminAuth, {
      workspaceId,
      name: "scanned.pdf",
      bytes: makePdf({ pages: [null, null] }),
      mimeType: "application/pdf",
    });

    expect(registered.metadata.pageCount).toBe(2);
    expect(repo.getSourceLocations(registered.objectId).length).toBe(0);

    const artifacts = repo.listExtractedArtifacts(registered.objectId);
    expect(artifacts.length).toBe(1);
    expect(artifacts[0]!.status).toBe("failed");
    expect(artifacts[0]!.extractorId).toBe("builtin-pdf");
    expect(artifacts[0]!.pageCount).toBe(2);
    assert.ok(artifacts[0]!.warnings.some((warning) => warning.includes("PDF_TEXT_UNAVAILABLE_OCR_REQUIRED")));

    expect(coreService.search(adminAuth, { scopeId: workspaceId, query: "scanned" }).length).toBe(0);
    expect(() => coreService.getPageRange(adminAuth, registered.objectId, 1, 2))
      .toThrow("PAGE_RANGE_UNAVAILABLE");
  });

  it("extracts Japanese text with the correct page boundaries", async () => {
    const bytes = readFileSync(new URL("./fixtures/japanese-two-pages.pdf", import.meta.url));
    const extraction = await extractSource(bytes, "japanese-two-pages.pdf");
    expect(extraction.status).toBe("complete");
    expect(extraction.pageCount).toBe(2);
    expect(extraction.pages.length).toBe(2);
    assert.ok(extraction.pages[0]!.textContent?.includes("二次関数の最大値と最小値"));
    assert.ok(extraction.pages[0]!.textContent?.includes("第1ページ"));
    assert.ok(!extraction.pages[0]!.textContent?.includes("練習問題"));
    assert.ok(extraction.pages[1]!.textContent?.includes("練習問題"));
    assert.ok(extraction.pages[1]!.textContent?.includes("第2ページ"));
  });

  it("fails closed for encrypted PDFs", async () => {
    const bytes = readFileSync(new URL("./fixtures/encrypted.pdf", import.meta.url));
    const extraction = await extractSource(bytes, "encrypted.pdf");
    expect(extraction.status).toBe("failed");
    assert.ok(extraction.warnings.some((warning) => warning.includes("PDF_ENCRYPTED")));
  });

  it("enforces page and input-size limits", async () => {
    const bytes = makePdf({ pages: ["one", "two"] });
    const pageLimited = await extractSource(bytes, "two.pdf", undefined, {
      limits: { maxPages: 1 },
    });
    expect(pageLimited.status).toBe("failed");
    assert.ok(pageLimited.warnings.some((warning) => warning.includes("PDF_PAGE_LIMIT_EXCEEDED")));

    const sizeLimited = await extractSource(bytes, "two.pdf", undefined, {
      limits: { maxInputBytes: 10 },
    });
    expect(sizeLimited.status).toBe("failed");
    assert.ok(sizeLimited.warnings.some((warning) => warning.includes("INPUT_SIZE_LIMIT_EXCEEDED")));
  });

  it("exposes page ranges and extraction warnings through the Studio adapter and MCP", async () => {
    const bytes = makePdf({ pages: ["MCP page one", "MCP page two"] });
    const registered = await coreService.registerObject(adminAuth, {
      workspaceId,
      name: "adapter-range.pdf",
      bytes,
      mimeType: "application/pdf",
    });

    const adapterRange = await adapter.getPageRange(workspaceId, registered.objectId, 1, 2);
    expect(adapterRange.pages.length).toBe(2);
    expect(adapterRange.pages[1]!.pageNumber).toBe(2);
    expect(adapterRange.pages[1]!.text?.includes("MCP page two")).toBe(true);

    const mcpRange = await mcpAdapter.handleToolCall(adminAuth, {
      name: "core_get_page_range",
      arguments: { objectId: registered.objectId, startPage: 1, endPage: 2 },
    });
    expect(mcpRange.isError).toBeUndefined();
    const mcpPayload = JSON.parse(mcpRange.content[0]!.text) as { pages: Array<{ pageNumber: number }> };
    expect(mcpPayload.pages.length).toBe(2);

    const mcpInfo = await mcpAdapter.handleToolCall(adminAuth, {
      name: "core_get_extraction_info",
      arguments: { objectId: registered.objectId },
    });
    const infoPayload = JSON.parse(mcpInfo.content[0]!.text) as Array<{ extractorId: string; status: string }>;
    expect(infoPayload[0]!.extractorId).toBe("builtin-pdf");
    expect(infoPayload[0]!.status).toBe("complete");

    const adapterInfo = await adapter.getExtractionInfo(workspaceId, registered.objectId);
    expect(adapterInfo[0]!.extractorId).toBe("builtin-pdf");
  });

  it("rejects page ranges for a logically deleted source", async () => {
    const registered = await coreService.registerObject(adminAuth, {
      workspaceId,
      name: "deleted-range.pdf",
      bytes: makePdf({ pages: ["deleted page"] }),
      mimeType: "application/pdf",
    });
    coreService.deleteObject(adminAuth, registered.objectId);
    expect(() => coreService.getPageRange(adminAuth, registered.objectId, 1, 1))
      .toThrow("SOURCE_NOT_FOUND");
  });
});
