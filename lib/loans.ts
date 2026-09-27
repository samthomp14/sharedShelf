import { supabase } from './supabase';
import { log } from './log';
import type { CopyLendStatus, LoanEndedReason, LoanRequestStatus } from './database.types';

// Lending v2. Every change goes through a database step function (see
// supabase/migrations/20260925020423_lending_v2_expand.sql), which checks
// who's calling and the copy/loan state and raises a readable message
// otherwise — so the wrappers below just throw Error(message) for the UI to
// show. Reads go straight to loans_v2 / loan_requests_v2, which only the
// owner and the requester/borrower can see.
//
// Copy states: available | unavailable | promised | on_loan. Friends see the
// state on the shelf item; show promised/on_loan to them as "Unavailable".

export interface Person {
  id: string;
  username: string;
  display_name: string | null;
  avatar_url: string | null;
}

type Named = Pick<Person, 'username' | 'display_name'> | null | undefined;

export function personName(p: Named): string {
  return p?.display_name ?? p?.username ?? 'Someone';
}

// For tight spots like the label under a cover: "Sam", not "Sam Thompson".
export function firstName(p: Named): string {
  return personName(p).split(' ')[0];
}

export interface BookRef {
  id: string;
  title: string;
  authors: string[];
  cover_url: string | null;
}

export interface ActiveLoan {
  id: string;
  shelf_item_id: string | null;
  created_at: string; // when it was promised (or lent, for a direct lend)
  handed_over_at: string | null; // null = promised, not handed over yet
  owner: Person | null;
  borrower: Person | null;
  book: BookRef | null;
}

export interface PendingRequest {
  id: string;
  shelf_item_id: string | null;
  created_at: string;
  requester: Person | null;
  book: BookRef | null;
}

export interface MyCopy {
  id: string;
  lend_status: CopyLendStatus;
  visibility: 'friends' | 'private';
  book: BookRef | null;
  activeLoan: ActiveLoan | null;
  pendingRequests: PendingRequest[];
}

export interface MyRequest {
  id: string;
  status: LoanRequestStatus;
  created_at: string;
  responded_at: string | null;
}

const PERSON = 'id, username, display_name, avatar_url';
const BOOK = 'id, title, authors, cover_url';
const LOAN_FIELDS = `id, shelf_item_id, created_at, handed_over_at, book:books(${BOOK}), owner:profiles!loans_v2_owner_id_fkey(${PERSON}), borrower:profiles!loans_v2_borrower_id_fkey(${PERSON})`;
const REQUEST_FIELDS = `id, shelf_item_id, created_at, book:books(${BOOK}), requester:profiles!loan_requests_v2_requester_id_fkey(${PERSON})`;

// ---------------------------------------------------------------------------
// Steps

async function step<T>(
  name: string,
  args: Record<string, unknown>,
  run: () => PromiseLike<{ data: T | null; error: { message: string; code?: string } | null }>
): Promise<T> {
  const { data, error } = await run();
  if (error) {
    // Expected refusals (wrong state, not allowed, not found) are warnings;
    // anything else is a real failure.
    const expected = ['55000', '42501', 'P0002', '22023'].includes(error.code ?? '');
    (expected ? log.warn : log.error)(`loans.${name}_failed`, { ...args, code: error.code, error: error.message });
    throw new Error(error.message);
  }
  return data as T;
}

// Ask to borrow a friend's available copy. Returns the request id.
export function requestLoan(shelfItemId: string): Promise<string> {
  return step('request', { shelfItemId }, () =>
    supabase.rpc('request_loan', { p_shelf_item_id: shelfItemId })
  );
}

// Withdraw your own pending request.
export async function cancelRequest(requestId: string): Promise<void> {
  await step('cancel_request', { requestId }, () =>
    supabase.rpc('cancel_request', { p_request_id: requestId })
  );
}

// Owner: say yes. The copy becomes promised, every other pending request on
// it is declined. Returns the new loan id.
export function acceptRequest(requestId: string): Promise<string> {
  return step('accept', { requestId }, () =>
    supabase.rpc('accept_request', { p_request_id: requestId })
  );
}

// Owner: say no.
export async function declineRequest(requestId: string): Promise<void> {
  await step('decline', { requestId }, () =>
    supabase.rpc('decline_request', { p_request_id: requestId })
  );
}

// Owner or borrower: call off a promised loan before the hand-off.
export async function callOffLoan(loanId: string): Promise<void> {
  await step('call_off', { loanId }, () => supabase.rpc('call_off_loan', { p_loan_id: loanId }));
}

// Borrower ("Got it") or owner: the book changed hands. Copy -> on_loan.
export async function markHandedOver(loanId: string): Promise<void> {
  await step('handed_over', { loanId }, () =>
    supabase.rpc('mark_handed_over', { p_loan_id: loanId })
  );
}

// Owner: lend an available copy straight to a friend (already handed over).
// Returns the new loan id.
export function lendToFriend(shelfItemId: string, friendId: string): Promise<string> {
  return step('lend_to_friend', { shelfItemId, friendId }, () =>
    supabase.rpc('lend_to_friend', { p_shelf_item_id: shelfItemId, p_friend_id: friendId })
  );
}

// Owner: the book is back. Copy -> available.
export async function markReturned(loanId: string): Promise<void> {
  await step('returned', { loanId }, () => supabase.rpc('mark_returned', { p_loan_id: loanId }));
}

// Owner: switch a copy between available and unavailable (not while it's
// promised or on loan). Going unavailable declines pending requests.
export async function setCopyAvailable(shelfItemId: string, available: boolean): Promise<void> {
  await step('set_available', { shelfItemId, available }, () =>
    supabase.rpc('set_copy_available', { p_shelf_item_id: shelfItemId, p_available: available })
  );
}

// Owner: show a copy to friends or hide it (any time, even while lent).
// Hiding declines pending requests.
export async function setCopyVisible(shelfItemId: string, visible: boolean): Promise<void> {
  await step('set_visibility', { shelfItemId, visible }, () =>
    supabase.rpc('set_copy_visibility', { p_shelf_item_id: shelfItemId, p_visible: visible })
  );
}

// Removing a copy is the existing removeFromShelf (lib/bookLookup.ts); a
// trigger closes its active loan with ended_reason 'removed'.

// ---------------------------------------------------------------------------
// Reads

function fail(name: string, error: { message: string }): never {
  log.error(`loans.${name}_failed`, { error: error.message });
  throw new Error(error.message);
}

// Your copies with their status, active loan (if any) and pending requests.
export async function fetchMyCopies(uid: string): Promise<MyCopy[]> {
  const { data, error } = await supabase
    .from('shelf_items')
    .select(
      `id, lend_status, visibility, sort_order, created_at, book:books(${BOOK}), loans:loans_v2(${LOAN_FIELDS}), requests:loan_requests_v2(${REQUEST_FIELDS})`
    )
    .eq('owner_id', uid)
    .is('loans.ended_at', null)
    .eq('requests.status', 'pending')
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: false });
  if (error) fail('my_copies', error);

  return ((data ?? []) as any[]).map((row) => ({
    id: row.id,
    lend_status: row.lend_status,
    visibility: row.visibility,
    book: row.book,
    activeLoan: (row.loans?.[0] as ActiveLoan | undefined) ?? null,
    pendingRequests: ((row.requests ?? []) as PendingRequest[]).sort((a, b) =>
      a.created_at.localeCompare(b.created_at)
    ),
  }));
}

// Books you've lent out (promised or handed over), newest first.
export async function fetchLentOut(uid: string): Promise<ActiveLoan[]> {
  const { data, error } = await supabase
    .from('loans_v2')
    .select(LOAN_FIELDS)
    .eq('owner_id', uid)
    .is('ended_at', null)
    .order('created_at', { ascending: false });
  if (error) fail('lent_out', error);
  return (data ?? []) as unknown as ActiveLoan[];
}

// Books you're borrowing (promised to you or in your hands), newest first.
export async function fetchBorrowing(uid: string): Promise<ActiveLoan[]> {
  const { data, error } = await supabase
    .from('loans_v2')
    .select(LOAN_FIELDS)
    .eq('borrower_id', uid)
    .is('ended_at', null)
    .order('created_at', { ascending: false });
  if (error) fail('borrowing', error);
  return (data ?? []) as unknown as ActiveLoan[];
}

// Pending requests on one copy, oldest first. The owner sees all of them;
// anyone else only sees their own (RLS).
export async function fetchPendingRequests(shelfItemId: string): Promise<PendingRequest[]> {
  const { data, error } = await supabase
    .from('loan_requests_v2')
    .select(REQUEST_FIELDS)
    .eq('shelf_item_id', shelfItemId)
    .eq('status', 'pending')
    .order('created_at', { ascending: true });
  if (error) fail('pending_requests', error);
  return (data ?? []) as unknown as PendingRequest[];
}

// Every pending request on your copies (the "Needs you" list), oldest first.
export async function fetchIncomingRequests(uid: string): Promise<PendingRequest[]> {
  const { data, error } = await supabase
    .from('loan_requests_v2')
    .select(REQUEST_FIELDS)
    .eq('owner_id', uid)
    .eq('status', 'pending')
    .order('created_at', { ascending: true });
  if (error) fail('incoming_requests', error);
  return (data ?? []) as unknown as PendingRequest[];
}

// Requests you've sent that are still waiting on the owner, newest first.
export interface OutgoingRequest {
  id: string;
  shelf_item_id: string | null;
  created_at: string;
  owner: Person | null;
  book: BookRef | null;
}

export async function fetchMyPendingRequests(uid: string): Promise<OutgoingRequest[]> {
  const { data, error } = await supabase
    .from('loan_requests_v2')
    .select(
      `id, shelf_item_id, created_at, book:books(${BOOK}), owner:profiles!loan_requests_v2_owner_id_fkey(${PERSON})`
    )
    .eq('requester_id', uid)
    .eq('status', 'pending')
    .order('created_at', { ascending: false });
  if (error) fail('my_pending_requests', error);
  return (data ?? []) as unknown as OutgoingRequest[];
}

// Your most recent request on a copy (any status), or null if you never asked.
// status 'pending' = waiting on the owner.
export async function fetchMyRequest(shelfItemId: string, uid: string): Promise<MyRequest | null> {
  const { data, error } = await supabase
    .from('loan_requests_v2')
    .select('id, status, created_at, responded_at')
    .eq('shelf_item_id', shelfItemId)
    .eq('requester_id', uid)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) fail('my_request', error);
  return data ?? null;
}

// ---------------------------------------------------------------------------
// Activity feed

export type LoanFeedKind =
  | 'requested' // requester asked (owner's feed)
  | 'declined' // owner said no (requester's feed)
  | 'promised' // owner accepted; waiting for the hand-off
  | 'handed_over' // book changed hands (also a direct lend)
  | 'called_off' // promised loan called off; see byMe
  | 'returned'
  | 'removed'; // "X removed <book> from their shelf. The loan's closed."

export interface LoanFeedEvent {
  key: string;
  timestamp: string;
  kind: LoanFeedKind;
  role: 'owner' | 'borrower'; // your side of it (a requester counts as borrower)
  byMe: boolean; // you took this step
  loanId: string | null;
  requestId: string | null;
  counterpart: Person;
  book: BookRef;
}

// Loan steps for the two people involved, newest first. Merge these into the
// Activity feed alongside shelf adds / new friends. Rows keep book_id after a
// copy is removed, so 'removed' events still have a book.
export async function fetchLoanActivity(uid: string, limit = 30): Promise<LoanFeedEvent[]> {
  const [loansRes, requestsRes] = await Promise.all([
    supabase
      .from('loans_v2')
      .select(
        `id, owner_id, borrower_id, request_id, created_at, handed_over_at, ended_at, ended_reason, ended_by, book:books(${BOOK}), owner:profiles!loans_v2_owner_id_fkey(${PERSON}), borrower:profiles!loans_v2_borrower_id_fkey(${PERSON})`
      )
      .or(`owner_id.eq.${uid},borrower_id.eq.${uid}`)
      .order('created_at', { ascending: false })
      .limit(limit),
    supabase
      .from('loan_requests_v2')
      .select(
        `id, owner_id, requester_id, status, created_at, responded_at, book:books(${BOOK}), owner:profiles!loan_requests_v2_owner_id_fkey(${PERSON}), requester:profiles!loan_requests_v2_requester_id_fkey(${PERSON})`
      )
      .or(`owner_id.eq.${uid},requester_id.eq.${uid}`)
      .order('created_at', { ascending: false })
      .limit(limit),
  ]);
  if (loansRes.error) fail('activity_loans', loansRes.error);
  if (requestsRes.error) fail('activity_requests', requestsRes.error);

  const events: LoanFeedEvent[] = [];

  for (const row of (loansRes.data ?? []) as any[]) {
    const role: LoanFeedEvent['role'] = row.owner_id === uid ? 'owner' : 'borrower';
    const counterpart: Person | null = role === 'owner' ? row.borrower : row.owner;
    if (!counterpart || !row.book) continue;
    const base = { role, loanId: row.id as string, requestId: row.request_id as string | null, counterpart, book: row.book };

    // A loan that started handed over (direct lend, or backfilled) has no
    // separate "promised" moment.
    if (!row.handed_over_at || Date.parse(row.handed_over_at) > Date.parse(row.created_at)) {
      events.push({ ...base, key: `loan-${row.id}-promised`, timestamp: row.created_at, kind: 'promised', byMe: role === 'owner' });
    }
    if (row.handed_over_at) {
      // Who confirmed isn't stored; a direct lend is the owner's step, and the
      // usual case otherwise is the borrower tapping "Got it".
      const direct = !row.request_id && Date.parse(row.handed_over_at) === Date.parse(row.created_at);
      events.push({
        ...base,
        key: `loan-${row.id}-handed_over`,
        timestamp: row.handed_over_at,
        kind: 'handed_over',
        byMe: direct ? role === 'owner' : role === 'borrower',
      });
    }
    if (row.ended_at && row.ended_reason) {
      const reason = row.ended_reason as LoanEndedReason;
      events.push({
        ...base,
        key: `loan-${row.id}-${reason}`,
        timestamp: row.ended_at,
        kind: reason,
        byMe: row.ended_by === uid,
      });
    }
  }

  for (const row of (requestsRes.data ?? []) as any[]) {
    const role: LoanFeedEvent['role'] = row.owner_id === uid ? 'owner' : 'borrower';
    const counterpart: Person | null = role === 'owner' ? row.requester : row.owner;
    if (!counterpart || !row.book) continue;
    const base = { role, loanId: null, requestId: row.id as string, counterpart, book: row.book };

    // Pending requests to you show in "Needs you"; this is the history line.
    if (role === 'owner' || row.status === 'pending') {
      events.push({ ...base, key: `request-${row.id}`, timestamp: row.created_at, kind: 'requested', byMe: role === 'borrower' });
    }
    if (row.status === 'declined' && row.responded_at && role === 'borrower') {
      events.push({ ...base, key: `request-${row.id}-declined`, timestamp: row.responded_at, kind: 'declined', byMe: false });
    }
  }

  events.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  return events.slice(0, limit);
}
