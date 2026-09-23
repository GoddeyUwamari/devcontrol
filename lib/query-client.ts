import { QueryClient, DefaultOptions } from '@tanstack/react-query';

const queryConfig: DefaultOptions = {
  queries: {
    refetchOnWindowFocus: false,
    retry: 1,
    staleTime: 5 * 60 * 1000, // 5 minutes
    gcTime: 10 * 60 * 1000, // 10 minutes (formerly cacheTime)
  },
  mutations: {
    retry: 0,
  },
};

export const queryClient = new QueryClient({
  defaultOptions: queryConfig,
});

/**
 * Drops every cached query/mutation belonging to the previous identity.
 *
 * `queryClient` is a module-level singleton that lives for the whole browser
 * tab, and login/logout are soft (client-side) navigations -- so without this,
 * user B logging in after user A in the same tab would be served A's cached
 * tenant data.
 *
 * Cancel first, then clear: cancelling makes any still-in-flight request from
 * the old identity settle as cancelled (its eventual response is discarded
 * rather than written back), and clearing then removes both the already-cached
 * data and those cancelled queries, so nothing from the old identity can
 * repopulate the cache afterwards. cancelQueries() resolves as soon as the
 * cancellations settle -- it does not wait for the network.
 *
 * (In the current @tanstack/query-core, clear() also silently cancels each
 * query it removes. The explicit cancelQueries() keeps this guarantee from
 * depending on that internal detail.)
 */
export async function resetQueryClientForIdentityChange(client: QueryClient): Promise<void> {
  await client.cancelQueries();
  client.clear();
}
