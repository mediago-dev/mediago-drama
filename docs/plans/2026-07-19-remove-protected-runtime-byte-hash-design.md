# Remove Protected Runtime Byte Hash Design

## Problem

The release build hashes the staged `mediago-rights` Mach-O before Electron
Builder signs the macOS application. Code signing changes the executable bytes,
so the hash embedded in `mediago-server` no longer matches the packaged
Runtime. Protected pack imports then fail during service wiring even though the
Runtime came from the verified release input and is part of the signed app.

## Decision

Remove the open-source server's raw-file SHA-256 check for
`mediago-rights`. Keep the private artifact checks in the release preparation
step: release identity, policy, URL, archive member, size, and SHA-256 are still
verified before staging. On macOS, Electron Builder's application signing is
the final release trust boundary, matching the existing sidecar policy.

The framed importer protocol continues to validate the decrypted payload's
declared length and SHA-256. That protects the process boundary and is separate
from hashing the executable file itself.

## Runtime behavior

The server resolves the packaged Runtime path, checks that it is a regular
file, and invokes it for protected imports. Initialization errors are logged
with their cause before the public API maps them to the stable unavailable
message. The private Runtime's exit codes and framed response validation remain
unchanged.

Because platform signing is now the packaged trust boundary, official macOS CI
verifies the completed `.app` recursively with `codesign --deep --strict` before
uploading release artifacts. This is a release gate, not a client-side runtime
integrity check.

## Verification

Unit tests will assert that importer construction depends on a valid regular
file rather than a caller-provided digest, and that CI resolves the final App
bundle path deterministically. Existing protocol, bounded-output, and
process-error tests remain in place. Server and prompt-pack package tests, Go
formatting/vetting, workflow script tests, and repository whitespace checks
must pass.
