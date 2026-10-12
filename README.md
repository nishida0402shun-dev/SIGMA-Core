# SIGMA Core

SIGMA Core is a new, purpose-built internal foundation for SIGMA Studio's data, knowledge, retrieval, and AI-assisted processing workflows.

> **Status:** Design and repository bootstrap. This repository is being built from scratch. Existing legacy SIGMACore and `knowledgeDB` implementations are not the foundation of this project.

## Goals

- Preserve original files and keep source-faithful extraction separate from AI interpretations.
- Make file-content recognition extensible across formats; a file is not considered supported merely because it can be stored.
- Provide keyword, semantic, structural/relationship, and source-traceable retrieval.
- Manage source materials, extracted content, organized knowledge, questions, and explanations as linked but distinct data.
- Enforce authorization and approval rules through a shared service layer for every integration.
- Support resumable jobs, duplicate-write prevention, integrity checks, backups, restore validation, and risk-based tests.
- Keep the architecture modular without splitting it into unnecessary services.

## Core principles

1. **Truthful capability reporting:** distinguish supported, partially supported, unsupported, and unverified formats and operations.
2. **Source traceability:** derived content retains links to its source and relevant page/region/version where available.
3. **Approval boundaries:** plan approval, execution approval, and formal registration are distinct where required.
4. **No silent destructive changes:** explain impact and obtain explicit approval before modifying or deleting original files.
5. **Shared authorization:** UI, CLI AI, Web AI, MCP, and Skills must not bypass common permission checks through direct database access.
6. **Recoverability:** separate canonical data from rebuildable indexes and temporary job artifacts.
7. **Verified claims:** never report tests, builds, extraction completeness, or recovery as successful unless actually verified.

## Initial scope

- Source files stored in file storage; canonical metadata and structured records in a common database.
- Search indexes are derived and rebuildable.
- Personal, Workspace, and shared-library scopes, with access checks and source-derived content protections.
- File recognition/extraction adapters that can be added and tested independently.
- A single-device-first usage model that does not unnecessarily block future expansion.

## Design documents

- [Architecture](docs/ARCHITECTURE.md)
- [Design decisions and open questions](docs/DECISIONS.md)

## Development status

No runtime implementation or automated test suite is claimed to exist yet. Database engine, runtime model, language/framework, storage destination, extraction libraries, and measurable performance thresholds must be selected after requirements and trade-offs are documented.
