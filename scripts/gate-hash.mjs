#!/usr/bin/env node
/**
 * Print the SHA-256 hex of a passphrase, for the page's access gate.
 *
 * Usage:
 *   node scripts/gate-hash.mjs 'the new password'
 *
 * Paste the printed hash into `src/gate.ts` (DEFAULT_HASH) or set it as the
 * VITE_GATE_HASH build env var / GitHub Actions secret. The plaintext password
 * is never stored — only this hash — so keep the password itself somewhere the
 * team shares (a vault, not the repo).
 *
 * NOTE: this gate is deliberately light. It keeps casual visitors out of the
 * page UI on a public GitHub Pages URL; it is NOT strong security. The
 * generated dashboard-data.json is still publicly fetchable by URL.
 */
import { createHash } from 'node:crypto';

const password = process.argv[2];
if (!password) {
  console.error("Usage: node scripts/gate-hash.mjs '<password>'");
  process.exit(1);
}

const hash = createHash('sha256').update(password, 'utf8').digest('hex');
console.log(hash);
