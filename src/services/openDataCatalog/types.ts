export type OpenDataDatasetKind =
  'process' | 'flow' | 'lifecyclemodel' | 'contact' | 'source' | 'unitgroup' | 'flowproperty';

export type OpenDataSourceFilter = 'all' | 'literature' | 'enterprise';
export type OpenDataPublicationFilter = 'all' | 'published' | 'unpublished';

export type OpenDataCatalogFilters = {
  sourceFilter: OpenDataSourceFilter;
  publicationFilter?: OpenDataPublicationFilter;
};

export const DEFAULT_OPEN_DATA_FILTERS: OpenDataCatalogFilters = {
  sourceFilter: 'all',
  publicationFilter: 'all',
};

export function getOpenDataCatalogFilterArgs(
  dataSource: string,
  filters: OpenDataCatalogFilters,
): [] | [OpenDataCatalogFilters] {
  if (dataSource === 'tg') return [filters];
  return [];
}
