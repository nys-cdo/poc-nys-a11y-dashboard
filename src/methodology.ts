/**
 * Methodology explainer (PRD §5.4). Uses a native <dialog> for a
 * keyboard-accessible, focus-trapping modal without guessing a component API.
 * Content spells out the 30% caveat, the signal hierarchy, the blocked flag,
 * and the conflict rule so a leadership reader understands what a color means.
 */

let dialog: HTMLDialogElement | null = null;

function buildDialog(): HTMLDialogElement {
  const el = document.createElement('dialog');
  el.className = 'methodology-dialog';
  el.setAttribute('aria-labelledby', 'methodology-title');
  el.innerHTML = `
    <div class="methodology-dialog__inner">
      <div class="methodology-dialog__header">
        <h2 id="methodology-title">How to read this dashboard</h2>
        <button type="button" class="methodology-dialog__close" aria-label="Close methodology">✕</button>
      </div>
      <div class="methodology-dialog__body">
        <h3>Automated testing catches ~30% of issues</h3>
        <p>
          Every score on this dashboard comes from <strong>automated scanning</strong>
          (axe Monitor and SiteImprove). Automated tools reliably detect only about
          <strong>30%</strong> of accessibility barriers. The remaining ~70% — keyboard
          traps, meaningful reading order, whether alt text is <em>correct</em>, screen-reader
          usability of complex widgets — require <strong>manual review by a person</strong>.
        </p>
        <p class="methodology-dialog__callout">
          A green score means <strong>“no automated blockers detected,”</strong> not
          “this site is accessible.” Do not treat any number here as a compliance determination.
        </p>

        <h3>Three signals, shown side by side</h3>
        <p>Each site can carry up to three scores. We deliberately do not blend them into one number:</p>
        <ul>
          <li><strong>axe Monitor</strong> — automated scan (Deque). Also our authoritative source for grouping sites by agency.</li>
          <li><strong>SiteImprove</strong> — automated scan, second source of coverage.</li>
          <li><strong>Axe Auditor</strong> — score from a comprehensive <em>manual</em> test, when one has been done. Expect this to be lower than the automated scores; that gap is informative, not an error.</li>
        </ul>

        <h3>The traffic-light rubric</h3>
        <p>Status color is driven by the automated score — the authoritative axe Monitor score when present (including when both tools scanned a site), otherwise SiteImprove:</p>
        <ul class="methodology-dialog__rubric">
          <li><span class="dot dot--red"></span> <strong>Red</strong> — 0–40%</li>
          <li><span class="dot dot--yellow"></span> <strong>Yellow</strong> — 41–79%</li>
          <li><span class="dot dot--green"></span> <strong>Green</strong> — 80–100%</li>
        </ul>

        <h3>The “blocked” flag overrides everything</h3>
        <p>
          When the team knows a site has a serious blocking barrier that automation missed,
          it is flagged <strong>blocked</strong> and renders <strong>Red regardless of its
          score</strong>. The original automated number still shows, so the gap between
          “scored 85%” and “flagged blocked” is visible.
        </p>

        <h3>Conflict badge</h3>
        <p>
          A site’s URL should appear in only one scanning tool. When the same URL shows up in
          <em>both</em> axe Monitor and SiteImprove, we flag it as a <strong>conflict</strong>
          rather than averaging the scores. The team resolves these by hand.
        </p>

        <h3>Unattributed</h3>
        <p>
          Sites whose owning agency could not be resolved are grouped as
          <strong>Unattributed</strong>. This bucket will shrink over time as attribution improves.
        </p>

        <h3>Scope</h3>
        <p>
          This is a <strong>point-in-time snapshot</strong>, refreshed manually. It shows
          site/domain-level results only — no page-level detail, no historical trend, and no
          PDF accessibility data (all out of scope for this phase).
        </p>
      </div>
    </div>
  `;

  el.querySelector('.methodology-dialog__close')?.addEventListener('click', () =>
    el.close(),
  );
  // Close when the backdrop (the dialog element itself, outside its inner box) is clicked.
  el.addEventListener('click', (e) => {
    if (e.target === el) el.close();
  });
  return el;
}

export function openMethodology(): void {
  const root = document.getElementById('methodology-root');
  if (!root) return;
  if (!dialog) {
    dialog = buildDialog();
    root.appendChild(dialog);
  }
  dialog.showModal();
}
