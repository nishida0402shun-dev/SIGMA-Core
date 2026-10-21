/**
 * Data Model Types for SIGMA Core according to Requirements Specification v0.1.
 */

export type ObjectStatus = "Active" | "PendingDeletion" | "Purging" | "Purged";

export type DeviceStatus = "Active" | "Warning1" | "FinalWarning" | "Revoked";

export type QuarantineStatus = "Quarantined" | "Recovering" | "Recovered" | "Expired" | "Purged";

export type JobStatus = "Pending" | "Running" | "Succeeded" | "Failed" | "Cancelled";

export type AuditOutcome = "Success" | "Denied" | "Failed" | "Conflict";

export type KnowledgeSemanticType =
  | "problem"
  | "example"
  | "explanation"
  | "column"
  | "definition"
  | "theorem"
  | "answer"
  | "figure"
  | "unknown";

export interface SourceObjectMetadata {
  name: string;
  originalPath?: string | undefined;
  mimeType: string;
  sizeBytes: number;
  pageCount?: number | undefined;
  custom?: Record<string, unknown> | undefined;
}

export interface SourceObject {
  objectId: string;
  ownerId: string;
  scopeId: string; // workspace_id or library scope
  status: ObjectStatus;
  version: number;
  contentHash: string;
  metadata: SourceObjectMetadata;
  createdAt: string;
  updatedAt: string;
}

export interface BlobReference {
  blobId: string;
  objectId: string;
  storageKey: string;
  sizeBytes: number;
  mediaType: string;
  checksum: string;
  createdAt: string;
}

export interface ExtractedArtifact {
  artifactId: string;
  objectId: string;
  sourceVersion: number;
  extractorId: string;
  extractorVersion: string;
  status: "complete" | "partial" | "failed";
  /** Extraction warnings, including OCR-unavailable and resource-limit notices. */
  warnings: string[];
  /** Total page count reported by the source document, when known. */
  pageCount?: number | undefined;
  createdAt: string;
}

export interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface SourceLocation {
  locationId: string;
  artifactId: string;
  objectId: string;
  pageNumber: number;
  section?: string | undefined;
  startOffset?: number | undefined;
  endOffset?: number | undefined;
  textContent?: string | undefined;
  semanticType: KnowledgeSemanticType;
  title?: string | undefined;
  boundingBox?: BoundingBox | undefined;
  createdAt: string;
}

export interface DerivedRelation {
  derivedId: string;
  sourceObjectId: string;
  sourceVersion: number;
  relationType: "summary" | "knowledge_item" | "ai_generated" | "reference";
  targetId: string;
  targetType: string;
  metadata?: Record<string, unknown> | undefined;
  createdAt: string;
}

export interface Workspace {
  workspaceId: string;
  displayName: string;
  ownerId: string;
  status: "Active" | "Archived";
  createdAt: string;
  updatedAt: string;
}

export type Permission = "read" | "write" | "delete" | "restore" | "admin";

export interface AccessPolicy {
  grantId: string;
  subjectId: string;
  scopeId: string;
  permission: Permission;
  validFrom: string;
  validUntil?: string | undefined;
}

export interface DeletionRecord {
  objectId: string;
  deletionVersion: number;
  deletedAt: string;
  propagationState: "Pending" | "Propagated";
  backupExpiryState: "Active" | "Expired";
}

export interface Device {
  deviceId: string;
  userId: string;
  status: DeviceStatus;
  lastSuccessfulSyncAt: string;
  revokedAt?: string | undefined;
  credentialVersion: number;
}

export interface QuarantineItem {
  quarantineId: string;
  deviceId: string;
  objectId: string;
  sourceVersion: number;
  status: QuarantineStatus;
  quarantinedAt: string;
  expiresAt: string;
  payload: Record<string, unknown>;
}

export interface Job {
  jobId: string;
  jobType: "extract" | "purge" | "backup" | "restore" | "sync";
  targetId: string;
  status: JobStatus;
  attemptCount: number;
  nextAttemptAt?: string | undefined;
  lastErrorCode?: string | undefined;
  createdAt: string;
  updatedAt: string;
}

export interface AuditEvent {
  eventId: string;
  actorId: string;
  action: string;
  targetId: string;
  timestamp: string;
  outcome: AuditOutcome;
  reasonCode?: string | undefined;
  details?: Record<string, unknown> | undefined;
}

export interface SearchQuery {
  scopeId: string;
  query: string;
  limit?: number;
  semanticTypes?: KnowledgeSemanticType[];
}

export interface SearchHit {
  locationId: string;
  objectId: string;
  sourceName: string;
  pageNumber: number;
  semanticType: KnowledgeSemanticType;
  title?: string | undefined;
  textSnippet: string;
  score: number;
}

/** 1-based inclusive page range retrieval result. */
export interface SourcePageRange {
  object: SourceObject;
  startPage: number;
  endPage: number;
  /** Page count reported by source metadata; not necessarily the extracted count. */
  pageCount: number;
  pages: SourceLocation[];
}
