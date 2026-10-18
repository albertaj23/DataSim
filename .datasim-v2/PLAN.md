# DataSim v2 plan (source of truth: DATASIM_V2_BRIEF.md — re-read it + PROGRESS.md after any compaction/restart)

Clock: IST. Started 2026-10-12 22:20. FEATURE_FREEZE 04:30. HARD_STOP 07:00 (MORNING_REPORT by 06:40).
Phases: P0 recon -> P1 foundations (lead) -> P2 core (A engine, B studio, C editors, D templates) -> vertical-slice gate
-> P3 depth (F report/compare/capacity UI, G lab+stepper reskin, E tier2) -> P4 QA -> P5 docs.
Contracts live in `shared/src` (zod). Subagents own disjoint paths; lead owns package.json, shared/, migrations.
