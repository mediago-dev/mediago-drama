// Renderer hot-update rollout switch and trust anchors.
//
// ⚠️ hotUpdateEnabled must stay false until:
//   1. the Ed25519 release keypair exists (private key in GitHub Actions secrets),
//   2. rendererUpdatePublicKey below is filled with the matching public key,
//   3. the renderer-hot-release pipeline publishes signed manifests to the channel tag.
// With the switch off the loader always uses the builtin renderer and no network
// requests are made.

export const hotUpdateEnabled = false;

/** Fixed channel tag on GitHub Releases; assets are replaced in-place by CI. */
export const rendererManifestUrl =
	"https://github.com/mediago-dev/mediago-drama/releases/download/renderer-beta/renderer-manifest.json";

/** Ed25519 public key, base64-encoded SPKI DER. Empty disables verification AND updates. */
export const rendererUpdatePublicKey = "";

export const manifestFetchTimeoutMs = 15_000;
export const downloadTimeoutMs = 120_000;
