/**
 * Runnable stdio MCP entrypoint.
 *
 * Required environment:
 * - SIGMA_CORE_DB_PATH: path to the shared SIGMA Core SQLite database
 * - SIGMA_CORE_BLOB_DIR: shared LocalBlobStore root
 * - SIGMA_CORE_SUBJECT_ID: authenticated subject ID; permissions come from DB policies
 *
 * No super-admin bypass is enabled by this entrypoint.
 */
import { CoreRepository } from "../persistence/core-repository.ts";
import { LocalBlobStore } from "../persistence/local-blob-store.ts";
import { AuthService } from "../services/auth-service.ts";
import { BackupService } from "../services/backup-service.ts";
import { DeviceQuarantineService } from "../services/device-quarantine-service.ts";
import { CoreService } from "../services/core-service.ts";
import { startCoreMcpStdioServer } from "./stdio-server.ts";

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

async function main(): Promise<void> {
  const databasePath = requiredEnv("SIGMA_CORE_DB_PATH");
  const blobDirectory = requiredEnv("SIGMA_CORE_BLOB_DIR");
  const subjectId = requiredEnv("SIGMA_CORE_SUBJECT_ID");

  const repository = new CoreRepository(databasePath);
  const blobStore = new LocalBlobStore(blobDirectory);
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

  const close = () => repository.close();
  process.once("SIGINT", close);
  process.once("SIGTERM", close);

  // Identity comes from the trusted process environment, never from tool arguments.
  await startCoreMcpStdioServer(coreService, () => ({ subjectId }));
}

main().catch((error: unknown) => {
  // stdout is reserved for MCP JSON-RPC framing.
  console.error("SIGMA Core MCP server failed to start:", error);
  process.exitCode = 1;
});
