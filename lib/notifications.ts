import { useCallback, useEffect, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { supabase } from './supabase';
import { log } from './log';
import { useAuth } from '../contexts/AuthContext';
import { useRefetchOnVisible } from './refresh';
import { onPushReceived, setAppBadge } from './push';
import {
  fetchBorrowing,
  fetchIncomingRequests,
  fetchLentOut,
  fetchLoanActivity,
  type ActiveLoan,
  type LoanFeedEvent,
  type PendingRequest,
  type Person,
} from './loans';

// The Notifications screen (behind the header bell): "Needs you" — things
// waiting on you — and "Earlier", the finished loan steps you were part of.

// A line in "Earlier": a finished loan step, or someone you became friends with.
export type EarlierItem =
  | { kind: 'loan'; key: string; timestamp: string; event: LoanFeedEvent }
  | { kind: 'new_friend'; key: string; timestamp: string; friend: Person };

export type NeedsYouItem =
  | { kind: 'borrow_request'; key: string; timestamp: string; request: PendingRequest }
  | { kind: 'hand_over'; key: string; timestamp: string; loan: ActiveLoan } // you promised it
  | { kind: 'pick_up'; key: string; timestamp: string; loan: ActiveLoan } // promised to you
  | { kind: 'friend_request'; key: string; timestamp: string; id: string; requester: Person };

// Lending reads throw on failure (lib/loans logs them); an empty list keeps
// the rest of the screen working.
function orEmpty<T>(promise: Promise<T[]>): Promise<T[]> {
  return promise.catch(() => []);
}

async function fetchFriendRequests(uid: string): Promise<{ id: string; created_at: string; requester: Person | null }[]> {
  const { data, error } = await supabase
    .from('friendships')
    .select(
      'id, created_at, requester:profiles!friendships_requester_id_fkey(id, username, display_name, avatar_url)'
    )
    .eq('status', 'pending')
    .eq('addressee_id', uid)
    .order('created_at', { ascending: true });
  if (error) {
    log.error('notifications.friend_requests_failed', { error: error.message });
    return [];
  }
  return (data ?? []) as unknown as { id: string; created_at: string; requester: Person | null }[];
}

// Friendships you're in, newest first, as "You and X are now friends".
async function fetchNewFriends(uid: string, limit = 30): Promise<EarlierItem[]> {
  const { data, error } = await supabase
    .from('friendships')
    .select(
      'id, requester_id, responded_at, created_at, requester:profiles!friendships_requester_id_fkey(id, username, display_name, avatar_url), addressee:profiles!friendships_addressee_id_fkey(id, username, display_name, avatar_url)'
    )
    .eq('status', 'accepted')
    .or(`requester_id.eq.${uid},addressee_id.eq.${uid}`)
    .order('responded_at', { ascending: false })
    .limit(limit);
  if (error) {
    log.error('notifications.new_friends_failed', { error: error.message });
    return [];
  }
  return ((data ?? []) as any[]).flatMap((row): EarlierItem[] => {
    const friend = (row.requester_id === uid ? row.addressee : row.requester) as Person | null;
    return friend
      ? [{ kind: 'new_friend', key: `friend-${row.id}`, timestamp: row.responded_at ?? row.created_at, friend }]
      : [];
  });
}

// Everything waiting on you, grouped by kind (borrow requests first, then
// hand-offs, then friend requests), oldest first within each.
export async function fetchNeedsYou(uid: string): Promise<NeedsYouItem[]> {
  const [requests, lentOut, borrowing, friendRequests] = await Promise.all([
    orEmpty(fetchIncomingRequests(uid)),
    orEmpty(fetchLentOut(uid)),
    orEmpty(fetchBorrowing(uid)),
    fetchFriendRequests(uid),
  ]);
  const promised = (loans: ActiveLoan[]) =>
    loans.filter((loan) => !loan.handed_over_at).sort((a, b) => a.created_at.localeCompare(b.created_at));

  return [
    ...requests.map((request): NeedsYouItem => ({
      kind: 'borrow_request',
      key: `request-${request.id}`,
      timestamp: request.created_at,
      request,
    })),
    ...promised(lentOut).map((loan): NeedsYouItem => ({
      kind: 'hand_over',
      key: `hand-over-${loan.id}`,
      timestamp: loan.created_at,
      loan,
    })),
    ...promised(borrowing).map((loan): NeedsYouItem => ({
      kind: 'pick_up',
      key: `pick-up-${loan.id}`,
      timestamp: loan.created_at,
      loan,
    })),
    ...friendRequests.flatMap((req): NeedsYouItem[] =>
      req.requester
        ? [{ kind: 'friend_request', key: `friend-${req.id}`, timestamp: req.created_at, id: req.id, requester: req.requester }]
        : []
    ),
  ];
}

// Needs you, plus "Earlier": the loan history and new friendships, minus the
// history lines for anything still in Needs you (a pending request's "asked
// to borrow", a promised loan's "promised") so nothing shows twice.
export async function fetchNotifications(
  uid: string
): Promise<{ needsYou: NeedsYouItem[]; earlier: EarlierItem[] }> {
  const [needsYou, activity, newFriends] = await Promise.all([
    fetchNeedsYou(uid),
    orEmpty(fetchLoanActivity(uid)),
    fetchNewFriends(uid),
  ]);

  const pendingRequestIds = new Set<string>();
  const promisedLoanIds = new Set<string>();
  for (const item of needsYou) {
    if (item.kind === 'borrow_request') pendingRequestIds.add(item.request.id);
    if (item.kind === 'hand_over' || item.kind === 'pick_up') promisedLoanIds.add(item.loan.id);
  }

  const loanLines = activity
    .filter((event) => {
      if (event.kind === 'requested' && event.requestId && pendingRequestIds.has(event.requestId)) return false;
      if (event.kind === 'promised' && event.loanId && promisedLoanIds.has(event.loanId)) return false;
      return true;
    })
    .map((event): EarlierItem => ({ kind: 'loan', key: event.key, timestamp: event.timestamp, event }));

  const earlier = [...loanLines, ...newFriends]
    .sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp))
    .slice(0, 40);
  return { needsYou, earlier };
}

// Just the number for the bell: head-only counts, no rows.
export async function fetchNeedsYouCount(uid: string): Promise<number> {
  const [requests, promised, friends] = await Promise.all([
    supabase
      .from('loan_requests_v2')
      .select('id', { count: 'exact', head: true })
      .eq('owner_id', uid)
      .eq('status', 'pending'),
    // Promised loans on either side: you hand it over, or you pick it up.
    supabase
      .from('loans_v2')
      .select('id', { count: 'exact', head: true })
      .or(`owner_id.eq.${uid},borrower_id.eq.${uid}`)
      .is('ended_at', null)
      .is('handed_over_at', null),
    supabase
      .from('friendships')
      .select('id', { count: 'exact', head: true })
      .eq('addressee_id', uid)
      .eq('status', 'pending'),
  ]);
  for (const res of [requests, promised, friends]) {
    if (res.error) log.warn('notifications.count_failed', { error: res.error.message });
  }
  return (requests.count ?? 0) + (promised.count ?? 0) + (friends.count ?? 0);
}

// The bell's badge count, refetched whenever the screen under it regains
// focus (e.g. coming back from Notifications) or the app comes back.
export function useNeedsYouCount(): number {
  const { session } = useAuth();
  const uid = session?.user?.id ?? null;
  const [count, setCount] = useState(0);

  const load = useCallback(async () => {
    if (!uid) {
      setCount(0);
      return;
    }
    const next = await fetchNeedsYouCount(uid);
    setCount(next);
    setAppBadge(next);
  }, [uid]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );
  useRefetchOnVisible(load);
  useEffect(() => onPushReceived(load), [load]);

  return count;
}
