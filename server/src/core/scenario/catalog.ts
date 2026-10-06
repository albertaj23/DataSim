/**
 * Scenario metadata is deliberately independent from the MySQL tables used by a scenario.
 * It is the first stable product contract for the general workbench: execution adapters may
 * evolve, while links, concepts, invariant wording, and evidence mode remain versioned.
 */
export type ScenarioRunMode = 'LIVE_DBMS' | 'GUIDED_SCHEDULE' | 'CONCEPT_MODEL';

export interface ScenarioDefinition {
  id: string;
  revision: number;
  title: string;
  description: string;
  question: string;
  invariant: { description: string; checkKind: 'SQL_ASSERTION' | 'FINAL_VALUE' | 'SCENARIO_PROPERTY' };
  concepts: string[];
  runModes: ScenarioRunMode[];
  status: 'READY';
  entryPath: string;
}

export const scenarioCatalog: readonly ScenarioDefinition[] = [
  {
    id: 'stream-limit', revision: 1,
    title: 'Concurrent session limit',
    description: 'A predicate race: several requests decide whether a shared capacity has room.',
    question: 'Can several requests enter a shared limit at the same time?',
    invariant: { description: 'Active sessions must stay at or below the configured limit.', checkKind: 'SQL_ASSERTION' },
    concepts: ['write skew', 'isolation', 'locks'],
    runModes: ['LIVE_DBMS', 'GUIDED_SCHEDULE'], status: 'READY', entryPath: '/stress',
  },
  {
    id: 'lost-update', revision: 1,
    title: 'Shared counter',
    description: 'A read-modify-write race on one shared value.',
    question: 'What happens when many transactions update one value?',
    invariant: { description: 'Every accepted increment must be represented in the final count.', checkKind: 'FINAL_VALUE' },
    concepts: ['lost update', 'atomic update', 'compare and set'],
    runModes: ['LIVE_DBMS'], status: 'READY', entryPath: '/stress?exp=count',
  },
  {
    id: 'transaction-schedules', revision: 1,
    title: 'Transaction schedules',
    description: 'Two real MySQL transactions are advanced one statement at a time.',
    question: 'Which statement order produces a wait, abort, or deadlock?',
    invariant: { description: 'The selected scenario property is checked after both transactions finish.', checkKind: 'SCENARIO_PROPERTY' },
    concepts: ['deadlock', 'serializability', 'recovery'],
    runModes: ['GUIDED_SCHEDULE'], status: 'READY', entryPath: '/runs?tab=stepper',
  },
  {
    id: 'playback-coordination', revision: 1,
    title: 'Playback coordination example',
    description: 'The original DataSim application example, retained as a concrete domain package.',
    question: 'How does a multi-device application apply these controls?',
    invariant: { description: 'Only the allowed number of active device sessions may hold a lease.', checkKind: 'SQL_ASSERTION' },
    concepts: ['leases', 'fencing', 'real-time state'],
    runModes: ['LIVE_DBMS'], status: 'READY', entryPath: '/devices',
  },
];

export const findScenario = (id: string) => scenarioCatalog.find((scenario) => scenario.id === id);
