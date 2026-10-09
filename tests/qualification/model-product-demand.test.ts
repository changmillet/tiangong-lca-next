/** Local PostgreSQL contract; run explicitly, outside the credential-free unit gate. */
import { execFileSync } from 'node:child_process';
import { runMatrixCalculation } from '@/services/lifeCycleModels/matrixCalculation/matrixWorker';
import { materializeProductSystem } from '@/services/lifeCycleModels/productSystemPersistence';
import { buildSaveLifeCycleModelPersistencePlan } from '@/services/lifeCycleModels/persistencePlan';
import { jsonToList } from '@/services/general/util';
import { productDemandFixture, uuid, version } from '../helpers/lifeCycleModelProductDemand';

jest.mock('@tiangong-lca/tidas-sdk/core', () => {
  return jest.requireActual(
    `${process.cwd()}/node_modules/@tiangong-lca/tidas-sdk/dist/core/index.js`,
  );
});

// Keep the real language normalizer; a qualification fixture never calls translation services.
jest.mock('@/services/general/api', () => ({
  normalizeLangPayloadForSave: async (payload: any) => {
    const { normalizeLangPayloadBeforeSave } = jest.requireActual('@/services/general/util');
    const result = await normalizeLangPayloadBeforeSave(payload, { intent: 'validation' });
    return {
      ...result,
      validationError: result.issues.length ? JSON.stringify(result.issues) : undefined,
    };
  },
}));

const container = 'supabase_db_model1196-qualification';
const actorId = uuid(1196001);
const modelId = uuid(1196002);
const nextVersion = '01.00.001';
const sqlJson = (value: unknown) => `'${JSON.stringify(value).replace(/'/g, "''")}'::jsonb`;
const sql = (input: string) =>
  execFileSync(
    'docker',
    [
      'exec',
      '-i',
      container,
      'psql',
      '-U',
      'postgres',
      '-d',
      'postgres',
      '-At',
      '-v',
      'ON_ERROR_STOP=1',
    ],
    { input, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 },
  );

async function prepare(
  mode: 'create' | 'update',
  old: any[] = [],
  modelVersion = version,
  load = 100,
  retireQ = false,
) {
  const fixture = productDemandFixture();
  fixture.model.lifeCycleModelDataSet.administrativeInformation.publicationAndOwnership[
    'common:dataSetVersion'
  ] = modelVersion;
  fixture.payload.instances[1].process.exchanges[2].amount = load;
  if (retireQ) {
    fixture.payload.instances[0].process.exchanges.pop();
    fixture.payload.instances[1].process.exchanges.splice(1, 1);
    fixture.payload.instances[1].process.exchanges[0].allocations = {
      allocation: { '@allocatedFraction': '100' },
    };
    fixture.payload.instances[1].connections.pop();
  }
  const outcome = runMatrixCalculation({
    type: 'calculate',
    runId: 'database-qualification',
    payload: fixture.payload,
  });
  if (!outcome.ok) throw new Error(outcome.error.code);
  const records = materializeProductSystem(
    outcome.result.productSystem,
    fixture.model,
    old,
    new Map([[`${uuid(2)}@${version}`, fixture.original]]),
  );
  if (mode === 'create')
    records.forEach((record) => {
      record.option = 'create';
    });
  const result = await buildSaveLifeCycleModelPersistencePlan({
    mode,
    modelId,
    version: modelVersion,
    lifeCycleModelJsonOrdered: fixture.model,
    nodes: [],
    edges: [],
    up2DownEdges: [],
    lifeCycleModelProcesses: records,
    oldSubmodels: mode === 'update' ? old : [],
    oldProcesses:
      mode === 'update'
        ? old.map((entry) => ({ id: entry.id, version: modelVersion, json: {} }))
        : [],
  });
  if (!result.ok) throw new Error(`${result.code}: ${result.message}`);
  expect(
    result.plan.processMutations
      .filter((entry) => entry.op !== 'delete')
      .every((entry: any) => entry.ruleVerification),
  ).toBe(true);
  return { ...fixture, records, plan: result.plan };
}

function replay(snapshot: any, downstream: any) {
  const info = snapshot.model.json_ordered.lifeCycleModelDataSet.lifeCycleModelInformation;
  const instances = jsonToList(info.technology.processes.processInstance).map((instance: any) => {
    const reference = instance.referenceToProcess;
    const stored = snapshot.processes.find(
      (row: any) => row.id === reference['@refObjectId'] && row.version === reference['@version'],
    );
    const data = stored?.json_ordered.processDataSet;
    const process = data
      ? {
          id: stored.id,
          version: stored.version,
          refExchangeInternalId: String(
            data.processInformation.quantitativeReference.referenceToReferenceFlow,
          ),
          exchanges: jsonToList(data.exchanges.exchange).map((entry: any) => ({
            internalId: String(entry['@dataSetInternalID']),
            flowId: entry.referenceToFlowDataSet['@refObjectId'],
            amount: Number(entry.resultingAmount),
            direction: entry.exchangeDirection === 'Input' ? 'INPUT' : 'OUTPUT',
            raw: entry,
          })),
        }
      : downstream;
    expect(stored !== undefined || reference['@refObjectId'] === uuid(1)).toBe(true);
    return {
      instanceIndex: instance['@dataSetInternalID'],
      processId: reference['@refObjectId'],
      processVersion: reference['@version'],
      process,
      connections: jsonToList(instance.connections?.outputExchange).flatMap((output: any) =>
        jsonToList(output.downstreamProcess).map((target: any) => ({
          upstreamIndex: instance['@dataSetInternalID'],
          downstreamIndex: target['@id'],
          inputFlowId: target['@flowUUID'],
          outputFlowId: output['@flowUUID'],
          inputFlowVersion: target['@version'],
          outputFlowVersion: output['@version'],
          edgeId: `${instance['@dataSetInternalID']}:${output['@flowUUID']}`,
        })),
      ),
    };
  });
  const result = runMatrixCalculation({
    type: 'calculate',
    runId: 'postgres-reload',
    payload: {
      refInstanceIndex: String(info.quantitativeReference.referenceToReferenceProcess),
      targetAmount: 1,
      instances,
    },
  });
  if (!result.ok) throw new Error(result.error.code);
  expect(result.result.productSystem.instances.every((entry) => !entry.materialize)).toBe(true);
  return result.result.groups[0].exchanges.find((entry) => entry.flowId === uuid(13))?.amount;
}

it('saves, updates, versions, retires and reloads real product providers atomically', async () => {
  expect(sql('select max(version) from supabase_migrations.schema_migrations;').trim()).toBe(
    '20261009113000',
  );
  const created = await prepare('create');
  const old = created.plan.parent.jsonTg.submodels!;
  const updated = await prepare('update', old, version, 200);
  const versioned = await prepare('create', old, version, 200);
  const nextOld = versioned.plan.parent.jsonTg.submodels!.map((entry) => ({
    ...entry,
    version: nextVersion,
  }));
  const retired = await prepare('update', nextOld, nextVersion, 200, true);
  expect(updated.records.map((entry) => entry.modelInfo.id)).toEqual(
    created.records.map((entry) => entry.modelInfo.id),
  );
  const retiredId = created.records.find((entry) => entry.modelInfo.finalId.exchangeId === '2')
    .modelInfo.id;
  expect(retired.plan.processMutations).toContainEqual(
    expect.objectContaining({ op: 'delete', id: retiredId, version: nextVersion }),
  );
  const snapshots = [
    ['created', created.plan, version],
    ['updated', updated.plan, version],
    [
      'versioned',
      { ...versioned.plan, allocateVersion: true, sourceVersion: version },
      nextVersion,
    ],
    ['retired', retired.plan, nextVersion],
  ] as const;
  // Disable unrelated asynchronous derivatives exactly as the database-owned bundle pgTAP tests do.
  // JSON sync, bundle authorization/versioning, table constraints and rollback remain real.
  const statements = [
    'begin;',
    'alter table public.processes disable trigger user;',
    'alter table public.processes enable trigger processes_json_sync_trigger;',
    'alter table public.lifecyclemodels disable trigger user;',
    'alter table public.lifecyclemodels enable trigger lifecyclemodels_json_sync_trigger;',
    `insert into auth.users(id,aud,role,email,raw_app_meta_data,raw_user_meta_data) values ('${actorId}','authenticated','authenticated','model1196-qualification@example.invalid','{}','{}');`,
    'set local role service_role;',
  ];
  for (const [stage, plan, savedVersion] of snapshots) {
    statements.push(
      `select private.save_lifecycle_model_bundle(${sqlJson({ ...plan, actorUserId: actorId })})->>'version';`,
    );
    statements.push(
      `select jsonb_build_object('stage','${stage}','model',(select to_jsonb(m) from public.lifecyclemodels m where id='${modelId}' and version='${savedVersion}'),'processes',(select jsonb_agg(to_jsonb(p)) from public.processes p where model_id='${modelId}'));`,
    );
  }
  statements.push('rollback;');
  const saved = sql(statements.join('\n'))
    .split('\n')
    .filter((line) => line.startsWith('{'))
    .map((line) => JSON.parse(line));
  expect(saved.map((item) => item.stage)).toEqual(['created', 'updated', 'versioned', 'retired']);
  expect(
    saved.map((item, index) =>
      replay(
        item,
        index === 3 ? retired.payload.instances[0].process : created.payload.instances[0].process,
      ),
    ),
  ).toEqual([110, 220, 220, 200]);
  expect(saved[2].processes).toHaveLength(4);
  expect(saved[3].processes).toHaveLength(3);
  expect(
    saved[3].processes.some((row: any) => row.id === retiredId && row.version === version),
  ).toBe(true);
  expect(
    saved[3].processes.some((row: any) => row.id === retiredId && row.version === nextVersion),
  ).toBe(false);
  for (const snapshot of saved) {
    for (const provider of snapshot.processes) {
      const references = jsonToList(
        provider.json_ordered.processDataSet.processInformation.technology
          .referenceToIncludedProcesses,
      );
      expect(references).toEqual([
        expect.objectContaining({ '@refObjectId': uuid(2), '@version': version }),
      ]);
      expect(provider.model_version).toBe(provider.version);
    }
  }
  expect(sql(`select count(*) from public.lifecyclemodels where id='${modelId}';`).trim()).toBe(
    '0',
  );
}, 30000);
