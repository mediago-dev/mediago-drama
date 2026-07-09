// Application-bundle (renderer + server) hot-update rollout switch and trust anchors.
//
// ⚠️ hotUpdateEnabled must stay false until:
//   1. the Ed25519 release keypair exists (private key in GitHub Actions secrets),
//   2. bundleUpdatePublicKey below is filled with the matching public key,
//   3. the bundle-hot-release pipeline publishes signed manifests to the channel tag.
// With the switch off the loader always uses the builtin bundle and no network
// requests are made.

export const hotUpdateEnabled = false;

/** Fixed channel tag on GitHub Releases; the manifest is replaced in-place by CI. */
export const bundleManifestUrl =
	"https://github.com/mediago-dev/mediago-drama/releases/download/bundle-beta/bundle-manifest.json";

/** Ed25519 public key, base64-encoded SPKI DER. Empty disables verification AND updates. */
export const bundleUpdatePublicKey = "";

export const manifestFetchTimeoutMs = 15_000;
export const downloadTimeoutMs = 300_000;

/** How long the freshly spawned server may take to answer /health before rollback. */
export const serverHealthTimeoutMs = 30_000;

/** Grace period for the old server to drain in-flight requests before SIGKILL. */
export const serverStopGraceMs = 8_000;
