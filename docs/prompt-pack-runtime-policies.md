# Prompt pack runtime policies

MediaGo Drama has two build-time prompt-pack policies. The policy is embedded
in `mediago-server`; it is not a user-facing runtime switch.

## Marketplace policy

`marketplace` is the official ToC build policy. Export remains compatible with
the unprotected v1 format, but direct v1 import is rejected with guidance to
publish and encrypt the package on MediaGo. Protected v2 packages are delegated
to the private `mediago-rights` executable.

The private executable owns protected-package inspection, signature checking,
website authorization, entitlement resolution, package-key unwrapping, and
decryption. The open-source server only accepts its framed, digest-checked v1
result. Composer releases one v2 shape and every Drama edition uses this same
authorization path.

Official CI uses:

```bash
MEDIAGO_PROMPT_PACK_POLICY=marketplace
MEDIAGO_INCLUDE_PROTECTED_PACK_RUNTIME=1
```

The release inputs have deliberately separate scopes:

| Name                                     | Scope                                          | Purpose                                                                                           |
| ---------------------------------------- | ---------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `MEDIAGO_PRIVATE_ARTIFACT_TOKEN`         | GitHub `official-release` environment secret   | Lets only the dedicated download step read the private Release assets.                            |
| `MEDIAGO_RIGHTS_RELEASE_TAG`             | GitHub `official-release` environment variable | Pins the private Release tag downloaded by the workflow.                                          |
| `MEDIAGO_PROMPT_PACK_POLICY`             | Build-step environment                         | Embeds `marketplace` or `partner` into `mediago-server`; changing it after build has no effect.   |
| `MEDIAGO_INCLUDE_PROTECTED_PACK_RUNTIME` | Build-step environment                         | Requires the already staged Runtime to be hashed and copied into Electron resources.              |
| `MEDIAGO_PROMPT_PACK_IMPORTER_PATH`      | Local development process only                 | Points a locally built server at a Runtime whose SHA-256 was embedded when that server was built. |

None of these values are read by `Taskfile.yml`. The open-source Task tasks build
the ordinary server and cannot download private repository assets.

The protected `official-release` environment exposes
`MEDIAGO_PRIVATE_ARTIFACT_TOKEN` only to the dedicated GitHub Release download
step. The token is not inherited by Task, Node, Go, or Electron build scripts.
That step downloads the pinned manifest and archive from
`mediago-drama-private`. `scripts/stage-private-runtime.py` validates and stages
the executable before the normal public build starts. The generic vendor tool
preparer never receives private-repository credentials.

The private release manifest pins the archive URL, size, SHA-256, binary path,
version, and `marketplace` runtime policy. The server binary also embeds the
expected SHA-256 of the staged `mediago-rights` executable. Importer
initialization checks it before protected import is enabled, and every protected
import checks it again. If initialization fails, the rest of the local server
remains available while protected imports fail closed as Runtime unavailable.

Store `MEDIAGO_PRIVATE_ARTIFACT_TOKEN` in the protected `official-release`
GitHub environment, require a reviewer for that environment, and grant the
token only `Contents: read` on `mediago-drama-private`. Do not use a personal
token with organization-wide write access.

Official macOS releases fail closed unless signing credentials exist in the
same protected environment. macOS signing requires `MEDIAGO_MAC_CSC_LINK` and
`MEDIAGO_MAC_CSC_KEY_PASSWORD`. Local development builds do not require signing
secrets.

The desktop runtime does not maintain a separate sidecar checksum or signature
manifest. On macOS, Electron Builder signs the application and
`forceCodeSigning` makes a signing failure fail the build. The application only
checks that the server sidecar exists and reports the real process launch error
if execution fails. Windows releases are currently unsigned and therefore do
not claim a cryptographically verified publisher identity; add Authenticode
verification when a Windows signing certificate becomes available.

For macOS direct distribution, create a `Developer ID Application` certificate
in the Apple Developer account, install it together with its private key, and
export both as a password-protected `.p12`. Store the base64-encoded `.p12` as
`MEDIAGO_MAC_CSC_LINK` and its export password as
`MEDIAGO_MAC_CSC_KEY_PASSWORD`. Never commit the certificate or either value to
the repository. The release workflow signs macOS artifacts by default and does
not submit them for Apple notarization.

Notarization is opt-in. Set the `official-release` environment variable
`MEDIAGO_MAC_NOTARIZE` to `1` only after Apple has enabled notarization for the
developer team. An enabled notarization build additionally requires the
`MEDIAGO_APPLE_ID`, `MEDIAGO_APPLE_APP_SPECIFIC_PASSWORD`, and
`MEDIAGO_APPLE_TEAM_ID` environment secrets. When the variable is absent or is
not `1`, those three secrets are not injected into the build.

After downloading and unpacking an official macOS release, verify the app
before publishing it:

```bash
codesign --verify --deep --strict --verbose=2 "/path/to/MediaGo Drama.app"
codesign -dv --verbose=4 "/path/to/MediaGo Drama.app"
```

For a notarized release, additionally verify Gatekeeper acceptance and the
stapled notarization ticket:

```bash
spctl --assess --verbose --type exec "/path/to/MediaGo Drama.app"
xcrun stapler validate "/path/to/MediaGo Drama.app"
```

The signature details must show the expected `Developer ID Application`
authority and Apple team ID. For notarized builds, Gatekeeper must report
`accepted` and stapler must report a valid notarization ticket.

Packaged Electron starts the local server with a fresh
`MEDIAGO_SIDECAR_TOKEN` for each process and sends it in
`X-MediaGo-Sidecar-Token` on renderer API requests. The Go server rejects
requests that do not present that token. Agent subprocesses use a separate
random bridge token, which is accepted only by the internal Agent routes and
cannot authorize normal workspace APIs. Standalone development mode leaves
this check disabled unless the server is explicitly started as a sidecar.

## Cooperation policy

`partner` is the internal build-policy value for a separately delivered
cooperation build. It allows direct import of unprotected v1 packages. This is
the only difference from the marketplace build.

```bash
MEDIAGO_PROMPT_PACK_POLICY=partner \
MEDIAGO_INCLUDE_PROTECTED_PACK_RUNTIME=1 \
node scripts/build-server-target.mjs darwin-arm64
```

Protected v2 packages still use the shared marketplace `mediago-rights`
artifact. It opens MediaGo authorization, verifies the Composer signature,
checks the current account's entitlement, receives an import-scoped key grant,
and decrypts only after access is allowed. Cooperation builds do not contain a
Partner private key and cannot bypass purchase checks for marketplace packages.

Changing `MEDIAGO_PROMPT_PACK_POLICY` after `mediago-server` has been built does
not change that binary. Rebuild the server or desktop application to change the
policy. This prevents an official retail installation from being converted to
a cooperation build by setting a launch environment variable.

## Local private Runtime

For local integration testing, build `mediago-rights` in the private repository,
embed its digest in a local server binary, and then run that binary directly:

```bash
RUNTIME=/absolute/path/to/mediago-rights
RUNTIME_SHA="$(shasum -a 256 "$RUNTIME" | awk '{print $1}')"

go build \
  -ldflags "-X main.defaultPromptPackPolicy=marketplace -X main.defaultProtectedPackImporterSHA256=$RUNTIME_SHA" \
  -o bin/mediago-server \
  ./services/server/cmd/mediago-server

MEDIAGO_PROMPT_PACK_IMPORTER_PATH="$RUNTIME" \
  bin/mediago-server --config services/server/configs/server.yaml
```

The protected importer checks the embedded digest during initialization and
again before each import. `task build:server` intentionally remains a plain
open-source build and does not consume private Runtime settings. Official
release builds stage the pinned GitHub Release asset and inject its digest via
`scripts/build-server-target.mjs`.

## Seat terminology

`SEAT_DISTRIBUTION` is a ToC distribution model. A publisher buys reusable
distribution capacity and shares its protected package with selected MediaGo
accounts. On an account's first explicit import, the MediaGo authorization page
can bind that account to the package publisher and allocate one of that
publisher's available seats. Another package from the same publisher reuses the
active membership instead of consuming another seat. Membership is directional:
it never grants the member any of the publisher's capacity. If that member
publishes a package of their own, they must buy and allocate their own seats.

Removing a member releases the allocation. Background update and protected
content-use (`call`) never create or restore membership; only another explicit
import confirmation can do that. In the MVP, a successfully imported package
may be used locally without another online `call` entitlement check. Product and UI copy should use
`分发席位`, not `企业席位`; it does not assert that either account belongs to an
enterprise.
