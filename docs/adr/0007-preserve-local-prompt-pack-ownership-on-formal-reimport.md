# ADR-0007: Preserve local prompt-pack ownership on formal reimport

## Status

Accepted

## Context

A locally authored prompt pack keeps the same package ID when exported, reviewed by the platform, and downloaded as a formal release. The formal import path currently treats every verified package as third-party content. Its upsert changes an existing local pack to `imported`, deletes the local entries and categories, and replaces them with a read-only release snapshot.

Package ownership and installation provenance are different concepts. Reimporting a reviewed release should not destroy the local authoring source. Local edits may also have advanced while review was in progress, so replacing the draft with the reviewed snapshot risks data loss.

## Decision

When a verified formal release is imported and a pack with the same ID already exists as `local`:

- Keep the pack source as `local` and preserve its name, description, entries, categories, enabled state, and empty origin.
- Record the verified `releaseId` and release version on the local pack.
- Do not persist or install the reviewed snapshot over the local authoring data.

When no local pack with the same ID exists, continue installing the formal release as a read-only `imported` pack.

## Consequences

### Positive

- Reimporting a creator's reviewed package no longer changes it into an imported package.
- Local edits made during review are not overwritten.
- Third-party formal releases remain read-only when no local authoring source exists.

### Negative

- The local working copy can differ from the reviewed release while sharing its latest release ID.
- Package-ID continuity is only a device-local ownership signal; it does not restore ownership after the local source has been deleted.

### Neutral

- A future protected-package protocol should carry a signed publisher identity. The service can then restore authoring ownership across devices after comparing that identity with the signed-in account.

## Alternatives Considered

**Preserve `local` but overwrite the draft with reviewed content**

- Rejected because it can destroy edits made while the review was pending.

**Always install as `imported`, then expose a manual “recover authoring draft” action**

- Rejected for the same-device reimport case because the system already has the local authoring source and should not discard that fact.

**Immediately add signed publisher ownership to the package format**

- Deferred because it requires coordinated platform, account, container, and database changes. It remains the preferred cross-device ownership solution.

## References

- `services/server/internal/service/promptpack/import_export.go`
- `services/server/internal/service/promptpack/service.go`
