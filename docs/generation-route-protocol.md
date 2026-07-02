# Generation Route Protocol

Generation routes expose canonical parameter names to UI, storage, and HTTP callers. Provider-specific names are hidden behind each route's `ParamTranslation`.

## Add A Route

1. Add or reuse `ParamID` values in `packages/core/pkg/generation/param_ids.go`.
2. Register new parameters in the matching kind dictionary (`params_image.go`, `params_video.go`, or `params_text.go`) with a `Group`.
3. Declare the route params with `RouteParam` helpers in the matching catalog file.
4. Use canonical names only in `RouteParam.ID`; avoid provider aliases such as `ratio`, `imageSize`, `resolutionType`, or `videoResolution`.
5. Add a `ParamTranslation`:
   - `Moves` for one-to-one vendor names or enum value changes.
   - `Joins` when multiple canonical params become one vendor field.
   - `Consts` for route-level vendor constants.
6. Run `task -d packages/core test`.
7. Review the conformance failures or updated provider payload tests before shipping.

## Compatibility

`ApplyRoute` validates canonical params, translates them once, and marks the request with `ParamsResolved`. Providers may safely call route validation and apply logic again.

Unknown params are passed through. Stored legacy preference params are upgraded on read, and stored task params are upgraded before retry.

## Resolution Vocabulary

`resolution` vocabularies are isolated by kind dictionaries:

- Image routes may use `1K`, `2K`, `3K`, and `4K`.
- Video routes may use `480p`, `720p`, and `1080p`.

Provider-specific spellings, such as lowercase `2k`, must be normalized in the route translation layer with `Move.Values`. Expanding either vocabulary is an explicit protocol decision and must update the corresponding kind dictionary; catalog conformance checks route options against that dictionary.

## Parameter Groups

Canonical parameters are organized by media kind. Each kind has one parameter dictionary and one ordered group registry:

- `group` on `ParamSpec` is the first-level toolbar entry.
- Group members are the second-level params inside that entry.
- `paramGroups` on `ModelRoute` is derived from `CanonicalParams` in group registry order; empty groups are omitted.
- `menu` remains as a deprecated compatibility field (`other` -> `secondary`, all other groups -> `primary`).

Client rendering rules:

- `size` renders as the combined aspect ratio + resolution control.
- A single-param non-`other` group renders as that parameter's popover with the group label as the trigger.
- `count` renders as the generation count control.
- `other` renders as a list popover.
- Empty groups are hidden, and `paramGroups` order is the toolbar order.

`RouteParam` must not declare or override `group`. Parameter placement is a kind dictionary contract so the same canonical parameter appears consistently for that media type.

## Sparse Combinations

`Joins` may declare sparse allowed combinations when a provider exposes one vendor field through multiple canonical params. The join `Table` is the source of truth, and route builders derive `paramCombos` from it for UI clients.

Routes may also attach `paramCombos` directly in `RouteParamConfig` when the provider receives separate params but the model only supports a sparse cross-product of those params. These combos are UI-facing and are also enforced during route param validation. When a combo includes `outputs`, UI previews should use the exact output value for the selected combination before falling back to inferred dimensions.

UI should disable unavailable combinations instead of hiding params or exposing provider-native fields. Every joined option must appear in at least one allowed key, and the default value combination must be present in the table; catalog conformance enforces both rules.
