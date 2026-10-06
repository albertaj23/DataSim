import { createHash } from 'node:crypto';
import { z } from 'zod';

const id = z.string().min(1).max(64).regex(/^[A-Za-z][A-Za-z0-9_-]*$/);
const name = z.string().trim().min(1).max(64);
const scalar = z.union([z.string().max(255), z.number().finite(), z.boolean(), z.null()]);
const fieldType = z.enum(['INTEGER', 'DECIMAL', 'TEXT', 'BOOLEAN']);

const fieldSchema = z.object({
  id, name, type: fieldType, nullable: z.boolean(), primaryKey: z.boolean(), unique: z.boolean(),
}).strict();

const entitySchema = z.object({
  id, name, fields: z.array(fieldSchema).min(1).max(32),
  fixtures: z.array(z.record(scalar)).max(200),
}).strict();

const relationSchema = z.object({
  id, fromEntity: id, fromField: id, toEntity: id, toField: id,
}).strict();

const valueExpressionSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('literal'), value: scalar }).strict(),
  z.object({ kind: z.literal('read-field'), variable: id, fieldId: id, offset: z.number().finite().min(-1_000_000).max(1_000_000).optional() }).strict(),
  z.object({ kind: z.literal('increment'), amount: z.number().finite().min(-1_000_000).max(1_000_000) }).strict(),
]);

const operationSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('read'), entityId: id, keyFieldId: id, key: scalar, lock: z.boolean(), as: id }).strict(),
  z.object({
    type: z.literal('update'), entityId: id, keyFieldId: id, key: scalar,
    changes: z.array(z.object({ fieldId: id, value: valueExpressionSchema }).strict()).min(1).max(32),
    guard: z.object({ kind: z.literal('field-lt-field'), leftFieldId: id, rightFieldId: id }).strict().optional(),
  }).strict(),
  z.object({ type: z.literal('insert'), entityId: id, values: z.record(scalar) }).strict(),
  z.object({ type: z.literal('delete'), entityId: id, keyFieldId: id, key: scalar }).strict(),
  z.object({ type: z.literal('barrier'), name: id }).strict(),
  z.object({ type: z.literal('wait'), durationMs: z.number().int().min(0).max(2_000) }).strict(),
  z.object({ type: z.literal('commit') }).strict(),
  z.object({ type: z.literal('rollback') }).strict(),
]);

const actorSchema = z.object({
  id, name, operations: z.array(operationSchema).max(40),
}).strict();

const invariantSchema = z.discriminatedUnion('kind', [
  z.object({
    id, description: z.string().trim().min(1).max(240),
    kind: z.literal('row-field-nonnegative'), entityId: id, fieldId: id,
  }).strict(),
  z.object({
    id, description: z.string().trim().min(1).max(240),
    kind: z.literal('row-field-equals'), entityId: id, fieldId: id, value: z.number().finite(),
  }).strict(),
  z.object({
    id, description: z.string().trim().min(1).max(240),
    kind: z.literal('row-field-lte'), entityId: id, leftFieldId: id, rightFieldId: id,
  }).strict(),
]);

export const workspaceDefinitionSchema = z.object({
  schemaVersion: z.literal(1),
  entities: z.array(entitySchema).max(16),
  relations: z.array(relationSchema).max(32),
  actors: z.array(actorSchema).max(8),
  invariants: z.array(invariantSchema).max(16),
}).strict();

export type WorkspaceDefinition = z.infer<typeof workspaceDefinitionSchema>;
export type WorkspaceOperation = z.infer<typeof operationSchema>;
export type Scalar = z.infer<typeof scalar>;
export type ScenarioInvariant = z.infer<typeof invariantSchema>;

export interface ValidationProblem { path: string; message: string }

function matchesType(value: Scalar, type: z.infer<typeof fieldType>): boolean {
  if (value === null) return true;
  if (type === 'INTEGER') return typeof value === 'number' && Number.isInteger(value);
  if (type === 'DECIMAL') return typeof value === 'number';
  if (type === 'BOOLEAN') return typeof value === 'boolean';
  return typeof value === 'string';
}

export function validateWorkspaceDefinition(input: unknown): { definition?: WorkspaceDefinition; problems: ValidationProblem[] } {
  const parsed = workspaceDefinitionSchema.safeParse(input);
  if (!parsed.success) {
    return {
      problems: parsed.error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })),
    };
  }

  const definition = parsed.data;
  const problems: ValidationProblem[] = [];
  const entities = new Map(definition.entities.map((entity) => [entity.id, entity]));
  const add = (path: string, message: string) => problems.push({ path, message });

  for (const [entityIndex, entity] of definition.entities.entries()) {
    const fieldIds = new Set<string>();
    const fieldNames = new Set<string>();
    const primary = entity.fields.filter((field) => field.primaryKey);
    const primaryKeys = new Set<string>();
    const uniqueValues = new Map<string, Set<string>>();
    if (primary.length !== 1) add(`entities.${entityIndex}.fields`, 'Each table needs exactly one primary-key field.');
    for (const [fieldIndex, field] of entity.fields.entries()) {
      if (fieldIds.has(field.id)) add(`entities.${entityIndex}.fields.${fieldIndex}.id`, 'Field IDs must be unique within a table.');
      if (fieldNames.has(field.name.toLowerCase())) add(`entities.${entityIndex}.fields.${fieldIndex}.name`, 'Field names must be unique within a table.');
      fieldIds.add(field.id);
      fieldNames.add(field.name.toLowerCase());
      if (field.primaryKey && field.nullable) add(`entities.${entityIndex}.fields.${fieldIndex}.nullable`, 'A primary-key field cannot be nullable.');
    }
    for (const [rowIndex, row] of entity.fixtures.entries()) {
      for (const fieldId of Object.keys(row)) {
        if (!fieldIds.has(fieldId)) add(`entities.${entityIndex}.fixtures.${rowIndex}.${fieldId}`, 'Fixture refers to a field that does not exist.');
      }
      for (const field of entity.fields) {
        if (!(field.id in row) && !field.nullable) add(`entities.${entityIndex}.fixtures.${rowIndex}.${field.id}`, 'A required field is missing from this fixture row.');
        const value = row[field.id];
        if (value !== undefined && !matchesType(value, field.type)) add(`entities.${entityIndex}.fixtures.${rowIndex}.${field.id}`, `Value does not match the ${field.type} field type.`);
        if (value === null && !field.nullable) add(`entities.${entityIndex}.fixtures.${rowIndex}.${field.id}`, 'A non-nullable field cannot contain null.');
        if (field.unique && value !== undefined && value !== null) {
          const serialized = JSON.stringify(value);
          const values = uniqueValues.get(field.id) ?? new Set<string>();
          if (values.has(serialized)) add(`entities.${entityIndex}.fixtures.${rowIndex}.${field.id}`, `Fixture values for unique field "${field.name}" must not repeat.`);
          values.add(serialized);
          uniqueValues.set(field.id, values);
        }
      }
      const primaryField = primary[0];
      const primaryValue = primaryField ? row[primaryField.id] : undefined;
      if (primaryValue !== undefined && primaryValue !== null) {
        const key = JSON.stringify(primaryValue);
        if (primaryKeys.has(key)) add(`entities.${entityIndex}.fixtures.${rowIndex}.${primaryField!.id}`, 'Primary-key values must be unique.');
        primaryKeys.add(key);
      }
    }
  }

  for (const [index, relation] of definition.relations.entries()) {
    const from = entities.get(relation.fromEntity);
    const to = entities.get(relation.toEntity);
    if (!from?.fields.some((field) => field.id === relation.fromField)) add(`relations.${index}.fromField`, 'Relationship source table or field does not exist.');
    if (!to?.fields.some((field) => field.id === relation.toField)) add(`relations.${index}.toField`, 'Relationship target table or field does not exist.');
    const fromField = from?.fields.find((field) => field.id === relation.fromField);
    const toField = to?.fields.find((field) => field.id === relation.toField);
    if (fromField && toField && fromField.type !== toField.type) add(`relations.${index}`, 'Relationship fields must have matching data types.');
    if (toField && !toField.primaryKey && !toField.unique) add(`relations.${index}.toField`, 'A relationship must target a primary-key or unique field.');
  }

  for (const [actorIndex, actor] of definition.actors.entries()) {
    const barrierOrder = actor.operations.filter((operation) => operation.type === 'barrier').map((operation) => operation.name);
    const variables = new Map<string, Map<string, z.infer<typeof fieldType>>>();
    for (const [operationIndex, operation] of actor.operations.entries()) {
      const path = `actors.${actorIndex}.operations.${operationIndex}`;
      if ('entityId' in operation) {
        const entity = entities.get(operation.entityId);
        if (!entity) {
          add(`${path}.entityId`, 'Operation refers to a table that does not exist.');
          continue;
        }
        if ('keyFieldId' in operation && !entity.fields.some((field) => field.id === operation.keyFieldId && field.primaryKey)) {
          add(`${path}.keyFieldId`, 'Select the table primary key for this operation.');
        }
        if ('keyFieldId' in operation) {
          const keyField = entity.fields.find((field) => field.id === operation.keyFieldId);
          if (keyField && operation.key !== null && !matchesType(operation.key, keyField.type)) add(`${path}.key`, `Key value must match the ${keyField.type} primary-key type.`);
        }
        if (operation.type === 'read') {
          if (variables.has(operation.as)) add(`${path}.as`, 'Read variable names must be unique within an actor.');
          variables.set(operation.as, new Map(entity.fields.map((field) => [field.id, field.type])));
        }
        if (operation.type === 'update' || operation.type === 'insert') {
          const fields = new Set(entity.fields.map((field) => field.id));
          for (const change of operation.type === 'update' ? operation.changes : Object.keys(operation.values).map((fieldId) => ({ fieldId }))) {
            if (!fields.has(change.fieldId)) add(`${path}.changes`, `Field "${change.fieldId}" does not exist on this table.`);
          }
          if (operation.type === 'update') {
            const changed = new Set<string>();
            for (const change of operation.changes) {
              if (changed.has(change.fieldId)) add(`${path}.changes`, 'A field can be changed only once in an operation.');
              changed.add(change.fieldId);
              const target = entity.fields.find((field) => field.id === change.fieldId);
              if (target?.primaryKey) add(`${path}.changes`, 'Primary-key fields cannot be updated by the scenario runner.');
              if (target && change.value.kind === 'literal' && !matchesType(change.value.value, target.type)) add(`${path}.changes`, `Value must match the ${target.type} field type.`);
              if (target && change.value.kind === 'read-field') {
                const sourceFields = variables.get(change.value.variable);
                if (!sourceFields) add(`${path}.changes`, `Read variable "${change.value.variable}" must be set by an earlier read in this actor.`);
                else if (!sourceFields.has(change.value.fieldId)) add(`${path}.changes`, `Field "${change.value.fieldId}" was not selected by the earlier read.`);
                else if (change.value.offset !== undefined && (
                  (target?.type !== 'INTEGER' && target?.type !== 'DECIMAL') ||
                  (sourceFields.get(change.value.fieldId) !== 'INTEGER' && sourceFields.get(change.value.fieldId) !== 'DECIMAL') ||
                  (target?.type === 'INTEGER' && (sourceFields.get(change.value.fieldId) !== 'INTEGER' || !Number.isInteger(change.value.offset)))
                )) add(`${path}.changes`, 'Numeric read offsets require numeric source and destination fields.');
              }
            }
            if (operation.guard && (!fields.has(operation.guard.leftFieldId) || !fields.has(operation.guard.rightFieldId))) {
              add(`${path}.guard`, 'Guard fields must belong to the selected table.');
            }
            if (operation.guard) {
              for (const fieldId of [operation.guard.leftFieldId, operation.guard.rightFieldId]) {
                const guardField = entity.fields.find((field) => field.id === fieldId);
                if (guardField && guardField.type !== 'INTEGER' && guardField.type !== 'DECIMAL') add(`${path}.guard`, 'Comparison guards require numeric fields.');
              }
            }
            for (const change of operation.changes) {
              if (change.value.kind === 'increment') {
                const field = entity.fields.find((candidate) => candidate.id === change.fieldId);
                if (field && field.type !== 'INTEGER' && field.type !== 'DECIMAL') add(`${path}.changes`, 'Increment operations require a numeric field.');
              }
            }
          } else {
            const supplied = new Set(Object.keys(operation.values));
            for (const field of entity.fields) {
              if (!supplied.has(field.id) && !field.nullable) add(`${path}.values.${field.id}`, 'Insert must provide every required field.');
            }
            for (const [fieldId, value] of Object.entries(operation.values)) {
              const field = entity.fields.find((candidate) => candidate.id === fieldId);
              if (field && !matchesType(value, field.type)) add(`${path}.values.${fieldId}`, `Value must match the ${field.type} field type.`);
              if (field && value === null && !field.nullable) add(`${path}.values.${fieldId}`, 'A non-nullable field cannot contain null.');
            }
            const primaryField = entity.fields.find((field) => field.primaryKey);
            if (!primaryField || operation.values[primaryField.id] === undefined || operation.values[primaryField.id] === null) {
              add(`${path}.values`, 'Insert must provide the table primary key.');
            }
          }
        }
      }
      if ((operation.type === 'commit' || operation.type === 'rollback') && operationIndex !== actor.operations.length - 1) {
        add(path, 'Commit and rollback must be the final operation for an actor.');
      }
    }
    if (actorIndex > 0) {
      const first = definition.actors[0]!;
      const firstBarriers = first.operations.filter((operation) => operation.type === 'barrier').map((operation) => operation.name);
      if (barrierOrder.join('\0') !== firstBarriers.join('\0')) {
        add(`actors.${actorIndex}.operations`, 'All actors must use the same barriers in the same order.');
      }
    }
  }

  for (const [index, invariant] of definition.invariants.entries()) {
    const entity = entities.get(invariant.entityId);
    if (!entity) add(`invariants.${index}.entityId`, 'Invariant refers to a table that does not exist.');
    const fieldIds = new Set(entity?.fields.map((field) => field.id) ?? []);
    if ((invariant.kind === 'row-field-nonnegative' || invariant.kind === 'row-field-equals') && !fieldIds.has(invariant.fieldId)) add(`invariants.${index}.fieldId`, 'Invariant field does not exist.');
    if (invariant.kind === 'row-field-lte' && (!fieldIds.has(invariant.leftFieldId) || !fieldIds.has(invariant.rightFieldId))) {
      add(`invariants.${index}`, 'Both invariant fields must belong to its selected table.');
    }
    const numericIds = new Set(entity?.fields.filter((field) => field.type === 'INTEGER' || field.type === 'DECIMAL').map((field) => field.id) ?? []);
    if (invariant.kind === 'row-field-nonnegative' && fieldIds.has(invariant.fieldId) && !numericIds.has(invariant.fieldId)) add(`invariants.${index}.fieldId`, 'Nonnegative invariants require an INTEGER or DECIMAL field.');
    if (invariant.kind === 'row-field-equals' && fieldIds.has(invariant.fieldId) && !numericIds.has(invariant.fieldId)) add(`invariants.${index}.fieldId`, 'Equality invariants require an INTEGER or DECIMAL field.');
    if (invariant.kind === 'row-field-lte' && fieldIds.has(invariant.leftFieldId) && fieldIds.has(invariant.rightFieldId) &&
      (!numericIds.has(invariant.leftFieldId) || !numericIds.has(invariant.rightFieldId))) add(`invariants.${index}`, 'Field comparison invariants require numeric fields.');
  }

  if (definition.actors.length < 2) add('actors', 'Add at least two transaction actors to test concurrency.');
  if (definition.invariants.length === 0) add('invariants', 'Define at least one invariant before running this workspace.');
  return problems.length ? { problems } : { definition, problems };
}

export function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const object = value as Record<string, unknown>;
    return `{${Object.keys(object).sort().map((key) => `${JSON.stringify(key)}:${stableJson(object[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export function workspaceHash(definition: WorkspaceDefinition): string {
  return createHash('sha256').update(stableJson(definition)).digest('hex');
}

export function emptyWorkspaceDefinition(): WorkspaceDefinition {
  return {
    schemaVersion: 1,
    entities: [{
      id: 'items',
      name: 'Items',
      fields: [
        { id: 'id', name: 'ID', type: 'INTEGER', nullable: false, primaryKey: true, unique: true },
        { id: 'value', name: 'Value', type: 'INTEGER', nullable: false, primaryKey: false, unique: false },
      ],
      fixtures: [{ id: 1, value: 0 }],
    }],
    relations: [],
    actors: [{ id: 'actor_a', name: 'Transaction A', operations: [] }, { id: 'actor_b', name: 'Transaction B', operations: [] }],
    invariants: [{ id: 'nonnegative', description: 'The value must never be negative.', kind: 'row-field-nonnegative', entityId: 'items', fieldId: 'value' }],
  };
}

export interface ScenarioTemplate { id: string; title: string; description: string; definition: WorkspaceDefinition }

export const scenarioTemplates: readonly ScenarioTemplate[] = [
  {
    id: 'inventory-reservation',
    title: 'Inventory reservation',
    description: 'Two buyers contend for one unit. Compare an unguarded reservation with a row-guarded update.',
    definition: {
      schemaVersion: 1,
      entities: [{
        id: 'stock', name: 'Stock',
        fields: [
          { id: 'sku', name: 'SKU', type: 'TEXT', nullable: false, primaryKey: true, unique: true },
          { id: 'available', name: 'Available', type: 'INTEGER', nullable: false, primaryKey: false, unique: false },
          { id: 'reserved', name: 'Reserved', type: 'INTEGER', nullable: false, primaryKey: false, unique: false },
        ],
        fixtures: [{ sku: 'SKU-1', available: 1, reserved: 0 }],
      }],
      relations: [],
      actors: ['buyer_a', 'buyer_b'].map((id, index) => ({
        id, name: `Buyer ${index + 1}`,
        operations: [
          { type: 'read' as const, entityId: 'stock', keyFieldId: 'sku', key: 'SKU-1', lock: false, as: 'stock_snapshot' },
          { type: 'barrier' as const, name: 'both_read' },
          { type: 'update' as const, entityId: 'stock', keyFieldId: 'sku', key: 'SKU-1', changes: [{ fieldId: 'reserved', value: { kind: 'increment' as const, amount: 1 } }] },
          { type: 'commit' as const },
        ],
      })),
      invariants: [{ id: 'capacity', description: 'Reserved inventory must not exceed available inventory.', kind: 'row-field-lte', entityId: 'stock', leftFieldId: 'reserved', rightFieldId: 'available' }],
    },
  },
  {
    id: 'shared-counter',
    title: 'Shared counter',
    description: 'Two transactions read the same counter before writing back. Change the operations to compare lost updates with atomic increments.',
    definition: {
      schemaVersion: 1,
      entities: [{
        id: 'counter', name: 'Counter',
        fields: [
          { id: 'id', name: 'ID', type: 'INTEGER', nullable: false, primaryKey: true, unique: true },
          { id: 'value', name: 'Value', type: 'INTEGER', nullable: false, primaryKey: false, unique: false },
        ],
        fixtures: [{ id: 1, value: 0 }],
      }],
      relations: [],
      actors: ['increment_a', 'increment_b'].map((id, index) => ({
        id, name: `Increment ${index + 1}`,
        operations: [
          { type: 'read' as const, entityId: 'counter', keyFieldId: 'id', key: 1, lock: false, as: 'counter_snapshot' },
          { type: 'barrier' as const, name: 'both_read' },
          { type: 'update' as const, entityId: 'counter', keyFieldId: 'id', key: 1, changes: [{ fieldId: 'value', value: { kind: 'read-field' as const, variable: 'counter_snapshot', fieldId: 'value', offset: 1 } }] },
          { type: 'commit' as const },
        ],
      })),
      invariants: [{ id: 'expected_total', description: 'Both transactions should contribute one increment, so the final value must be 2.', kind: 'row-field-equals', entityId: 'counter', fieldId: 'value', value: 2 }],
    },
  },
];

export function findTemplate(id: string): ScenarioTemplate | undefined {
  return scenarioTemplates.find((template) => template.id === id);
}
