# Decisions
- Docker Desktop was stopped at start; launched it programmatically (Windows). Baseline server+web tests green on v1.
- FEATURE_FREEZE 04:30 IST, HARD_STOP 07:00 IST (brief gave no times).
- Reference screenshot lives at docs/desgin/image.png (typo'd dir); used as design reference, not renamed.
- Existing migrations 001-004 (scenario_*) stay as files (001 untouched; 002-004 alter scenario tables so fresh DBs still migrate); v2 meta schema is migration 005. Same version table `scenario_schema_migration` is reused (renamed in meaning only).
- Retired server routes: accounts, playback, sim, scenarios, info(+checks). Kept services/playback+accountState (lab/stepper/strategies depend on them) but no UI route; leaseReaper removed.
- shared package consumed as TS source (main -> src/index.ts); no build step.
