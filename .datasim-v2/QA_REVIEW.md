# Independent QA review (summary)

An independent reviewer walked docs/DEMO.md through the real UI (Playwright, 1440x900) and probed every screen. No console errors, no NaN/undefined/[object Object] on any online screen, UI numbers matched `GET /api/runs/:id`.

Fixed after the review (see DECISIONS.md and git log "fix:" commits):
- H1 capacity projection guard (no peak claim without observed saturation)
- H2 demo serves the production build by default (dev-server HMR double-load risk)
- H3 invalid-drop toast anywhere over a node
- H4 bottleneck detection in ordinary load runs
- H5 verdict FAILs on invariant violations
- M1 compare order, M2 docs, M3 attach to an active run, M5 compare-strategies progress, M6/M7 findings and lock tabs reuse the report components, M8 offline copy, M9 light-theme minimap, M10/M11 layout and card size, M12-M18 labels/units/scope fixes, L2/L3/L6/L9/L11/L13

Left as known (documented in MORNING_REPORT.md): reload mid-run restarts the live charts (history is not persisted until the run ends), digest text token spacing, a cancelled run keeps partial KPIs, run-to-run variance (naive p95 ranged 246-675 ms; the shape is stable).
