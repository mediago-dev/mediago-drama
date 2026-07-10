// Application-bundle (renderer + server) hot-update rollout switch and trust anchors.
//
// ⚠️ hotUpdateEnabled must stay false until:
//   1. the Ed25519 release keypair exists (private key in GitHub Actions secrets),
//   2. bundleUpdatePublicKey below is filled with the matching public key,
//   3. a full installer carrying that key is published to desktop-<channel>-<edition>,
//   4. only then, the bundle-hot-release pipeline publishes a signed manifest.
// With the switch off the loader always uses the builtin bundle and no network
// requests are made.

export const hotUpdateEnabled = false;

const bundleReleaseBaseUrl = "https://github.com/mediago-dev/mediago-drama/releases/download";

/**
 * Return the signed-manifest URL for one immutable client cohort.
 *
 * Channel and edition come from the builtin bundle metadata that was compiled
 * into the full installer. Keeping both values in the tag prevents a Pro shell
 * from ever polling a community manifest (or vice versa).
 */
export function bundleManifestUrlFor(channel: string, edition: string): string {
	if (!/^[a-z0-9-]+$/.test(channel)) throw new Error(`invalid bundle channel: ${channel}`);
	if (!/^[a-z0-9-]+$/.test(edition)) throw new Error(`invalid bundle edition: ${edition}`);
	return `${bundleReleaseBaseUrl}/bundle-${channel}-${edition}/bundle-manifest.json`;
}

/** Ed25519 public key, base64-encoded SPKI DER. Empty disables verification AND updates. */
export const bundleUpdatePublicKey = "";

export const manifestFetchTimeoutMs = 15_000;
export const downloadTimeoutMs = 300_000;

/** How long the freshly spawned server may take to answer /health before rollback. */
export const serverHealthTimeoutMs = 30_000;

/** Grace period for the old server to drain in-flight requests before SIGKILL. */
export const serverStopGraceMs = 8_000;
