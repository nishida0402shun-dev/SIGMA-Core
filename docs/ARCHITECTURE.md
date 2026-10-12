# SIGMA Core — Initial Architecture

**Status:** Conceptual design only. This document does not claim that the components are implemented.

## 1. Design boundaries

SIGMA Core is an internal capability of SIGMA Studio, not a separately deployed general-purpose platform by default. Keep modules independently testable, but avoid unnecessary service/process boundaries.

AI providers and connectors are adapters. They must call the common service layer for Core operations; they must not access the canonical database directly.

## 2. Conceptual layers

```text
SIGMA Studio UI
CLI AI / Web AI adapters
MCP tools / Skills adapters
          |
          v
Common service layer
  - identity and authorization
  - approval checks
  - processing plans and plan versions
  - operation history for important changes
  - conflict detection and idempotency
          |
          v
Core modules
  - file intake and format identification
  - extraction and source-region mapping
  - knowledge and learning-content management
  - keyword / semantic / structural retrieval
  - quality evaluation and impact analysis
  - job execution, interruption, and recovery
  - backup, restore, export, and migration
          |
          v
Persistence boundary
  - common canonical database
  - original-file storage
  - rebuildable search indexes
  - minimal durable job-recovery state
```

This is a logical view, not a commitment to a specific database, deployment model, or process layout.

## 3. Data categories and provenance

Keep these categories distinct and link them explicitly:

1. **Original source:** the uploaded source file, normally retained unchanged.
2. **Source-faithful extraction:** text, formulas, tables, images, and other content extracted from a source, with page/region references where possible.
3. **AI-organized knowledge:** summaries, interpretations, structure, and semantic relationships.
4. **Learning content:** questions, answers, explanations, and related assessment material.
5. **Operational metadata:** permissions, versions, approvals, quality status, source references, and recovery state.

An AI interpretation must never be presented as verbatim source extraction. A file is only “supported” for a particular operation when its contents can actually be recognized and analyzed to the declared capability level; storage alone is not support.

## 4. File recognition and extraction

Use an extensible adapter/registry model. Each format or processing method should declare supported operations and known limitations, and have representative tests.

Capability states:
- **Supported:** the declared content and operation have passed the relevant validation criteria.
- **Partially supported:** some content or structures are recognized, with known limitations.
- **Unsupported:** no safe, suitable recognition path is available.
- **Unverified:** implementation or quality evidence is not yet sufficient to make a claim.

Recognition must not rely on file extensions alone. Identify format safely, apply resource limits to archives/compound files, and never execute unknown files just to inspect them. Preserve the original if extraction fails. Do not claim complete extraction unless coverage and validation evidence justify that claim.

For PDFs, the design should allow both text selection and rectangular region selection, multiple selections, and traceability to page/coordinates. OCR and image/structure analysis may be used where appropriate, with uncertainty explicitly represented.

## 5. Retrieval

Provide a common retrieval interface for:
- keyword/full-text search;
- semantic/vector search;
- structural and relationship queries;
- trace-back to source files, pages, regions, and versions.

Canonical records remain authoritative. Search indexes are derived, rebuildable data. Search and AI context assembly must enforce permissions before returning results or source-derived content.

## 6. Plans, approvals, and content lifecycle

AI and the user collaboratively define task-specific processing plans. Before execution, show steps, rationale, expected outputs, risks, data changes, and alternatives. User approval of the plan is distinct from approval to formally register generated content.

AI-discovered plan improvements require a proposal and renewed approval before changing an approved plan. Registered-content modification, overwrite, and original-file modification/deletion have separate impact-explanation and approval requirements.

Support keeping prior versions or replacing the active version by user choice. Deletion is a separate operation; inspect references and downstream dependencies before proposing it.

## 7. Authorization and integrations

Use the Studio session for in-app actions and dedicated authentication for external integrations such as MCP, while distinguishing:
- the user identity;
- the connector/integration identity;
- the requested operation;
- the target data's scope and permissions;
- required approval state.

Authentication alone does not grant permission. Apply operation-specific authorization centrally. Never expose database schema or unrestricted DB access to connectors.

## 8. Jobs, failures, and recovery

Use per-job state to distinguish completed, failed, and unknown outcomes. On timeout, inspect status before retrying writes; prevent duplicate registrations and stale-base updates. Retry limits and timeout values are adapter-specific configuration over shared safeguards.

Keep only minimal durable recovery metadata and temporary intermediate artifacts needed to resume safely. Detailed execution logs should normally disappear after completion; essential approvals, source links, important operation history, and registered outputs remain durable. The agreed temporary-artifact retention target is seven days, but the exact start point and post-expiry behavior still need a decision. Do not automatically delete artifacts merely because a notification failed.

## 9. Data integrity, versions, and impact

Record source/content versions used by AI operations. When a source changes, identify changed regions, traverse dependencies, classify downstream outputs as affected / unaffected / unknown, and propose revalidation or repair. Do not silently rewrite registered content.

Use conflict detection for concurrent writes. Independent changes may coexist only after checking for lost updates; same-field conflicts require review. Unresolvable conflicts must be held rather than silently overwritten.

Quality status is use-specific. Uncertain regions can be isolated while verified portions continue through appropriate operations. High-impact or unknown issues can require revalidation or restrict affected uses without unnecessarily blocking unrelated content.

## 10. Storage, backup, and recovery

Store original files in file storage and canonical metadata/structured content in a common database. The exact storage destination and database engine remain undecided.

Backups should support scheduled, pre-change, and manual runs; retention by time period and data type; and verification that each backup can actually be restored. Destination-native security is the current baseline, subject to validating the chosen destination's capabilities.

Recovery should support full-system, data-category, and individual-record scopes. Inspect overwrite and dependency impact before recovery, obtain required approval, validate integrity afterward, and report partial failures honestly. Rebuild derived indexes as needed.

## 11. Configuration, diagnostics, and startup checks

Configuration is GUI-first, classified by type, with per-setting permissions and stronger preflight/confirmation for high-impact changes. Keep secrets separate from ordinary configuration exports and diagnostics.

Startup performs lightweight health checks. Detailed integrity checks run when anomalies are detected or after important changes. Do not automatically delete or overwrite canonical data to “fix” a detected problem.

User-facing errors should provide actionable summaries; authorized diagnostics may provide technical detail while redacting secrets. Unknown causes must be labeled unknown.

## 12. Testing and release gates

Plan for unit, integration, end-to-end, security, failure-injection, integrity/recovery, and regression tests.

Release-critical assertions include:
- no protected/destructive operation without required authorization and approval;
- no unauthorized source-derived content in retrieval or AI context;
- no duplicate registration after timeout/retry/recovery;
- restored records, references, permissions, and versions are validated;
- failed or unrun required checks are never reported as passed.

Performance targets must be measured against documented hardware, dataset, and workload conditions. Exact numeric thresholds are not set yet.
