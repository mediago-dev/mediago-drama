import { generateKeyPairSync } from "node:crypto";

// One-time Ed25519 keypair generation for renderer hot updates.
//
// Run locally: node scripts/generate-hot-update-keys.ts
//
// Then:
//   1. Store the PRIVATE key as the GitHub Actions secret RENDERER_UPDATE_PRIVATE_KEY
//      (repository settings → Secrets and variables → Actions). Never commit it.
//   2. Paste the PUBLIC key into rendererUpdatePublicKey in
//      electron/src/hot-update-config.ts and set hotUpdateEnabled = true.
//   3. Losing the private key means shipping a full release to rotate the public key —
//      back it up in the team password manager.

const { publicKey, privateKey } = generateKeyPairSync("ed25519");

const publicDer = publicKey.export({ format: "der", type: "spki" }).toString("base64");
const privateDer = privateKey.export({ format: "der", type: "pkcs8" }).toString("base64");

console.log("== renderer hot-update keypair ==\n");
console.log("PUBLIC key (paste into electron/src/hot-update-config.ts rendererUpdatePublicKey):\n");
console.log(publicDer);
console.log("\nPRIVATE key (GitHub secret RENDERER_UPDATE_PRIVATE_KEY — do NOT commit):\n");
console.log(privateDer);
