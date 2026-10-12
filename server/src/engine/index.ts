// Engine public surface (see .datasim-v2/CONTRACTS.md).
export { startRun, startStrategyCompare, cancelRun, recoverStaleRuns, resolveRun, definedVariants, RUN_LOCK } from './run.js';
export type { StartRunArgs } from './run.js';
export { loadReport, listRuns, loadSummary } from './store.js';
export { provisionSandbox, testTransaction, sandboxQuery } from './sandboxOps.js';
export { provision, inferGenerator, totalSeedRows } from './provision.js';
export { runLoad, targetVus } from './load.js';
export { classifyError, actionFor } from './classify.js';
export { reportToMarkdown, reportToCsv } from './exportReport.js';
export { sandboxName } from './admin.js';
export { getActiveRunId } from './active.js';
