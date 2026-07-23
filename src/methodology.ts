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
        <h3>The traffic-light rubric</h3>
        <p>The red / yellow / green color is this rubric applied to the official score (below):</p>
        <ul class="methodology-dialog__rubric">
          <li><span class="dot dot--red"></span> <strong>Red</strong> — 0–40%</li>
          <li><span class="dot dot--yellow"></span> <strong>Yellow</strong> — 41–79%</li>
          <li><span class="dot dot--green"></span> <strong>Green</strong> — 80–100%</li>
        </ul>

        <h3>The official score</h3>
        <p>
          Each site shows a single <strong>official score</strong>. When more than one source
          has a number, the most authoritative one wins, in this order:
        </p>
        <ol class="methodology-dialog__chain">
          <li><strong>Team score</strong> — a manual score set by the accessibility team, with a written justification. Overrides everything.</li>
          <li><strong>Auditor score</strong> — from a comprehensive <em>manual</em> Axe Auditor test, when one has been done.</li>
          <li><strong>axe Monitor</strong> — automated scan (Deque). Also our source for grouping sites by agency.</li>
          <li><strong>SiteImprove</strong> — automated scan, our second source of coverage.</li>
          <li>If none of the above exists, the site is <strong>Not scored</strong>.</li>
        </ol>
        <p>
          The <strong>?full</strong> view shows every underlying source side by side; the default
          view shows only the official score and, in the <strong>Notes</strong> column, where it
          came from — a rationale tooltip for a team override, or a link to an auditor report.
        </p>

        <h3>Automated testing catches ~30% of issues</h3>
        <p>
          The axe Monitor and SiteImprove scores are <strong>automated</strong>. Automated tools
          reliably detect only about <strong>30%</strong> of accessibility barriers. The remaining
          ~70% — keyboard traps, meaningful reading order, whether alt text is <em>correct</em>,
          screen-reader usability of complex widgets — require <strong>manual review by a person</strong>.
          The team and auditor scores come from exactly that kind of manual review.
        </p>
        <p class="methodology-dialog__callout">
          A green automated score means <strong>“no automated blockers detected,”</strong> not
          “this site is accessible.” Do not treat any number here as a compliance determination.
        </p>

        <h3>The “blocked” flag</h3>
        <p>
          A site is <strong>blocked</strong> when it could not be scanned or scored at all (for
          example, it sits behind authentication). Blocked no longer forces a Red color — a site
          with no score is simply counted as <strong>Not scored</strong>. The reason a site was
          blocked is kept as an internal note and is not shown here.
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
