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
MEDIAGO_VENDOR_TOOLS_OVERLAY=/path/to/mediago-rights-tools.json
```

The protected `official-release` environment exposes
`MEDIAGO_PRIVATE_ARTIFACT_TOKEN` only to the dedicated GitHub Release download
step. The token is not inherited by Task, Node, Go, or Electron build scripts.
Local vendor preparation may use `MEDIAGO_VENDOR_GITHUB_TOKEN`, but official CI
must not pass that variable into the build.

The private release manifest pins the archive URL, size, SHA-256, binary path,
version, and `marketplace` runtime policy. Vendor preparation requires that one
runtime policy for both Drama build policies. The server binary also embeds the
expected SHA-256 of the staged `mediago-rights` executable. Importer
initialization checks it before protected import is enabled, and every protected
import checks it again. If initialization fails, the rest of the local server
remains available while protected imports fail closed as Runtime unavailable.

Store `MEDIAGO_PRIVATE_ARTIFACT_TOKEN` in the protected `official-release`
GitHub environment, require a reviewer for that environment, and grant the
token only `Contents: read` on `mediago-drama-private`. Do not use a personal
token with organization-wide write access.

Official desktop releases also fail closed unless platform signing credentials
exist in the same protected environment. macOS requires
`MEDIAGO_MAC_CSC_LINK`, `MEDIAGO_MAC_CSC_KEY_PASSWORD`, `MEDIAGO_APPLE_ID`,
`MEDIAGO_APPLE_APP_SPECIFIC_PASSWORD`, and `MEDIAGO_APPLE_TEAM_ID`; Windows
requires `MEDIAGO_WINDOWS_CSC_LINK` and
`MEDIAGO_WINDOWS_CSC_KEY_PASSWORD`. Local development builds do not require
these secrets.

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
MEDIAGO_VENDOR_TOOLS_OVERLAY=/path/to/mediago-rights-tools.json \
task build:desktop
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

For local integration testing, build `mediago-rights` in the private repository
and pass its absolute path while building/running the public server:

```bash
MEDIAGO_PROMPT_PACK_IMPORTER_PATH=/absolute/path/to/mediago-rights \
MEDIAGO_PROMPT_PACK_POLICY=marketplace \
task dev:server
```

`task build:server` embeds the SHA-256 of that local binary. The protected
importer checks it during initialization and again before each import. This
local override is not used by official CI; release builds stage the pinned
GitHub Release asset.

## Seat terminology

`SEAT_DISTRIBUTION` is a ToC distribution model. A publisher buys reusable
distribution capacity and sends one-time redemption codes to selected MediaGo
accounts. Product and UI copy should use `分发席位`, not `企业席位`; it does not
assert that either account belongs to an enterprise.
