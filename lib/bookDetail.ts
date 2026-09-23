import { supabase } from './supabase';
import { prefetch, consumePrefetch, clearPrefetch } from './prefetch';

function fetchBookAndCopies(id: string) {
  return Promise.all([
    supabase.from('books').select('id, title, authors, cover_url').eq('id', id).single(),
    supabase
      .from('shelf_items')
      .select('id, status, owner_id, owner:profiles(username, display_name)')
      .eq('book_id', id),
  ]);
}

export type BookAndCopiesResult = Awaited<ReturnType<typeof fetchBookAndCopies>>;

// Called from onPressIn on a book row, so the request is already in flight by
// the time the book screen mounts and calls loadBookAndCopies for the same id.
export function prefetchBook(id: string) {
  prefetch(`book:${id}`, () => fetchBookAndCopies(id));
}

// `fresh` (pull-to-refresh, returning to the app) skips any prefetched result
// and always hits the network.
export function loadBookAndCopies(
  id: string,
  { fresh = false }: { fresh?: boolean } = {}
): Promise<BookAndCopiesResult> {
  if (fresh) {
    clearPrefetch(`book:${id}`);
    return fetchBookAndCopies(id);
  }
  return consumePrefetch<BookAndCopiesResult>(`book:${id}`) ?? fetchBookAndCopies(id);
}
