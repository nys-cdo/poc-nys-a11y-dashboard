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
 *
 * Built from NYSDS components (nys-textinput, nys-button) — they're registered
 * by the `@nysds/components` import in main.ts before this runs.
 */

// SHA-256 of the default password "nys-a11y-2026". CHANGE THIS before real use.
const DEFAULT_HASH = 'f319719f15b23a569d088ba7a329fb6c106da12506b05deddd1ec455d105ee5e';

const EXPECTED_HASH = (import.meta.env.VITE_GATE_HASH ?? DEFAULT_HASH).trim().toLowerCase();

// Unlocking is remembered in a long-lived cookie so a visitor stays in across
// tabs and browser restarts. The cookie VALUE is the expected hash, so rotating
// the password (a new hash) invalidates every existing unlock automatically.
const COOKIE_NAME = 'nys-a11y-gate';
const GATE_MAX_AGE_DAYS = 30;

function readGateCookie(): string | null {
  const row = document.cookie
    .split('; ')
    .find((c) => c.startsWith(`${COOKIE_NAME}=`));
  return row ? decodeURIComponent(row.slice(COOKIE_NAME.length + 1)) : null;
}

function writeGateCookie(value: string): void {
  const maxAge = GATE_MAX_AGE_DAYS * 24 * 60 * 60;
  // Secure only over HTTPS so local http://localhost previews still persist.
  const secure = location.protocol === 'https:' ? '; Secure' : '';
  document.cookie = `${COOKIE_NAME}=${encodeURIComponent(value)}; Max-Age=${maxAge}; Path=/; SameSite=Lax${secure}`;
}

/** The bits of nys-textinput we drive imperatively. */
interface NysTextinput extends HTMLElement {
  value: string;
  showError: boolean;
  errorMessage: string;
}

async function sha256Hex(text: string): Promise<string> {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Resolves `true` once the visitor unlocks a freshly-shown gate, or `false`
 * immediately when a valid unlock cookie is already present (so the caller can
 * decide whether to move focus into the app afterward).
 */
export function requireGate(): Promise<boolean> {
  if (readGateCookie() === EXPECTED_HASH) return Promise.resolve(false);

  return new Promise<boolean>((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'gate';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-labelledby', 'gate-title');
    overlay.setAttribute('aria-describedby', 'gate-desc');
    overlay.innerHTML = `
      <div class="gate__card">
        <p class="gate__eyebrow">New York State · ITS</p>
        <h1 id="gate-title" class="gate__title">Statewide Accessibility Dashboard</h1>
        <p id="gate-desc" class="gate__desc">This internal preview is password-protected. Enter the access password to continue.</p>
        <nys-textinput
          id="gate-input"
          class="gate__input"
          label="Access password"
          type="password"
          name="gate"
        ></nys-textinput>
        <nys-button
          id="gate-submit"
          type="button"
          label="View dashboard"
          fullWidth
        ></nys-button>
        <p id="gate-live" class="visually-hidden" role="alert" aria-live="assertive"></p>
      </div>
    `;

    // Snapshot the existing body children (before appending the overlay) and
    // mark them inert while the gate is up: focus and assistive tech stay inside
    // the gate, honoring aria-modal without a hand-rolled focus trap.
    const behind = [...document.body.children];
    document.body.appendChild(overlay);
    document.body.style.overflow = 'hidden';
    for (const el of behind) el.setAttribute('inert', '');

    const input = overlay.querySelector('#gate-input') as NysTextinput;
    const submit = overlay.querySelector('#gate-submit')!;
    const live = overlay.querySelector('#gate-live') as HTMLParagraphElement;

    // Once the component upgrades: focus the field and set password-field hints
    // on its inner input. nys-textinput exposes no autocomplete pass-through, so
    // set them directly — password managers and paste (WCAG 3.3.8 Accessible
    // Authentication) rely on autocomplete="current-password".
    void customElements.whenDefined('nys-textinput').then(() => {
      const native = input.shadowRoot?.querySelector('input');
      native?.setAttribute('autocomplete', 'current-password');
      native?.setAttribute('autocapitalize', 'off');
      native?.setAttribute('spellcheck', 'false');
      input.focus();
    });

    const fail = (msg: string): void => {
      input.errorMessage = msg;
      input.showError = true;
      input.value = '';
      // The field is already focused on the Enter path, so its aria-describedby
      // error won't be re-announced; mirror the message into a live region.
      live.textContent = msg;
      input.focus();
    };

    // Guards the in-flight hash: ignore repeat submits until the async
    // comparison settles.
    let pending = false;
    const attemptUnlock = (): void => {
      if (pending) return;
      const value = input.value;
      if (!value) {
        fail('Enter the password to continue.');
        return;
      }
      pending = true;
      void sha256Hex(value).then((hash) => {
        pending = false;
        if (hash === EXPECTED_HASH) {
          writeGateCookie(EXPECTED_HASH);
          overlay.remove();
          document.body.style.overflow = '';
          for (const el of behind) el.removeAttribute('inert');
          resolve(true);
        } else {
          fail('That password is not correct. Try again.');
        }
      });
    };

    submit.addEventListener('nys-click', attemptUnlock);
    // Clear the error as soon as the visitor edits the field again.
    input.addEventListener('nys-input', () => {
      if (input.showError) input.showError = false;
      if (live.textContent) live.textContent = '';
    });
    // Enter in the field submits (nys-textinput emits no submit event). Listener
    // is on the field only — button-Enter goes through nys-click, so no double
    // fire.
    input.addEventListener('keydown', (e) => {
      if ((e as KeyboardEvent).key === 'Enter') {
        e.preventDefault();
        attemptUnlock();
      }
    });
  });
}
