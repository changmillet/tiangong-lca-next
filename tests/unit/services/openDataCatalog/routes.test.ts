/**
 * @jest-environment jsdom
 */

type CatalogRouteOptions = {
  datasetKind: string;
  filters: unknown;
  mode: string;
};

const mockQueryMappedOpenDataCatalog = jest.fn(
  async (_options: CatalogRouteOptions, mapRows: (rows: unknown[]) => Promise<unknown[]>) => ({
    data: await mapRows([]),
    page: 1,
    success: true,
    total: 0,
  }),
);

jest.mock('@/services/openDataCatalog/api', () => ({
  addOpenDataHybridFilters: (
    body: Record<string, unknown>,
    filters?: { publicationFilter?: string; sourceFilter: string },
  ) =>
    filters
      ? {
          ...body,
          source_filter: filters.sourceFilter,
          publication_filter: filters.publicationFilter ?? 'all',
        }
      : body,
  queryMappedOpenDataCatalog: (
    options: CatalogRouteOptions,
    mapRows: (rows: unknown[]) => Promise<unknown[]>,
  ) => mockQueryMappedOpenDataCatalog(options, mapRows),
}));

jest.mock('@/services/classifications/cache', () => ({
  getCachedClassificationData: jest.fn(async () => []),
  getCachedFlowCategorizationAll: jest.fn(async () => []),
}));

jest.mock('@/services/locations/cache', () => ({
  getCachedLocationData: jest.fn(async () => []),
}));

import {
  getContactTableAll,
  getContactTablePgroongaSearch,
  getContactTableUuidMentionSearch,
} from '@/services/contacts/api';
import {
  getFlowpropertyTableAll,
  getFlowpropertyTablePgroongaSearch,
  getFlowpropertyTableUuidMentionSearch,
} from '@/services/flowproperties/api';
import {
  getFlowTableAll,
  getFlowTablePgroongaSearch,
  getFlowTableUuidMentionSearch,
} from '@/services/flows/api';
import {
  getLifeCycleModelTableAll,
  getLifeCycleModelTablePgroongaSearch,
  getLifeCycleModelTableUuidMentionSearch,
} from '@/services/lifeCycleModels/api';
import { getOpenDataCatalogFilterArgs } from '@/services/openDataCatalog/types';
import {
  getProcessTableAll,
  getProcessTablePgroongaSearch,
  getProcessTableUuidMentionSearch,
} from '@/services/processes/api';
import {
  getSourceTableAll,
  getSourceTablePgroongaSearch,
  getSourceTableUuidMentionSearch,
} from '@/services/sources/api';
import {
  getUnitGroupTableAll,
  getUnitGroupTablePgroongaSearch,
  getUnitGroupTableUuidMentionSearch,
} from '@/services/unitgroups/api';

const filters = {
  publicationFilter: 'published' as const,
  sourceFilter: 'enterprise' as const,
};
const params = { current: 2, pageSize: 25 };
const sort = { modifiedAt: 'descend' };

describe('open data catalog service route matrix', () => {
  beforeEach(() => {
    mockQueryMappedOpenDataCatalog.mockClear();
  });

  it('routes list, lexical, and UUID searches for every dataset kind', async () => {
    await (getContactTableAll as any)(params, sort, 'en', 'tg', [], 100, filters);
    await (getContactTablePgroongaSearch as any)(
      params,
      'en',
      'tg',
      'contact',
      {},
      100,
      [],
      filters,
    );
    await (getContactTableUuidMentionSearch as any)(
      params,
      'en',
      'tg',
      'contact-id',
      100,
      [],
      filters,
    );

    await (getFlowpropertyTableAll as any)(params, sort, 'en', 'tg', [], 100, filters);
    await (getFlowpropertyTablePgroongaSearch as any)(
      params,
      'en',
      'tg',
      'property',
      {},
      100,
      [],
      filters,
    );
    await (getFlowpropertyTableUuidMentionSearch as any)(
      params,
      'en',
      'tg',
      'property-id',
      100,
      [],
      filters,
    );

    await (getFlowTableAll as any)(params, sort, 'en', 'tg', [], {}, 100, filters);
    await (getFlowTablePgroongaSearch as any)(
      params,
      'en',
      'tg',
      'flow',
      {},
      100,
      undefined,
      [],
      filters,
    );
    await (getFlowTableUuidMentionSearch as any)(params, 'en', 'tg', 'flow-id', 100, [], filters);

    await (getLifeCycleModelTableAll as any)(params, sort, 'en', 'tg', '', 100, filters);
    await (getLifeCycleModelTablePgroongaSearch as any)(
      params,
      'en',
      'tg',
      'model',
      {},
      100,
      undefined,
      [],
      filters,
    );
    await (getLifeCycleModelTableUuidMentionSearch as any)(
      params,
      'en',
      'tg',
      'model-id',
      100,
      [],
      filters,
    );

    await (getProcessTableAll as any)(params, sort, 'en', 'tg', [], 100, undefined, filters);
    await (getProcessTablePgroongaSearch as any)(
      params,
      'en',
      'tg',
      'process',
      {},
      100,
      undefined,
      undefined,
      [],
      false,
      filters,
    );
    await (getProcessTableUuidMentionSearch as any)(
      params,
      'en',
      'tg',
      'process-id',
      100,
      undefined,
      [],
      filters,
    );

    await (getSourceTableAll as any)(params, sort, 'en', 'tg', [], 100, filters);
    await (getSourceTablePgroongaSearch as any)(params, 'en', 'tg', 'source', {}, 100, [], filters);
    await (getSourceTableUuidMentionSearch as any)(
      params,
      'en',
      'tg',
      'source-id',
      100,
      [],
      filters,
    );

    await (getUnitGroupTableAll as any)(params, sort, 'en', 'tg', [], 100, filters);
    await (getUnitGroupTablePgroongaSearch as any)(
      params,
      'en',
      'tg',
      'unit group',
      {},
      100,
      [],
      filters,
    );
    await (getUnitGroupTableUuidMentionSearch as any)(
      params,
      'en',
      'tg',
      'unit-group-id',
      100,
      [],
      filters,
    );

    expect(mockQueryMappedOpenDataCatalog).toHaveBeenCalledTimes(21);
    const routeMatrix = mockQueryMappedOpenDataCatalog.mock.calls.map(([options]) => ({
      datasetKind: options.datasetKind,
      mode: options.mode,
    }));
    expect(routeMatrix).toEqual(
      [
        'contact',
        'flowproperty',
        'flow',
        'lifecyclemodel',
        'process',
        'source',
        'unitgroup',
      ].flatMap((datasetKind) =>
        ['list', 'lexical', 'uuid'].map((mode) => ({
          datasetKind,
          mode,
        })),
      ),
    );
    expect(
      mockQueryMappedOpenDataCatalog.mock.calls.every(([options]) => options.filters === filters),
    ).toBe(true);
  });

  it('preserves positional signatures outside the open-data scope', () => {
    expect(getOpenDataCatalogFilterArgs('tg', filters)).toEqual([filters]);
    expect(getOpenDataCatalogFilterArgs('my', filters)).toEqual([]);
  });
});
