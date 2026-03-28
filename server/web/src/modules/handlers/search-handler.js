export function createSearchHandlers(deps) {
  return {
    search_results: (msg) => {
      if (deps.search) deps.search.handleSearchResults(msg);
    },
    search_index_stats: (msg) => {
      if (deps.search) deps.search.handleSearchIndexStats(msg);
    },
  };
}
