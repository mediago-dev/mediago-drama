# Generation Route Protocol

Generation routes expose canonical parameter names to UI, storage, and HTTP callers. Provider-specific names are hidden behind each route's `ParamTranslation`.

## Add A Route

1. Add or reuse `ParamID` values in `packages/core/pkg/generation/param_ids.go`.
2. Declare the route params with `RouteParam` helpers in the matching catalog file.
3. Use canonical names only in `RouteParam.ID`; avoid provider aliases such as `ratio`, `imageSize`, `resolutionType`, or `videoResolution`.
4. Add a `ParamTranslation`:
   - `Moves` for one-to-one vendor names or enum value changes.
   - `Joins` when multiple canonical params become one vendor field.
   - `Consts` for route-level vendor constants.
5. Run `task -d packages/core test`.
6. Review the conformance failures or updated provider payload tests before shipping.

## Compatibility

`ApplyRoute` validates canonical params, translates them once, and marks the request with `ParamsResolved`. Providers may safely call route validation and apply logic again.

Unknown params are passed through. Stored legacy preference params are upgraded on read, and stored task params are upgraded before retry.

## Resolution Vocabulary

`resolution` uses kind-scoped vocabularies:

- Image routes may use `1K`, `2K`, `3K`, and `4K`.
- Video routes may use `480p`, `720p`, and `1080p`.

Provider-specific spellings, such as lowercase `2k`, must be normalized in the route translation layer with `Move.Values`. Expanding either vocabulary is an explicit protocol decision and must update the catalog conformance test at the same time.

## Sparse Combinations

`Joins` may declare sparse allowed combinations when a provider exposes one vendor field through multiple canonical params. The join `Table` is the source of truth, and route builders derive `paramCombos` from it for UI clients.

UI should disable unavailable combinations instead of hiding params or exposing provider-native fields. Every joined option must appear in at least one allowed key, and the default value combination must be present in the table; catalog conformance enforces both rules.
