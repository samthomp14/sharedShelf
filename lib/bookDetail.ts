import { supabase } from './supabase';
import { prefetch, consumePrefetch, clearPrefetch } from './prefetch';
import type { CopyLendStatus } from './database.types';
import { personName, type Person } from './loans';

const PERSON = 'id, username, display_name, avatar_url';

export interface BookInfo {
  id: string;
  title: string;
  authors: string[];
  cover_url: string | null;
}

// A copy of the book you can see: yours, or a friend's shared one.
export interface BookCopy {
  id: string;
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

// Everything the book page shows, in one round of parallel queries. No user
// id needed: RLS already limits loans/requests to the ones you're part of,
// which is also why this can be prefetched before the screen mounts.
async function fetchBookDetail(id: string): Promise<BookDetail> {
  const [bookRes, copiesRes, loansRes, requestsRes] = await Promise.all([
    supabase.from('books').select('id, title, authors, cover_url').eq('id', id).single(),
    supabase
      .from('shelf_items')
      .select(`id, owner_id, lend_status, visibility, created_at, owner:profiles(${PERSON})`)
      .eq('book_id', id),
    supabase
      .from('loans_v2')
      .select(
        `id, shelf_item_id, owner_id, borrower_id, created_at, handed_over_at, request:loan_requests_v2!loans_v2_request_id_fkey(created_at), owner:profiles!loans_v2_owner_id_fkey(${PERSON}), borrower:profiles!loans_v2_borrower_id_fkey(${PERSON})`
      )
      .eq('book_id', id)
      .is('ended_at', null),
    supabase
      .from('loan_requests_v2')
      .select(
        `id, shelf_item_id, requester_id, created_at, requester:profiles!loan_requests_v2_requester_id_fkey(${PERSON})`
      )
      .eq('book_id', id)
      .eq('status', 'pending')
      .order('created_at', { ascending: true }),
  ]);

  return {
    book: bookRes.error ? null : (bookRes.data as BookInfo),
    bookError: !!bookRes.error,
    copies: copiesRes.error ? null : (copiesRes.data as unknown as BookCopy[]),
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
