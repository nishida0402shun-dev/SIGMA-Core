/**
 * Device Revocation and Data Quarantine Service (7. Device Revocation & Quarantine Data, FR-020 to FR-027).
 * Implements strict UTC-based 60/75/90 day warnings/revocation,
 * isolated quarantine with zero leak into search/APIs, and user-selective recovery.
 */

import { randomUUID } from "node:crypto";
import type { CoreRepository } from "../persistence/core-repository.ts";
import type { Device, QuarantineItem, DeviceStatus, QuarantineStatus } from "../models/types.ts";

const DAY_MS = 24 * 60 * 60 * 1000;
const WARNING_1_DAYS = 60;
const WARNING_FINAL_DAYS = 75;
const REVOCATION_DAYS = 90;
const QUARANTINE_LIFETIME_DAYS = 30;

export interface DeviceStatusReport {
  deviceId: string;
  status: DeviceStatus;
  daysSinceLastSync: number;
  isRevoked: boolean;
  warningNotice?: string | undefined;
}

export interface QuarantineWarningReport {
  quarantineId: string;
  daysQuarantined: number;
  daysRemaining: number;
  isWarning: boolean;
  isFinalWarning: boolean;
  isExpired: boolean;
}

export class DeviceQuarantineService {
  readonly #repository: CoreRepository;

  constructor(repository: CoreRepository) {
    this.#repository = repository;
  }

  /**
   * Evaluates device status based on server-side UTC time (FR-020, FR-021).
   */
  evaluateDeviceStatus(deviceId: string, nowUtc = new Date().toISOString()): DeviceStatusReport {
    const device = this.#repository.getDevice(deviceId);
    if (!device) {
      throw new Error(`Device not found: ${deviceId}`);
    }

    const lastSyncMs = new Date(device.lastSuccessfulSyncAt).getTime();
    const nowMs = new Date(nowUtc).getTime();
    const daysSinceSync = Math.floor((nowMs - lastSyncMs) / DAY_MS);

    // Revocation is terminal for this device identity. A later sync attempt or
    // a status evaluation with a different timestamp must not reactivate it.
    if (device.status === "Revoked" || device.revokedAt) {
      return {
        deviceId,
        status: "Revoked",
        daysSinceLastSync: daysSinceSync,
        isRevoked: true,
        warningNotice: "Device is revoked and requires explicit re-enrollment.",
      };
    }

    let newStatus: DeviceStatus = "Active";
    let warningNotice: string | undefined;

    if (daysSinceSync >= REVOCATION_DAYS) {
      newStatus = "Revoked";
      warningNotice = "Device is revoked due to inactivity exceeding 90 days.";
      if (device.status !== "Revoked") {
        this.#repository.saveDevice({
          ...device,
          status: "Revoked",
          revokedAt: nowUtc,
        });
      }
    } else if (daysSinceSync >= WARNING_FINAL_DAYS) {
      newStatus = "FinalWarning";
      warningNotice = "Final warning: Inactivity exceeds 75 days. Revocation in 15 days.";
      if (device.status !== "FinalWarning") {
        this.#repository.saveDevice({ ...device, status: "FinalWarning" });
      }
    } else if (daysSinceSync >= WARNING_1_DAYS) {
      newStatus = "Warning1";
      warningNotice = "First warning: Inactivity exceeds 60 days.";
      if (device.status !== "Warning1") {
        this.#repository.saveDevice({ ...device, status: "Warning1" });
      }
    }

    return {
      deviceId,
      status: newStatus,
      daysSinceLastSync: daysSinceSync,
      isRevoked: newStatus === "Revoked",
      warningNotice,
    };
  }

  /**
   * Enrolls an incoming unsynced item into Quarantine (FR-023, 7.2).
   * Strict isolation: item is completely invisible to search, MCP, and standard APIs.
   */
  quarantineIncomingItem(
    deviceId: string,
    objectId: string,
    sourceVersion: number,
    payload: Record<string, unknown>,
    nowUtc = new Date().toISOString(),
  ): QuarantineItem {
    let dev = this.#repository.getDevice(deviceId);
    if (!dev) {
      dev = this.#repository.saveDevice({
        deviceId,
        userId: "quarantined-device-user",
        status: "Revoked",
        lastSuccessfulSyncAt: nowUtc,
        revokedAt: nowUtc,
        credentialVersion: 1,
      });
    }

    const quarantinedAtMs = new Date(nowUtc).getTime();
    const expiresAt = new Date(quarantinedAtMs + QUARANTINE_LIFETIME_DAYS * DAY_MS).toISOString();

    const item: QuarantineItem = {
      quarantineId: `quar_${randomUUID()}`,
      deviceId,
      objectId,
      sourceVersion,
      status: "Quarantined",
      quarantinedAt: nowUtc,
      expiresAt,
      payload,
    };

    return this.#repository.saveQuarantineItem(item);
  }

  /**
   * Evaluates quarantine items for 23-day / 29-day warnings and 30-day expiration (FR-025, FR-026, FR-027).
   */
  evaluateQuarantineExpiry(item: QuarantineItem, nowUtc = new Date().toISOString()): QuarantineWarningReport {
    const startMs = new Date(item.quarantinedAt).getTime();
    const nowMs = new Date(nowUtc).getTime();
    const daysQuarantined = Math.floor((nowMs - startMs) / DAY_MS);
    const daysRemaining = Math.max(0, QUARANTINE_LIFETIME_DAYS - daysQuarantined);
    const isExpired = nowMs >= new Date(item.expiresAt).getTime();

    if (isExpired && item.status === "Quarantined") {
      this.#repository.updateQuarantineStatus(item.quarantineId, "Expired");
      item.status = "Expired";
    }

    return {
      quarantineId: item.quarantineId,
      daysQuarantined,
      daysRemaining,
      isWarning: daysQuarantined >= 23 && daysQuarantined < 29,
      isFinalWarning: daysQuarantined >= 29 && !isExpired,
      isExpired,
    };
  }

  /**
   * Expire and purge quarantined payloads. Safe to run repeatedly from a scheduled job.
   * Failed payload deletion leaves the item Expired and eligible for a later retry.
   */
  purgeExpiredQuarantineItems(nowUtc = new Date().toISOString()): {
    expiredCount: number;
    purgedCount: number;
    failedCount: number;
  } {
    const nowMs = new Date(nowUtc).getTime();
    if (!Number.isFinite(nowMs)) throw new Error("INVALID_NOW_UTC");

    let expiredCount = 0;
    let purgedCount = 0;
    let failedCount = 0;
    const candidates = this.#repository.listQuarantineItems(undefined, ["Quarantined", "Expired"]);

    for (const item of candidates) {
      const expiresAtMs = new Date(item.expiresAt).getTime();
      if (!Number.isFinite(expiresAtMs) || nowMs < expiresAtMs) continue;

      try {
        if (item.status === "Quarantined") {
          this.#repository.updateQuarantineStatus(item.quarantineId, "Expired");
          expiredCount++;
        }
        // Repository operation clears payload_json and marks the row Purged.
        // If it throws, status remains Expired and the next sweep retries it.
        this.#repository.purgeQuarantineItem(item.quarantineId);
        purgedCount++;
      } catch {
        failedCount++;
      }
    }

    return { expiredCount, purgedCount, failedCount };
  }

  /**
   * User-selective recovery of quarantined data (FR-024, FR-027).
   * Re-verifies expiration, deletion status, and conflicts before canonical commit.
   */
  recoverQuarantineItem(
    quarantineId: string,
    nowUtc = new Date().toISOString(),
  ): { success: boolean; reason?: string } {
    const item = this.#repository.getQuarantineItem(quarantineId);
    if (!item) {
      return { success: false, reason: "Quarantine item not found" };
    }

    // Must still be within valid lifetime
    const expiry = this.evaluateQuarantineExpiry(item, nowUtc);
    if (expiry.isExpired || item.status === "Expired" || item.status === "Purged") {
      this.#repository.updateQuarantineStatus(quarantineId, "Expired");
      return { success: false, reason: "Quarantine item has expired and cannot be recovered" };
    }

    // Check if the object was deleted in the canonical repository
    const tombstone = this.#repository.getDeletionRecord(item.objectId);
    if (tombstone) {
      return { success: false, reason: "Object has a canonical deletion record (tombstone)" };
    }

    const currentCanonical = this.#repository.getSourceObject(item.objectId);
    if (currentCanonical && (currentCanonical.status === "PendingDeletion" || currentCanonical.status === "Purged")) {
      return { success: false, reason: "Canonical object is currently deleted or purged" };
    }

    // Transition to Recovering then Recovered
    this.#repository.updateQuarantineStatus(quarantineId, "Recovering");

    // Commit to canonical data if payload includes object metadata
    if (item.payload && item.payload.object) {
      const objData = item.payload.object as any;
      this.#repository.saveSourceObject({
        ...objData,
        updatedAt: nowUtc,
      });
    }

    this.#repository.updateQuarantineStatus(quarantineId, "Recovered");
    return { success: true };
  }
}
