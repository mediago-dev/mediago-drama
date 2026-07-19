# Default prompt pack read-only design

The repository-provided default prompt pack is a read-only template. Users may
inspect it, enable or disable it, and fork it into a standalone local pack.
They may not edit, add, remove, reset, recategorize, or export its contents.

Backend mutation paths enforce a single rule: only packs whose normalized
source is `local` may change. The fork operation remains intentionally separate
and accepts the default pack as a source, producing a new local pack with an
independent ID. Public export rejects the default pack with the standard
read-only error.

The editor mirrors this boundary. A selected default pack shows enablement and
copy controls, while edit, reset, export, create-entry, delete-entry, and
entry-reset controls are absent. Entry contents remain readable. After copying,
the new local pack exposes the existing editing and export workflow.
