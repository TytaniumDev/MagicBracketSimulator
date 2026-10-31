import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { setDecksExcluded, type DeckLibrary } from '../api';
import { useSetDecksExcluded } from './useDeckLibrary';

vi.mock('../api', () => ({
  fetchDeckLibrary: vi.fn(),
  setDecksExcluded: vi.fn(),
}));

const LIBRARY: DeckLibrary = { decks: [], excludedDeckIds: ['a'], communityDecksFailed: false };

function setup() {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  client.setQueryData(['deckLibrary'], LIBRARY);
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  const { result } = renderHook(() => useSetDecksExcluded(), { wrapper });
  const excludedIds = () => client.getQueryData<DeckLibrary>(['deckLibrary'])?.excludedDeckIds;
  return { result, excludedIds };
}

/** A save that stays in flight until `finish` or `fail` is called. */
function pendingSave() {
  let finish!: (ids: string[]) => void;
  let fail!: (error: Error) => void;
  vi.mocked(setDecksExcluded).mockReturnValueOnce(
    new Promise((resolve, reject) => {
      finish = resolve;
      fail = reject;
    }),
  );
  return { finish: (ids: string[]) => finish(ids), fail: (error: Error) => fail(error) };
}

describe('useSetDecksExcluded', () => {
  beforeEach(() => {
    vi.mocked(setDecksExcluded).mockReset();
  });

  it('changes the cached library before the save finishes', async () => {
    const save = pendingSave();
    const { result, excludedIds } = setup();

    act(() => result.current.mutate({ deckIds: ['b', 'c'], excluded: true }));
    await waitFor(() => expect(excludedIds()).toEqual(['a', 'b', 'c']));
    expect(setDecksExcluded).toHaveBeenCalledWith(['b', 'c'], true);

    await act(async () => save.finish(['a', 'b', 'c']));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(excludedIds()).toEqual(['a', 'b', 'c']);
  });

  it('puts the decks back when the save fails', async () => {
    const save = pendingSave();
    const { result, excludedIds } = setup();

    act(() => result.current.mutate({ deckIds: ['a', 'b'], excluded: false }));
    await waitFor(() => expect(excludedIds()).toEqual([]));

    await act(async () => save.fail(new Error('HTTP 500')));
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(excludedIds()).toEqual(['a']);
  });

  it('keeps a later change when an earlier save answers first', async () => {
    const first = pendingSave();
    const second = pendingSave();
    const { result, excludedIds } = setup();

    act(() => result.current.mutate({ deckIds: ['b'], excluded: true }));
    act(() => result.current.mutate({ deckIds: ['c'], excluded: true }));
    await waitFor(() => expect(excludedIds()).toEqual(['a', 'b', 'c']));

    // The first answer doesn't know about 'c' yet.
    await act(async () => first.finish(['a', 'b']));
    expect(excludedIds()).toEqual(['a', 'b', 'c']);

    await act(async () => second.finish(['a', 'b', 'c']));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(excludedIds()).toEqual(['a', 'b', 'c']);
  });
});
