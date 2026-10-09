import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { runMatrixCalculation } from '@/services/lifeCycleModels/matrixCalculation/matrixWorker';
import { materializeProductSystem } from '@/services/lifeCycleModels/productSystemPersistence';
import { genProcessJsonOrdered } from '@/services/processes/util';
import { genReferenceToResultingProcess } from '@/services/lifeCycleModels/util';
import { jsonToList } from '@/services/general/util';

// Bypass Jest SDK shims: this contract uses the installed release in the lockfile.
const installedRequire = createRequire(`${process.cwd()}/package.json`);
const { createProcess } = installedRequire('@tiangong-lca/tidas-sdk/core');
const { ProcessSchema, LifeCycleModelSchema } = installedRequire('@tiangong-lca/tidas-sdk/schemas');
const version = '01.00.000';
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const ref = (n: number, type = 'flow data set') => ({
  '@type': type,
  '@refObjectId': uuid(n),
  '@version': version,
  '@uri': `../datasets/${uuid(n)}.xml`,
  'common:shortDescription': { '@xml:lang': 'en', '#text': `Item ${n}` },
});
const exchange = (
  id: string,
  n: number,
  amount: number,
  direction: 'INPUT' | 'OUTPUT',
  fraction?: number,
) => ({
  internalId: id,
  flowId: uuid(n),
  amount,
  direction,
  allocations:
    fraction === undefined ? undefined : { allocation: { '@allocatedFraction': String(fraction) } },
  raw: {
    '@dataSetInternalID': id,
    referenceToFlowDataSet: ref(n),
    exchangeDirection: direction === 'INPUT' ? 'Input' : 'Output',
    resultingAmount: String(amount),
    meanAmount: String(amount),
    referenceToVariable: 'sourceFormula',
  },
});

it('persists independent providers, reuses identities and recalculates the standard graph without double allocation', () => {
  const original = JSON.parse(
    readFileSync(
      'tests/data-workflows/fixtures/data/processes/002_check_data_success.json',
      'utf8',
    ),
  ).jsonOrdered.processDataSet;
  original.modellingAndValidation.dataSourcesTreatmentAndRepresentativeness.annualSupplyOrProductionVolume =
    { '@xml:lang': 'en', '#text': '1 kg' };
  original.modellingAndValidation.complianceDeclarations = {
    compliance: {
      'common:referenceToComplianceSystem': ref(30, 'source data set'),
      'common:approvalOfOverallCompliance': 'Fully compliant',
    },
  };
  const model = {
    lifeCycleModelDataSet: {
      administrativeInformation: {
        ...original.administrativeInformation,
        publicationAndOwnership: {
          ...original.administrativeInformation.publicationAndOwnership,
          'common:dataSetVersion': version,
        },
      },
      lifeCycleModelInformation: {
        dataSetInformation: {},
        quantitativeReference: { referenceToReferenceProcess: 0 },
        technology: {
          processes: {
            processInstance: [
              { '@dataSetInternalID': '0', referenceToProcess: ref(1, 'process data set') },
              {
                '@dataSetInternalID': '1',
                referenceToProcess: ref(2, 'process data set'),
                groups: { memberOf: { '@groupId': '0' } },
              },
            ],
          },
        },
      },
    },
  };
  const payload = {
    refInstanceIndex: '0',
    targetAmount: 1,
    instances: [
      {
        instanceIndex: '0',
        processId: uuid(1),
        processVersion: version,
        connections: [],
        process: {
          id: uuid(1),
          version,
          refExchangeInternalId: '1',
          exchanges: [
            exchange('1', 10, 1, 'OUTPUT'),
            exchange('2', 11, 100, 'INPUT'),
            exchange('3', 12, 30, 'INPUT'),
          ],
        },
      },
      {
        instanceIndex: '1',
        processId: uuid(2),
        processVersion: version,
        connections: [11, 12].map((n) => ({
          upstreamIndex: '1',
          downstreamIndex: '0',
          inputFlowId: uuid(n),
          outputFlowId: uuid(n),
          inputFlowVersion: version,
          outputFlowVersion: version,
          edgeId: String(n),
        })),
        process: {
          id: uuid(2),
          version,
          refExchangeInternalId: '1',
          exchanges: [
            exchange('1', 11, 100, 'OUTPUT', 80),
            exchange('2', 12, 20, 'OUTPUT', 20),
            exchange('3', 13, 100, 'OUTPUT'),
          ],
        },
      },
    ],
  };
  const outcome = runMatrixCalculation({ type: 'calculate', runId: 'persist', payload });
  expect(outcome.ok).toBe(true);
  if (!outcome.ok) throw new Error(outcome.error.code);
  const sourceModel = JSON.parse(JSON.stringify(model));
  const providers = materializeProductSystem(
    outcome.result.productSystem,
    model,
    [],
    new Map([[`${uuid(2)}@${version}`, original]]),
  );
  expect(providers).toHaveLength(2);
  expect(new Set(providers.map((p) => p.modelInfo.id)).size).toBe(2);
  const info = model.lifeCycleModelDataSet.lifeCycleModelInformation;
  const instances = jsonToList(info.technology.processes.processInstance);
  const instanceSchema =
    LifeCycleModelSchema.shape.lifeCycleModelDataSet.shape.lifeCycleModelInformation.shape
      .technology.shape.processes.shape.processInstance;
  const parsed = instanceSchema.safeParse(instances);
  expect(parsed.error?.issues).toBeUndefined();
  const persisted = providers.map((provider) =>
    genProcessJsonOrdered(provider.modelInfo.id, provider.data.processDataSet),
  );
  const exchangeSchema = ProcessSchema.shape.processDataSet.shape.exchanges;
  for (const provider of persisted) {
    expect(createProcess(provider, { mode: 'strict' }).validateEnhanced().validationIssues).toEqual(
      [],
    );
    expect(
      exchangeSchema.safeParse(provider.processDataSet.exchanges).error?.issues,
    ).toBeUndefined();
    const entries = jsonToList(provider.processDataSet.exchanges.exchange);
    expect(entries).toHaveLength(2);
    expect(entries.every((e) => !e.allocations && !e.referenceToVariable)).toBe(true);
    expect(provider.processDataSet.processInformation.mathematicalRelations).toBeUndefined();
    const validation = provider.processDataSet.modellingAndValidation;
    expect(jsonToList(validation.validation.review)).toEqual([{ '@type': 'Not reviewed' }]);
    expect(jsonToList(validation.complianceDeclarations.compliance)[0]).toEqual(
      expect.objectContaining({
        'common:referenceToComplianceSystem': ref(30, 'source data set'),
        'common:approvalOfOverallCompliance': 'Not defined',
        'common:reviewCompliance': 'Not defined',
      }),
    );
  }
  const serialized = JSON.parse(JSON.stringify({ instances, persisted }));
  const reloaded = serialized.instances.map((instance: any) => {
    const id = instance.referenceToProcess['@refObjectId'];
    const provider = serialized.persisted.find(
      (p: any) => p.processDataSet.processInformation.dataSetInformation['common:UUID'] === id,
    )?.processDataSet;
    const process = provider
      ? {
          id,
          version,
          refExchangeInternalId: String(
            provider.processInformation.quantitativeReference.referenceToReferenceFlow,
          ),
          exchanges: jsonToList(provider.exchanges.exchange).map((e) => ({
            internalId: String(e['@dataSetInternalID']),
            flowId: e.referenceToFlowDataSet['@refObjectId'],
            direction: e.exchangeDirection === 'Input' ? 'INPUT' : 'OUTPUT',
            amount: Number(e.resultingAmount),
            raw: e,
          })),
        }
      : payload.instances[0].process;
    return {
      instanceIndex: instance['@dataSetInternalID'],
      processId: id,
      processVersion: version,
      process,
      connections: jsonToList(instance.connections?.outputExchange).flatMap((output) =>
        jsonToList(output.downstreamProcess).map((downstream) => ({
          upstreamIndex: instance['@dataSetInternalID'],
          downstreamIndex: downstream['@id'],
          inputFlowId: downstream['@flowUUID'],
          outputFlowId: output['@flowUUID'],
          inputFlowVersion: downstream['@version'],
          outputFlowVersion: output['@version'],
          edgeId: `${instance['@dataSetInternalID']}:${output['@flowUUID']}`,
        })),
      ),
    };
  });
  const replay = runMatrixCalculation({
    type: 'calculate',
    runId: 'reload',
    payload: {
      refInstanceIndex: String(info.quantitativeReference.referenceToReferenceProcess),
      targetAmount: 1,
      instances: reloaded,
    },
  });
  expect(replay.ok).toBe(true);
  if (!replay.ok) throw new Error(replay.error.code);
  expect(replay.result.groups[0].exchanges.find((e) => e.flowId === uuid(13))?.amount).toBeCloseTo(
    110,
  );
  expect(replay.result.productSystem.instances.every((i) => !i.materialize)).toBe(true);
  const again = materializeProductSystem(
    outcome.result.productSystem,
    sourceModel,
    providers.map((p) => p.modelInfo),
  );
  expect(again.map((p) => p.modelInfo.id)).toEqual(providers.map((p) => p.modelInfo.id));
  expect(again.every((p) => p.option === 'update')).toBe(true);
  const refs = genReferenceToResultingProcess(
    [
      ...providers,
      {
        modelInfo: { id: uuid(20), type: 'primary' },
        data: {
          processDataSet: {
            processInformation: { dataSetInformation: { name: { baseName: [] } } },
          },
        },
      },
    ],
    version,
    model,
  );
  expect(
    jsonToList(
      refs.lifeCycleModelDataSet.lifeCycleModelInformation.dataSetInformation
        .referenceToResultingProcess,
    ),
  ).toHaveLength(1);
});
