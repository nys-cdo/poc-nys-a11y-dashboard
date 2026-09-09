/**
 * Build-time configuration that is safe to ship to the client. Values come
 * from `VITE_*` environment variables (a `.env` locally, repository variables
 * or secrets in the GitHub Actions deploy) with a working fallback for each.
 */

const REQUEST_SUBJECT = 'Request an accessibility test';
const REQUEST_BODY = [
  'Site URL:',
  'Agency:',
  'DCT portfolio:',
  'Environment (production / staging / behind login):',
  'Contact for the site team:',
  'Target date or planning cycle:',
  'Anything already known (recent redesign, complaints, prior audits):',
].join('\n');

/**
 * Where "Request an accessibility test" sends people. Set
 * `VITE_REQUEST_TEST_URL` to the intake form (or a `mailto:` for the
 * accessibility team). Until it is set, the link opens a pre-filled email with
 * no recipient, so the button still works and the required details are
 * captured.
 */
export const REQUEST_TEST_URL: string =
  import.meta.env.VITE_REQUEST_TEST_URL?.trim() ||
  `mailto:?subject=${encodeURIComponent(REQUEST_SUBJECT)}&body=${encodeURIComponent(REQUEST_BODY)}`;

/** True when the destination was configured (not the no-recipient fallback). */
export const REQUEST_TEST_CONFIGURED = Boolean(import.meta.env.VITE_REQUEST_TEST_URL?.trim());
