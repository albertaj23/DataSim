import { DesignDoc } from '@datasim/shared';
import { DT3, INT, SMALLINT, TINYINT, POS, char, col, decimal, edge, fkRef, fromTable, pattern, pick, uniformInt, varchar } from './dsl.js';

const SLOTS = ['A1', 'B1', 'C1', 'D1', 'E1', 'F1', 'G1', 'TA1', 'TB1', 'TC1', 'TD1', 'TE1', 'TF1', 'TG1', 'A2', 'B2', 'C2', 'D2', 'E2', 'F2', 'G2', 'TA2', 'TB2', 'TC2', 'TD2', 'TE2', 'TF2', 'TG2', 'L1', 'L2', 'L3', 'L4', 'L5', 'L6', 'L7', 'L8'];

/** Lookup step shared by the register variants: counter, capacity, version and course of one section. */
const READ_SECTION = (lock = '') => `SELECT enrolled, capacity, course_id, version FROM section WHERE section_id = :sid${lock}`;
const INSERT_ENROLLMENT = 'INSERT INTO enrollment (student_id, section_id, course_id) VALUES (:student, :sid, :$s.course_id)';
const GUARD = { left: '$s.enrolled', op: '<' as const, right: '$s.capacity', onFail: 'reject' as const };

const naive = [
  { sql: READ_SECTION(), bindAs: 's', guard: GUARD },
  { sql: INSERT_ENROLLMENT },
  { sql: 'UPDATE section SET enrolled = :$s.enrolled + 1 WHERE section_id = :sid' },
];

export function buildCourseRegistration(): DesignDoc {
  return DesignDoc.parse({
    seed: 42,
    nodes: [
      { id: 'users', type: 'users', name: 'Students', position: POS.users, config: { vus: 150, thinkMinMs: 50, thinkMaxMs: 150, thinkDist: 'uniform', pattern: 'spike', durationS: 20, warmupS: 3 } },
      { id: 'lb', type: 'lb', name: 'Load balancer', position: POS.lb, config: { algorithm: 'round-robin' } },
      { id: 'app', type: 'app', name: 'App servers', position: POS.app, config: { instances: 2, workers: 32, processingMeanMs: 2, processingJitterMs: 1, poolSize: 16, strategy: 'naive', retry: { max: 5, backoffMs: 5 } } },
      { id: 'cache', type: 'redis', name: 'Redis cache', position: POS.cache, config: { ttlS: 30 } },
      { id: 'db', type: 'mysql', name: 'MySQL', position: POS.db, config: { isolation: 'REPEATABLE READ', lockWaitTimeoutS: 3, maxExecutionTimeMs: 0 } },
    ],
    edges: [edge('users', 'lb', 2), edge('lb', 'app', 1), edge('app', 'cache', 1), edge('app', 'db', 1)],
    schema: {
      tables: [
        {
          name: 'department', seedRows: 12, position: { x: 0, y: 0 }, primaryKey: ['dept_id'],
          columns: [
            col('dept_id', INT, { ai: true }),
            col('code', varchar(8), { seed: pattern('D##') }),
            col('name', varchar(80), { seed: pattern('Department of Studies ##') }),
          ],
          uniques: [{ name: 'uq_department_code', columns: ['code'] }],
        },
        {
          name: 'student', seedRows: 20000, position: { x: 272, y: 0 }, primaryKey: ['student_id'],
          columns: [
            col('student_id', INT, { ai: true }),
            col('reg_no', char(9), { seed: pattern('2#BCE####') }),
            col('name', varchar(80), { seed: { kind: 'personName' } }),
            col('dept_id', INT, { seed: fkRef('department', 'dept_id') }),
            col('year', TINYINT, { seed: uniformInt(1, 5) }),
            col('cgpa', decimal(4, 2), { seed: { kind: 'decimalRange', min: 5, max: 10, scale: 2 } }),
          ],
          uniques: [{ name: 'uq_student_reg_no', columns: ['reg_no'] }],
          foreignKeys: [{ columns: ['dept_id'], refTable: 'department', refColumns: ['dept_id'] }],
          checks: [{ name: 'ck_student_year', expr: '`year` BETWEEN 1 AND 5' }, { name: 'ck_student_cgpa', expr: '`cgpa` BETWEEN 0 AND 10' }],
        },
        {
          name: 'faculty', seedRows: 300, position: { x: 0, y: 220 }, primaryKey: ['faculty_id'],
          columns: [
            col('faculty_id', INT, { ai: true }),
            col('name', varchar(80), { seed: { kind: 'personName' } }),
            col('dept_id', INT, { seed: fkRef('department', 'dept_id') }),
          ],
          foreignKeys: [{ columns: ['dept_id'], refTable: 'department', refColumns: ['dept_id'] }],
        },
        {
          name: 'course', seedRows: 400, position: { x: 272, y: 300 }, primaryKey: ['course_id'],
          columns: [
            col('course_id', INT, { ai: true }),
            col('code', varchar(10), { seed: pattern('CRS####') }),
            col('title', varchar(120), { seed: pattern('Course title ####') }),
            col('credits', TINYINT, { seed: uniformInt(2, 4) }),
            col('dept_id', INT, { seed: fkRef('department', 'dept_id') }),
          ],
          uniques: [{ name: 'uq_course_code', columns: ['code'] }],
          foreignKeys: [{ columns: ['dept_id'], refTable: 'department', refColumns: ['dept_id'] }],
          checks: [{ name: 'ck_course_credits', expr: '`credits` BETWEEN 1 AND 5' }],
        },
        {
          // Deliberately no index on `slot`: the advisor finds the full scan in search_sections.
          name: 'section', seedRows: 24000, position: { x: 544, y: 160 }, primaryKey: ['section_id'],
          columns: [
            col('section_id', INT, { ai: true }),
            col('course_id', INT, { seed: fkRef('course', 'course_id', 'zipf', 1.1) }),
            col('faculty_id', INT, { seed: fkRef('faculty', 'faculty_id') }),
            col('slot', varchar(12), { seed: pick(SLOTS) }),
            col('capacity', SMALLINT, { seed: uniformInt(60, 70) }),
            col('enrolled', SMALLINT, { def: 0, seed: { kind: 'constant', value: 0 } }),
            col('version', INT, { def: 0, seed: { kind: 'constant', value: 0 } }),
          ],
          uniques: [{ name: 'uq_section_id_course', columns: ['section_id', 'course_id'] }],
          foreignKeys: [
            { columns: ['course_id'], refTable: 'course', refColumns: ['course_id'] },
            { columns: ['faculty_id'], refTable: 'faculty', refColumns: ['faculty_id'] },
          ],
          checks: [{ name: 'ck_section_capacity', expr: '`capacity` > 0' }, { name: 'ck_section_enrolled', expr: '`enrolled` >= 0' }],
        },
        {
          // The composite FK (section_id, course_id) is the controlled-redundancy pattern from Review 1 section 8.5:
          // course_id is derivable from section_id, but keeping it here lets UNIQUE(student_id, course_id) forbid two sections of one course.
          name: 'enrollment', seedRows: 0, position: { x: 816, y: 160 }, primaryKey: ['student_id', 'section_id'],
          columns: [
            col('student_id', INT),
            col('section_id', INT),
            col('course_id', INT),
            col('enrolled_at', DT3, { def: { expr: 'CURRENT_TIMESTAMP(3)' } }),
          ],
          uniques: [{ name: 'uq_enrollment_student_course', columns: ['student_id', 'course_id'] }],
          foreignKeys: [
            { columns: ['student_id'], refTable: 'student', refColumns: ['student_id'] },
            { columns: ['section_id', 'course_id'], refTable: 'section', refColumns: ['section_id', 'course_id'] },
          ],
        },
      ],
    },
    workload: {
      transactions: [
        {
          name: 'register', weight: 55, readOnly: false, cacheable: false,
          description: 'A student takes a seat in a section. The variants differ only in how they protect the seat counter.',
          params: { student: fromTable('student', 'student_id'), sid: fromTable('section', 'section_id', 'zipf', 1.1) },
          variants: {
            default: naive,
            naive,
            serializable: naive,
            pessimistic: [
              { sql: READ_SECTION(' FOR UPDATE'), bindAs: 's', guard: GUARD },
              { sql: INSERT_ENROLLMENT },
              { sql: 'UPDATE section SET enrolled = :$s.enrolled + 1 WHERE section_id = :sid' },
            ],
            atomic: [
              { sql: 'UPDATE section SET enrolled = enrolled + 1 WHERE section_id = :sid AND enrolled < capacity', expectAffected: { op: '=', value: 1, onFail: 'reject' } },
              { sql: 'INSERT INTO enrollment (student_id, section_id, course_id) SELECT :student, section_id, course_id FROM section WHERE section_id = :sid' },
            ],
            optimistic: [
              { sql: READ_SECTION(), bindAs: 's', guard: GUARD },
              {
                sql: 'UPDATE section SET enrolled = enrolled + 1, version = version + 1 WHERE section_id = :sid AND version = :$s.version AND enrolled < capacity',
                expectAffected: { op: '=', value: 1, onFail: 'retry' },
              },
              { sql: INSERT_ENROLLMENT },
            ],
          },
        },
        {
          name: 'search_sections', weight: 35, readOnly: true, cacheable: true,
          description: 'Browse open sections of a department in a timetable slot. Cached for the TTL; misses scan `section` until `slot` is indexed. STRAIGHT_JOIN pins the join order sections-first (otherwise MySQL drives from course via its FK index and never scans sections).',
          params: { dept: fromTable('department', 'dept_id'), slot: { kind: 'pickList', values: SLOTS }, min_seats: uniformInt(0, 9) },
          variants: {
            default: [{
              sql: `SELECT STRAIGHT_JOIN s.section_id, c.code, c.title, f.name AS faculty, s.slot, s.capacity - s.enrolled AS seats_left
FROM section s JOIN course c ON c.course_id = s.course_id JOIN faculty f ON f.faculty_id = s.faculty_id
WHERE c.dept_id = :dept AND s.slot = :slot AND s.capacity - s.enrolled >= :min_seats
ORDER BY seats_left DESC LIMIT 20`,
            }],
          },
        },
        {
          name: 'my_timetable', weight: 10, readOnly: true, cacheable: false,
          description: 'A student reads their own enrollments.',
          params: { student: fromTable('student', 'student_id') },
          variants: {
            default: [{
              sql: `SELECT c.code, c.title, s.slot, f.name AS faculty, e.enrolled_at
FROM enrollment e JOIN section s ON s.section_id = e.section_id AND s.course_id = e.course_id
JOIN course c ON c.course_id = e.course_id JOIN faculty f ON f.faculty_id = s.faculty_id
WHERE e.student_id = :student ORDER BY e.enrolled_at DESC`,
            }],
          },
        },
      ],
      invariants: [
        {
          name: 'no_overbooking', description: 'No section has more enrollment rows than its capacity (true seat count).',
          sql: 'SELECT COUNT(*) AS violations FROM section s WHERE (SELECT COUNT(*) FROM enrollment e WHERE e.section_id = s.section_id) > s.capacity',
        },
        {
          name: 'counter_consistent', description: 'section.enrolled equals the number of enrollment rows (detects lost updates).',
          sql: 'SELECT COUNT(*) AS violations FROM section s WHERE s.enrolled <> (SELECT COUNT(*) FROM enrollment e WHERE e.section_id = s.section_id)',
        },
      ],
    },
    slo: { p95Ms: 200, maxErrorPct: 1, perTxn: {} },
    capacity: { steps: [50, 150, 300, 450, 500], stepDurationS: 8 },
  });
}
