/**
 * Lightweight page access gate.
 *
 * The dashboard deploys to a public GitHub Pages URL. This gate keeps casual
 * visitors out of the page UI by requiring a shared password before the app
 * renders. It is DELIBERATELY not strong security — the password's SHA-256 hash
 * ships in the built JS, and the generated `dashboard-data.json` is still
 * fetchable by URL. Per the team: the data isn't privileged; we just don't want
 * the page open to anyone who stumbles on the link.
 *
 * The expected hash comes from the `VITE_GATE_HASH` build env var (set it as a
 * GitHub Actions secret to keep the real password out of the repo) or falls back
 * to the default below. Change the password with:
 *   node scripts/gate-hash.mjs 'new password'
 * then paste the hash into DEFAULT_HASH or the env var.
 */

// SHA-256 of the default password "nys-a11y-2026". CHANGE THIS before real use.
const DEFAULT_HASH = 'f319719f15b23a569d088ba7a329fb6c106da12506b05deddd1ec455d105ee5e';

const EXPECTED_HASH = (import.meta.env.VITE_GATE_HASH ?? DEFAULT_HASH).trim().toLowerCase();

// Per-tab: unlocking survives reloads within the session but re-prompts in a new
// browsing session.
const SESSION_KEY = 'nys-a11y-gate';

async function sha256Hex(text: string): Promise<string> {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Resolve once the visitor is allowed through. If already unlocked this session,
 * resolves immediately; otherwise renders a password overlay and resolves when
 * the correct password is entered.
 */
export function requireGate(): Promise<void> {
  if (sessionStorage.getItem(SESSION_KEY) === '1') return Promise.resolve();

  return new Promise<void>((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'gate';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-labelledby', 'gate-title');
    overlay.setAttribute('aria-describedby', 'gate-desc');
    overlay.innerHTML = `
      <form class="gate__card" novalidate>
        <p class="gate__eyebrow">New York State · ITS</p>
        <h1 id="gate-title" class="gate__title">Statewide Accessibility Dashboard</h1>
        <p id="gate-desc" class="gate__desc">This internal preview is password-protected. Enter the access password to continue.</p>
        <label class="gate__label" for="gate-input">Access password</label>
        <input class="gate__input" id="gate-input" type="password" name="gate"
               autocomplete="current-password" autocapitalize="off" spellcheck="false" />
        <p class="gate__error" id="gate-error" role="alert" hidden></p>
        <button class="gate__submit" type="submit">View dashboard</button>
      </form>
    `;
    document.body.appendChild(overlay);
    document.body.style.overflow = 'hidden';

    const form = overlay.querySelector('form') as HTMLFormElement;
    const input = overlay.querySelector('#gate-input') as HTMLInputElement;
    const error = overlay.querySelector('#gate-error') as HTMLParagraphElement;
    input.focus();

    const fail = (msg: string): void => {
      error.textContent = msg;
      error.hidden = false;
      input.value = '';
      input.setAttribute('aria-invalid', 'true');
      input.focus();
    };

    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const value = input.value;
      if (!value) {
        fail('Enter the password to continue.');
        return;
      }
      void sha256Hex(value).then((hash) => {
        if (hash === EXPECTED_HASH) {
          sessionStorage.setItem(SESSION_KEY, '1');
          overlay.remove();
          document.body.style.overflow = '';
          resolve();
        } else {
          fail('That password is not correct. Try again.');
        }
      });
    });
  });
}
