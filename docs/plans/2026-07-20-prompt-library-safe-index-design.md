# Prompt library safe-index design

The prompt library uses a metadata-only list contract. The list contains only
the fields needed by the left navigation: identity, name, category, type,
pack ownership, source, and override flags. Prompt bodies and release
provenance are available only from the per-entry detail endpoint.

Imported-pack prompts remain visible in the left navigation, are grouped after
default and local packs, and are rendered as disabled rows. The backend detail
endpoint returns not found for imported-pack prompts, while internal runtime
callers retain access through the service's non-browsable `Get` method.

Consumers that require usable prompt bodies hydrate allowed index entries via
the detail endpoint. Failed imported detail requests are excluded, so browser
code never receives imported prompt content.
