# DataSim v2: morning report

**Status: complete.** Tier 1 and Tier 2 are done (two Tier 2 items cut, listed below), Tier 3 is cut. Branch `v2` is committed (tag `v1-friend` marks the old main; `main` was never touched). Docker was available the whole time, so everything was verified against real MySQL 8.4 and Redis 7.

## How to run
```bash
npm ci
npm run demo          # Docker (MySQL + Redis) -> migrations -> templates -> API + web (production build); open http://localhost:5173/DataSim/
npm run doctor        # preflight
npm run demo:prime    # ~5 min, optional: pre-runs every demo run (fallback reports)
```
Demo script: [docs/DEMO.md](docs/DEMO.md). Everything-explained PDF for presenting: [docs/DataSim_Project_Explainer.pdf](docs/DataSim_Project_Explainer.pdf). Viva answers: [docs/VIVA.md](docs/VIVA.md).

## Tiers
| Tier | Item | Status |
| --- | --- | --- |
| 1 | Real sandbox DDL + seeding, workload engine (topology, LB, app queues, pools, real Redis cache), live metrics, report, invariants, findings, SLO verdict | Done |
| 1 | Capacity test + hand-written USL fit + knee + Little's-law check | Done |
| 1 | Compare (2-5 runs, design diff), T1 + T2 templates, Studio, Schema Designer, Workload Editor + Test once | Done |
| 1 | Concurrency Lab + Transaction Stepper reskin, exports (MD/CSV/DDL/PNG), docs | Done |
| 2 | Compare strategies one click, normalization assistant, DDL import, SQL console, T3 + T4, command palette, PNG export, live invariant sampling, "Which database fits?" card | Done |
| 2 | Stepper on project templates | **Cut** |
| 2 | Invariants sampled every 5 s are shown live but not persisted per sample (final post-run check is the persisted result) | Partial by design |
| 3 | Read replica, PostgreSQL adapter | **Cut** (never shown as placeholders) |

## What was verified (final state)
| Check | Result |
| --- | --- |
| `npm run typecheck` | clean |
| `npm test` | shared 19, server 183 (+2 skipped), web 192 passing |
| `npm -w web run build` | clean |
| `npm run e2e` (Playwright, Chromium, 1440x900) | 7 flows pass in about 1.7 min: naive-vs-atomic-vs-compare, schema designer, workload editor (Test once), capacity + USL, index advisor (apply fix, re-run), Lab, Stepper; console clean in each |
| Fresh clone (`git clone --branch v2`, `npm ci`, brand-new Docker volume, e2e flow 1 which starts `npm run demo` itself) | passes |
| Independent reviewer (fresh agent) walked docs/DEMO.md through the real UI | ~45 issues found, all HIGH and the important MEDIUM fixed (see `.datasim-v2/QA_REVIEW.md`) |
| UI numbers vs `GET /api/runs/:id` | matched |

Demo numbers measured on the dev laptop (150 VUs spike): naive ~450 tps, p95 ~300 ms, FAIL, ~45 invariant violations; atomic ~650 tps, p95 ~68 ms, 0 violations, PASS; index advisor: statement avg ~6.5 -> ~1.8 ms, rows examined ~25M -> ~1.7M; capacity knee ~450 VUs, projected peak ~1,850 tps (R2 ~0.98). Run-to-run variance is large; the shape is stable.

## Known issues and workarounds
* **Run-to-run variance:** naive p95 ranged 246-675 ms across runs. Narrate the shape (naive violates, atomic does not), not exact numbers. The verdict FAILs whenever an invariant is violated, so the naive beat never silently passes.
* **Index step:** the statement-level effect is large, the end-to-end p95 effect is smaller because contention on popular sections becomes the next bottleneck. DEMO.md tells you to say this.
* **Reload mid-run** restores phase and node pills, but the live charts restart (samples are persisted at the end). Starting a Studio tab mid-run attaches to the run.
* **Lab hangs?** Open Stepper transactions hold row locks on `account`; leaving the Stepper page resets them.
* **Dev server:** `npm run demo` serves the production build (stable). `DEMO_DEV=1 npm run demo` uses Vite dev with HMR, which can double-load a module after edits.
* **T1 deviates from the brief on purpose:** 24,000 sections (brief: 1,200), 36 slots, 150 VUs, `STRAIGHT_JOIN` in `search_sections`, capacity steps 50-500: needed so the advisor finding and the capacity knee actually occur on a laptop (see DECISIONS.md).
* **Light theme** works; dark is the default and the demo theme.
* **Projects list** shows only the latest "(primed)" project; test projects were archived.
* **Push:** `git push -u origin v2` succeeded (branch `v2` is on origin; `main` untouched).

## Screenshot list
`docs/pdf/*.png` (projects, studio idle/naive/findings, schema designer, workload editor, report naive/capacity, compare, runs, lab, stepper) and `.datasim-v2/screens/*.png` (e2e flows). Docs: README, ARCHITECTURE, DATABASE_DESIGN, DEMO, REVIEW1_TRACEABILITY, VIVA, `docs/archive/` (retired v1 docs). State files: `.datasim-v2/{PLAN,PROGRESS,DECISIONS,CONTRACTS,QA_REVIEW}.md`.

## 10-minute morning checklist
1. Start Docker Desktop; `npm ci` if needed; `npm run doctor` (all ok).
2. `npm run demo`; open http://localhost:5173/DataSim/ and check the green health dot.
3. Open Runs: the "Course Registration Rush (primed)" runs exist (naive, atomic, atomic + index, capacity). If not, run `npm run demo:prime` once (about 5 min).
4. Rehearse DEMO.md steps 5-9 once live (about 4 minutes of runs). Re-run `naive` if the first run is unusually healthy.
5. Skim `docs/DataSim_Project_Explainer.pdf` (17 pages) and `docs/VIVA.md`.
6. Close other heavy apps before presenting (shared CPU makes numbers noisier).
7. Read `docs/REVIEW1_TRACEABILITY.md` for the three honest "partial" items (crowd pause/resume replaced by start/cancel; v1 lease reaper retired; no per-account event timeline).
