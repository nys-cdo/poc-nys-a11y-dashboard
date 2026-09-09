import { REQUEST_TEST_URL, REQUEST_TEST_CONFIGURED } from '../config';
import { esc } from '../format';

/**
 * "Request an accessibility test" — the dashboard's one call to action. A
 * native <dialog> that says what a test covers and what to send, then hands
 * off to the configured intake destination (see src/config.ts). Optional
 * context (a domain, a portfolio) is folded into the hand-off so a DCT can
 * ask for a specific site from its row.
 */
let dialog: HTMLDialogElement | null = null;

export interface RequestContext {
  domain?: string;
  agency?: string;
  dct?: string;
}

function destination(ctx: RequestContext): string {
  if (!REQUEST_TEST_URL.startsWith('mailto:')) return REQUEST_TEST_URL;
  // Pre-fill the email body with whatever the caller already knows.
  const url = new URL(REQUEST_TEST_URL);
  let body = url.searchParams.get('body') ?? '';
  if (ctx.domain) body = body.replace('Site URL:', `Site URL: https://${ctx.domain}/`);
  if (ctx.agency) body = body.replace('Agency:', `Agency: ${ctx.agency}`);
  if (ctx.dct) body = body.replace('DCT portfolio:', `DCT portfolio: ${ctx.dct}`);
  url.searchParams.set('body', body);
  return url.toString();
}

function buildDialog(): HTMLDialogElement {
  const el = document.createElement('dialog');
  el.className = 'methodology-dialog request-dialog';
  el.setAttribute('aria-labelledby', 'request-title');
  el.innerHTML = `
    <div class="methodology-dialog__inner">
      <div class="methodology-dialog__header">
        <h2 id="request-title">Request an accessibility test</h2>
        <button type="button" class="methodology-dialog__close" aria-label="Close">✕</button>
      </div>
      <div class="methodology-dialog__body">
        <p id="request-context" class="request-dialog__context" hidden></p>
        <p>
          The ITS accessibility team runs a <strong>comprehensive manual test</strong> with
          Axe Auditor: a person works through the site with a keyboard and screen reader and
          scores it against WCAG 2.2 AA. The result replaces the automated score on this
          dashboard and comes with a prioritized list of fixes, which is the input a team needs
          to size remediation work.
        </p>
        <h3>What to include</h3>
        <ul class="request-dialog__list">
          <li>The site URL, and whether it is production, staging, or behind a login.</li>
          <li>The agency and DCT portfolio.</li>
          <li>A contact on the site's team who can grant access and answer questions.</li>
          <li>A target date or the planning cycle the results feed.</li>
          <li>Anything already known: a recent redesign, complaints, prior audits.</li>
        </ul>
        ${
          REQUEST_TEST_CONFIGURED
            ? ''
            : `<p class="methodology-dialog__callout">
                No intake destination is configured yet, so the button opens a pre-filled email
                with no recipient. Set <code>VITE_REQUEST_TEST_URL</code> at build time to point
                it at the intake form or the team mailbox.
              </p>`
        }
        <p class="request-dialog__actions">
          <a id="request-go" class="request-dialog__button" href="${esc(REQUEST_TEST_URL)}" target="_blank" rel="noopener">
            Start a request
          </a>
        </p>
      </div>
    </div>
  `;
  el.querySelector('.methodology-dialog__close')?.addEventListener('click', () => el.close());
  el.addEventListener('click', (e) => {
    if (e.target === el) el.close();
  });
  return el;
}

export function openRequestTest(ctx: RequestContext = {}): void {
  const root = document.getElementById('methodology-root');
  if (!root) return;
  if (!dialog) {
    dialog = buildDialog();
    root.appendChild(dialog);
  }
  const context = dialog.querySelector<HTMLElement>('#request-context')!;
  const parts: string[] = [];
  if (ctx.domain) parts.push(`<strong>${esc(ctx.domain)}</strong>`);
  if (ctx.agency) parts.push(esc(ctx.agency));
  if (ctx.dct) parts.push(`${esc(ctx.dct)} portfolio`);
  context.hidden = parts.length === 0;
  context.innerHTML = parts.length ? `For: ${parts.join(' · ')}` : '';
  dialog.querySelector<HTMLAnchorElement>('#request-go')!.href = destination(ctx);
  dialog.showModal();
}
