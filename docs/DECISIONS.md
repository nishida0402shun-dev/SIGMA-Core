# SIGMA Core — Design Decisions

**Status:** Working decision record. These are design agreements, not implemented features. Revisit a decision when evidence or requirements change.

## Agreed direction

| Area | Decision |
|---|---|
| Project boundary | New implementation from scratch; do not inherit legacy SIGMACore or `knowledgeDB` as the foundation. |
| Product role | SIGMA Studio-only internal capability. |
| Data model | Hybrid file library + knowledge/relationship graph metadata. |
| Canonical persistence | Common database; files stored separately; derived indexes are rebuildable. |
| Data scopes | Personal, Workspace, shared library, with more granular permissions as needed. |
| Workspace behavior | User chooses Workspace; no silent automatic selection. |
| File support definition | A file is supported only when its contents can be recognized/analyzed for the declared operation; storage alone does not qualify. |
| File handling | Aim for broad file-format coverage through extensible recognizers/extractors, with explicit capability and quality status. |
| Source fidelity | Keep original sources, source-faithful extraction, AI-organized knowledge, and learning content separate but linked. |
| Search | Keyword/full-text, semantic, structural/relationship, and source traceability. |
| Processing plans | Co-designed with AI and user; preview and approval before execution. |
| Plan improvement | Propose rationale, impact, and alternatives; renewed approval required before changing an approved plan. |
| Registration | Formal registration of generated content is a separate approval from approving a processing plan. |
| Versioning | Keep old versions or replace the active version by user choice; deletion is a separate, impact-checked operation. |
| Original files | Normally retain originals. Explain impact and obtain explicit approval before changing or deleting them. |
| Quality | Combine mechanical checks, AI semantic review, source comparison, and human review where needed; AI self-evaluation alone is insufficient. |
| Uncertainty | Isolate uncertain portions, continue independent work, and never convert guesses into source-faithful extraction. |
| Source changes | Analyze downstream dependencies and classify affected / unaffected / unknown; obtain approval before modifying registered content. |
| AI integration | UI, CLI AI, Web AI, MCP, and Skills use a shared service layer; no direct DB access by adapters. |
| Authentication | Studio session for in-app operations; dedicated authentication for external integrations; identify user and integration separately. |
| Authorization | Operation-specific common authorization plus per-connector exposure settings. |
| Failures | Shared timeout/retry/recovery controls with adapter-specific settings; inspect unknown write outcomes before retrying. |
| Concurrency | Parallelize independent work; detect write conflicts and prevent duplicate registration. |
| Logs | Detailed processing logs normally disappear after completion; retain essential approval, provenance, registered data, and recovery state. |
| Interrupted artifacts | Retention target of 7 days with user notification and choice; exact clock start and behavior after expiry remain open. |
| Audit history | Retain important approvals, registrations, destructive changes, permission changes, quality transitions, and recovery actions. |
| Deletion | Rules vary by data type; inspect dependencies; do not cascade-delete registered content silently. |
| Backup | Scheduled, pre-change, and manual backups; period-based generations; verify restoreability separately from backup completion. |
| Backup destination | User-selectable local, separate-drive, and optional cloud destinations. |
| Backup security | Use destination-native security as the initial baseline; verify capabilities before adoption. |
| Restore | Full system, category, and individual record; preflight impact, authorization, and post-restore validation. |
| Migration | Versioned schemas, staged migrations, verified restore path for major changes, and explicit supported migration paths. |
| Startup health | Lightweight checks at startup; deeper checks on anomalies or after important changes. |
| Settings | GUI-first; classify settings; enforce per-setting permissions and stronger checks for high-impact changes. |
| Diagnostics | Actionable normal messages, permission-aware technical diagnostics, and secret redaction. |
| Tests | Unit, integration, E2E, security, failure-injection, integrity/recovery, and regression tests. Risk-based release gates. |
| Performance | Preserve UI responsiveness and measure representative workloads; numerical targets follow environment/workload definition. |
| Initial sharing | Prioritize single-device use without needlessly preventing future expansion. |

## Open decisions — do not guess

The following choices must be resolved with documented trade-offs before they become implementation constraints:

1. **Language/runtime/framework:** choose after mapping the UI integration, CLI/AI adapters, packaging, testability, and supported platforms.
2. **Database engine:** compare candidates against local-first use, full-text and vector retrieval needs, transactions, migrations, backup/restore, and packaging.
3. **Execution model:** confirm offline expectations, where AI runs, process boundaries, file access, and recovery requirements.
4. **File storage destination:** local path and managed storage design; access controls, large files, atomic writes, orphan cleanup, and backup coordination.
5. **Recognition/extraction matrix:** define format families, content types, operations, validation evidence, dependencies, and licensing/security constraints.
6. **AI/provider capability matrix:** identify what CLI AI, Web AI, local models, MCP, and Skills can actually do, with trust boundaries and tool permission models.
7. **Search implementation:** select full-text/vector/relationship indexing technology only after query requirements and database trade-offs are clear.
8. **Identity and roles:** define single-device user identity, role model, permission editing authority, and external connector lifecycle.
9. **Timeout/retry values:** measure and configure by connector and operation class.
10. **Interrupted artifact lifecycle:** define when the seven-day clock starts, extension behavior, and what happens if the user does not respond after notification.
11. **Version retention:** define storage limits and deletion conditions by data type, preserving referenced versions.
12. **Quality thresholds:** define checks and acceptance thresholds by purpose, especially questions, explanations, formulas, tables, and high-impact learning use.
13. **Performance targets:** specify hardware, representative dataset sizes, workload mix, and numeric thresholds.
14. **Backup policy:** define frequency, generation counts, retention, encryption requirements, and recovery objectives.
15. **Schema and export compatibility:** specify package format, generic export schemas, supported migration paths, and unsupported-field reporting.
16. **Security threat model:** assess local account compromise, file exfiltration, malicious/oversized files, prompt injection from sources, external data transfer, and credential leakage.
17. **CI and release process:** select required checks, branch/PR policy, test environments, and release gates after choosing the stack.

## Decision process

For major decisions, record:
- the requirement being addressed;
- viable options and trade-offs;
- the selected option and rationale;
- security, migration, test, and recovery implications;
- unresolved risks and what evidence would trigger reconsideration.

Do not represent a proposed or agreed design as implemented. Mark each capability separately as planned, implemented, tested, or unverified.
