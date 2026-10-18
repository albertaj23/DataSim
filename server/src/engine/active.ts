// The one active run (global). The engine sets it; /api/health reports it. Cross-process exclusion uses a MySQL named lock.
let active: string | null = null;
export const getActiveRunId = () => active;
export const setActiveRunId = (id: string | null) => { active = id; };
