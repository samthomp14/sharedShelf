import { supabase } from './supabase';
import { prefetch, consumePrefetch, clearPrefetch } from './prefetch';
import type { CopyLendStatus } from './database.types';
import { personName, type Person } from './loans';
import { log } from './log';

const PERSON = 'id, username, display_name, avatar_url';

// The edition the route points at (id/title/authors/cover are its own), plus
// the work it belongs to, which holds what every edition shares.
export interface BookInfo {
  id: string;
  title: string;
  authors: string[];
  cover_url: string | null;
  work_id: string | null;
  publisher: string | null;
  page_count: number | null;
  work: {
    id: string;
    subtitle: string | null;
    description: string | null;
    first_publish_year: number | null;
    categories: string[];
    description_checked_at: string | null; // null = enrich-book hasn't looked yet
    authors: { id: string; name: string }[]; // credit order
  } | null;
}

// A copy of the book you can see: yours, or a friend's shared one. Copies of
// every edition of the work come back, so each says which edition it is.
export interface BookCopy {
  id: string;
  book_id: string;
  cover_url: string | null; // that edition's cover
  owner_id: string;
  lend_status: CopyLendStatus;
  visibility: 'friends' | 'private'; // friends only ever get 'friends' copies (RLS)
  created_at: string; // when it went on the owner's shelf
  owner: Person | null;
}

// An active loan (promised or handed over) on one of this book's copies.
// Only loans you're part of come back (RLS), as owner or borrower.
export interface BookLoan {
  id: string;
  shelf_item_id: string | null;
  owner_id: string;
  borrower_id: string;
  created_at: string;
  handed_over_at: string | null;
  return_claimed_at: string | null; // borrower says it's back; waiting on the owner
  // The request it came from, for the "asked" step; null for a direct lend.
  request: { created_at: string } | null;
  owner: Person | null;
  borrower: Person | null;
}

// A pending request on one of this book's copies: requests on your copies,
// plus your own requests on friends' copies (RLS hides everyone else's).
export interface BookRequest {
  id: string;
  shelf_item_id: string | null;
  requester_id: string;
  created_at: string;
  requester: Person | null;
}

export interface BookDetail {
  book: BookInfo | null;
  bookError: boolean;
  copies: BookCopy[] | null; // null = failed to load
  loans: BookLoan[];
  requests: BookRequest[];
}

const BOOK_FIELDS =
  'id, title, authors, cover_url, work_id, publisher, page_count, work:works(id, subtitle, description, first_publish_year, categories, description_checked_at, editions:books(id, cover_url), work_authors(position, author:authors(id, name)))';

// Everything the book page shows, for every edition of the work: the book (with
// its work and sibling editions) first, then copies/loans/requests in one round
// of parallel queries. No user id needed: RLS already limits loans/requests to
// the ones you're part of, which is also why this can be prefetched before the
// screen mounts.
async function fetchBookDetail(id: string): Promise<BookDetail> {
  const bookRes = await supabase.from('books').select(BOOK_FIELDS).eq('id', id).single();

  const editions: { id: string; cover_url: string | null }[] = bookRes.data?.work?.editions ?? [];
  // If the book didn't load, still try its own copies.
  const ids = editions.length > 0 ? editions.map((e) => e.id) : [id];
  const coverOf = new Map(editions.map((e) => [e.id, e.cover_url]));

  const [copiesRes, loansRes, requestsRes] = await Promise.all([
    supabase
      .from('shelf_items')
      .select(`id, book_id, owner_id, lend_status, visibility, created_at, owner:profiles(${PERSON})`)
      .in('book_id', ids),
    supabase
      .from('loans_v2')
      .select(
        `id, shelf_item_id, owner_id, borrower_id, created_at, handed_over_at, return_claimed_at, request:loan_requests_v2!loans_v2_request_id_fkey(created_at), owner:profiles!loans_v2_owner_id_fkey(${PERSON}), borrower:profiles!loans_v2_borrower_id_fkey(${PERSON})`
      )
      .in('book_id', ids)
      .is('ended_at', null),
    supabase
      .from('loan_requests_v2')
      .select(
        `id, shelf_item_id, requester_id, created_at, requester:profiles!loan_requests_v2_requester_id_fkey(${PERSON})`
      )
      .in('book_id', ids)
      .eq('status', 'pending')
      .order('created_at', { ascending: true }),
  ]);

  let book: BookInfo | null = null;
  if (bookRes.data) {
    // work.editions was only needed for the ids above; keep it off BookInfo.
    const { work, ...edition } = bookRes.data;
    book = {
      ...edition,
      work: work && {
        id: work.id,
        subtitle: work.subtitle,
        description: work.description,
        first_publish_year: work.first_publish_year,
        categories: work.categories,
        description_checked_at: work.description_checked_at,
        authors: [...(work.work_authors ?? [])]
          .sort((a, b) => a.position - b.position)
          .flatMap((wa) => (wa.author ? [wa.author] : [])),
      },
    };
  }

  return {
    book,
    bookError: !!bookRes.error,
    copies: copiesRes.error
      ? null
      : (copiesRes.data as unknown as Omit<BookCopy, 'cover_url'>[]).map((c) => ({
          ...c,
          cover_url: coverOf.get(c.book_id) ?? null,
        })),
    loans: (loansRes.data ?? []) as unknown as BookLoan[],
    requests: (requestsRes.data ?? []) as unknown as BookRequest[],
  };
}

// Called from onPressIn on a book row, so the request is already in flight by
// the time the book screen mounts and calls loadBookDetail for the same id.
export function prefetchBook(id: string) {
  prefetch(`book:${id}`, () => fetchBookDetail(id));
}

// `fresh` (pull-to-refresh, returning to the app, after a lending step) skips
// any prefetched result and always hits the network.
export function loadBookDetail(
  id: string,
  { fresh = false }: { fresh?: boolean } = {}
): Promise<BookDetail> {
  if (fresh) {
    clearPrefetch(`book:${id}`);
    return fetchBookDetail(id);
  }
  return consumePrefetch<BookDetail>(`book:${id}`) ?? fetchBookDetail(id);
}

// Asks enrich-book to fill in the work's description/categories (it only looks
// once per work). The book page calls this when work.description_checked_at is
// null, then reloads with fresh: true. Never throws: the function may not be
// deployed, and the page is fine without a description.
export async function requestBookDetails(bookId: string): Promise<boolean> {
  try {
    const { error } = await supabase.functions.invoke('enrich-book', { body: { book_id: bookId } });
    if (error) {
      log.warn('book_detail.enrich_failed', { bookId, error: error.message });
      return false;
    }
    return true;
  } catch (e) {
    log.warn('book_detail.enrich_failed', { bookId, error: e });
    return false;
  }
}

// Your accepted friends, by name, for the "Lend to a friend" picker.
export async function fetchFriends(uid: string): Promise<Person[]> {
  const { data, error } = await supabase
    .from('friendships')
    .select(
      `requester_id, requester:profiles!friendships_requester_id_fkey(${PERSON}), addressee:profiles!friendships_addressee_id_fkey(${PERSON})`
    )
    .eq('status', 'accepted')
    .or(`requester_id.eq.${uid},addressee_id.eq.${uid}`);
  if (error) throw new Error(error.message);

  return ((data ?? []) as any[])
    .map((row) => (row.requester_id === uid ? row.addressee : row.requester) as Person | null)
    .filter((p): p is Person => !!p)
    .sort((a, b) => personName(a).localeCompare(personName(b)));
}
