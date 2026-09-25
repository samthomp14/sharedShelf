import { useCallback, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { Image, ScrollView, StyleSheet, Text, View } from 'react-native';
import { supabase } from '../../../lib/supabase';
import {
  acceptRequest,
  declineRequest,
  fetchBorrowing,
  fetchIncomingRequests,
  fetchLentOut,
  fetchLoanActivity,
  markHandedOver,
  markReturned,
  type ActiveLoan,
  type LoanFeedEvent,
  type PendingRequest,
} from '../../../lib/loans';
import { profileHref } from '../../../lib/profileHref';
import { useAuth } from '../../../contexts/AuthContext';
import { Avatar } from '../../../components/Avatar';
import { Button } from '../../../components/Button';
import { InlineLink } from '../../../components/InlineLink';
import { InstallBanner } from '../../../components/InstallBanner';
import { RefreshControl } from '../../../components/RefreshControl';
import { ShareAppButton } from '../../../components/ShareAppButton';
import { ToastProvider, useToast } from '../../../components/Toast';
import { LoanEventText } from '../../../components/activity/LoanEventText';
import { BookLink, PersonLink, personName } from '../../../components/activity/links';
import { useRefetchOnVisible, useRefreshing } from '../../../lib/refresh';
import { timeAgo } from '../../../lib/time';
import { colors, fonts, radius } from '../../../lib/theme';

interface FriendRequestNeedsYou {
  id: string;
  created_at: string;
  requester: {
    id: string;
    username: string;
    display_name: string | null;
    avatar_url: string | null;
  } | null;
}

type FeedEvent =
  | {
      key: string;
      timestamp: string;
      kind: 'shelf_add';
      actorId: string;
      actorUsername: string;
      actorName: string;
      actorAvatarUrl: string | null;
      bookId: string;
      bookTitle: string;
      bookCoverUrl: string | null;
    }
  | {
      key: string;
      timestamp: string;
      kind: 'new_friend';
      friendId: string;
      friendUsername: string;
      friendName: string;
      friendAvatarUrl: string | null;
    }
  | {
      key: string;
      timestamp: string;
      kind: 'loan';
      loan: LoanFeedEvent;
    };

function CoverThumb({ url, title }: { url: string | null; title: string }) {
  return url ? (
    <Image source={{ uri: url }} style={styles.cover} resizeMode="cover" />
  ) : (
    <View style={styles.coverPlaceholder}>
      <Text style={styles.coverPlaceholderText} numberOfLines={4}>
        {title}
      </Text>
    </View>
  );
}

export default function Activity() {
  return (
    <ToastProvider>
      <ActivityFeed />
    </ToastProvider>
  );
}

// Lending reads throw on failure (lib/loans logs them); an empty list keeps
// the rest of the screen working.
function orEmpty<T>(promise: Promise<T[]>): Promise<T[]> {
  return promise.catch(() => []);
}

function ActivityFeed() {
  const { session } = useAuth();
  const toast = useToast();
  const uid = session?.user?.id ?? null;
  const [loanRequests, setLoanRequests] = useState<PendingRequest[]>([]);
  // Promised loans waiting on the hand-off, from each side.
  const [toReceive, setToReceive] = useState<ActiveLoan[]>([]);
  const [toHandOver, setToHandOver] = useState<ActiveLoan[]>([]);
  // Your copies that are out with a friend — these get "Mark returned".
  const [onLoanIds, setOnLoanIds] = useState<Set<string>>(new Set());
  const [friendRequests, setFriendRequests] = useState<FriendRequestNeedsYou[]>([]);
  const [events, setEvents] = useState<FeedEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [actingId, setActingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!uid) {
      setLoading(false);
      return;
    }
    setLoading(true);

    const [friendReqRes, shelfAddRes, friendshipsRes, incoming, borrowing, lentOut, loanActivity] =
      await Promise.all([
        supabase
          .from('friendships')
          .select(
            'id, created_at, requester:profiles!friendships_requester_id_fkey(id, username, display_name, avatar_url)'
          )
          .eq('status', 'pending')
          .eq('addressee_id', uid),
        supabase
          .from('shelf_items')
          .select(
            'id, created_at, owner:profiles(id, username, display_name, avatar_url), book:books(id, title, cover_url)'
          )
          .neq('owner_id', uid)
          .order('created_at', { ascending: false })
          .limit(30),
        supabase
          .from('friendships')
          .select(
            'id, requester_id, addressee_id, responded_at, created_at, requester:profiles!friendships_requester_id_fkey(id, username, display_name, avatar_url), addressee:profiles!friendships_addressee_id_fkey(id, username, display_name, avatar_url)'
          )
          .eq('status', 'accepted')
          .order('responded_at', { ascending: false })
          .limit(30),
        orEmpty(fetchIncomingRequests(uid)),
        orEmpty(fetchBorrowing(uid)),
        orEmpty(fetchLentOut(uid)),
        orEmpty(fetchLoanActivity(uid)),
      ]);

    setLoanRequests(incoming);
    setToReceive(borrowing.filter((loan) => !loan.handed_over_at));
    setToHandOver(lentOut.filter((loan) => !loan.handed_over_at));
    setOnLoanIds(new Set(lentOut.filter((loan) => loan.handed_over_at).map((loan) => loan.id)));
    if (!friendReqRes.error && friendReqRes.data) {
      setFriendRequests(friendReqRes.data as unknown as FriendRequestNeedsYou[]);
    }

    const merged: FeedEvent[] = [];

    if (!shelfAddRes.error && shelfAddRes.data) {
      for (const row of shelfAddRes.data as any[]) {
        if (!row.book || !row.owner) continue;
        merged.push({
          key: `shelf-${row.id}`,
          timestamp: row.created_at,
          kind: 'shelf_add',
          actorId: row.owner.id,
          actorUsername: row.owner.username,
          actorName: personName(row.owner),
          actorAvatarUrl: row.owner.avatar_url,
          bookId: row.book.id,
          bookTitle: row.book.title,
          bookCoverUrl: row.book.cover_url,
        });
      }
    }

    if (!friendshipsRes.error && friendshipsRes.data) {
      for (const row of friendshipsRes.data as any[]) {
        const isRequester = row.requester_id === uid;
        const friend = isRequester ? row.addressee : row.requester;
        if (!friend) continue;
        merged.push({
          key: `friend-${row.id}`,
          timestamp: row.responded_at ?? row.created_at,
          kind: 'new_friend',
          friendId: friend.id,
          friendUsername: friend.username,
          friendName: personName(friend),
          friendAvatarUrl: friend.avatar_url,
        });
      }
    }

    for (const loan of loanActivity) {
      merged.push({ key: loan.key, timestamp: loan.timestamp, kind: 'loan', loan });
    }

    merged.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
    setEvents(merged.slice(0, 40));
    setLoading(false);
  }, [uid]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );
  const { refreshing, onRefresh } = useRefreshing(load);
  useRefetchOnVisible(load);

  // Runs one lending step, shows its refusal (if any) as a toast, then
  // reloads — the state may have moved on either way.
  async function runLoanStep(id: string, run: () => Promise<unknown>) {
    setActingId(id);
    try {
      await run();
    } catch (e) {
      toast.show({ message: e instanceof Error ? e.message : 'Something went wrong' });
    }
    setActingId(null);
    load();
  }

  async function respondFriendRequest(requestId: string, action: 'accept' | 'decline') {
    setActingId(requestId);
    if (action === 'accept') {
      await supabase
        .from('friendships')
        .update({ status: 'accepted', responded_at: new Date().toISOString() })
        .eq('id', requestId);
    } else {
      await supabase.from('friendships').delete().eq('id', requestId);
    }
    setActingId(null);
    load();
  }

  const hasNeedsYou =
    loanRequests.length > 0 ||
    toReceive.length > 0 ||
    toHandOver.length > 0 ||
    friendRequests.length > 0;

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
    >
      <InstallBanner />
      {hasNeedsYou && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Needs you</Text>
          {loanRequests.map((req) => (
            <View key={req.id} style={styles.row}>
              <Avatar
                avatarUrl={req.requester?.avatar_url}
                label={personName(req.requester)}
                size={40}
              />
              <View style={styles.rowMiddle}>
                <Text style={styles.eventText}>
                  {req.requester ? <PersonLink person={req.requester} /> : 'Someone'} wants to borrow{' '}
                  {req.book ? <BookLink book={req.book} /> : 'a book'}
                </Text>
                <Text style={styles.timestamp}>{timeAgo(req.created_at)}</Text>
                <View style={styles.needsYouActions}>
                  <Button
                    title="Decline"
                    variant="secondary"
                    onPress={() => runLoanStep(req.id, () => declineRequest(req.id))}
                    loading={actingId === req.id}
                  />
                  <Button
                    title="Accept"
                    onPress={() => runLoanStep(req.id, () => acceptRequest(req.id))}
                    loading={actingId === req.id}
                  />
                </View>
              </View>
              {req.book && <CoverThumb url={req.book.cover_url} title={req.book.title} />}
            </View>
          ))}
          {toReceive.map((loan) => (
            <View key={loan.id} style={styles.row}>
              <Avatar avatarUrl={loan.owner?.avatar_url} label={personName(loan.owner)} size={40} />
              <View style={styles.rowMiddle}>
                <Text style={styles.eventText}>
                  Did you get {loan.book ? <BookLink book={loan.book} /> : 'the book'} from{' '}
                  {loan.owner ? <PersonLink person={loan.owner} /> : 'them'}?
                </Text>
                <Text style={styles.timestamp}>Promised {timeAgo(loan.created_at)}</Text>
                <Button
                  title="Got it"
                  onPress={() => runLoanStep(loan.id, () => markHandedOver(loan.id))}
                  loading={actingId === loan.id}
                  style={styles.singleAction}
                />
              </View>
              {loan.book && <CoverThumb url={loan.book.cover_url} title={loan.book.title} />}
            </View>
          ))}
          {toHandOver.map((loan) => (
            <View key={loan.id} style={styles.row}>
              <Avatar avatarUrl={loan.borrower?.avatar_url} label={personName(loan.borrower)} size={40} />
              <View style={styles.rowMiddle}>
                <Text style={styles.eventText}>
                  You promised {loan.book ? <BookLink book={loan.book} /> : 'a book'} to{' '}
                  {loan.borrower ? <PersonLink person={loan.borrower} /> : 'someone'}
                </Text>
                <Text style={styles.timestamp}>{timeAgo(loan.created_at)}</Text>
                <Button
                  title="Mark handed over"
                  variant="secondary"
                  onPress={() => runLoanStep(loan.id, () => markHandedOver(loan.id))}
                  loading={actingId === loan.id}
                  style={styles.singleAction}
                />
              </View>
              {loan.book && <CoverThumb url={loan.book.cover_url} title={loan.book.title} />}
            </View>
          ))}
          {friendRequests.map((req) => (
            <View key={req.id} style={styles.row}>
              <Avatar
                avatarUrl={req.requester?.avatar_url}
                label={personName(req.requester)}
                size={40}
              />
              <View style={styles.rowMiddle}>
                <Text style={styles.eventText}>
                  <InlineLink
                    href={profileHref(req.requester?.username ?? '', req.requester?.display_name, req.requester?.avatar_url)}
                  >
                    {personName(req.requester)}
                  </InlineLink>{' '}
                  sent you a friend request
                </Text>
                <Text style={styles.timestamp}>{timeAgo(req.created_at)}</Text>
                <View style={styles.needsYouActions}>
                  <Button
                    title="Decline"
                    variant="secondary"
                    onPress={() => respondFriendRequest(req.id, 'decline')}
                    loading={actingId === req.id}
                  />
                  <Button
                    title="Accept"
                    onPress={() => respondFriendRequest(req.id, 'accept')}
                    loading={actingId === req.id}
                  />
                </View>
              </View>
            </View>
          ))}
        </View>
      )}

      <View style={styles.section}>
        {events.length > 0 && <Text style={styles.sectionTitle}>Recent</Text>}
        {events.length === 0 && !loading ? (
          <View style={styles.empty}>
            <Text style={styles.emptyTitle}>Nothing here yet</Text>
            <Text style={styles.emptyBody}>
              Add friends and books to start seeing activity.
            </Text>
            <ShareAppButton style={styles.emptyInvite} />
          </View>
        ) : (
          events.map((event) => {
            const avatarUrl =
              event.kind === 'shelf_add'
                ? event.actorAvatarUrl
                : event.kind === 'new_friend'
                  ? event.friendAvatarUrl
                  : event.loan.counterpart.avatar_url;
            const avatarLabel =
              event.kind === 'shelf_add'
                ? event.actorName
                : event.kind === 'new_friend'
                  ? event.friendName
                  : personName(event.loan.counterpart);
            // The hand-off line of a copy that's still out gets "Mark returned".
            const returnableLoanId =
              event.kind === 'loan' &&
              event.loan.kind === 'handed_over' &&
              event.loan.loanId &&
              onLoanIds.has(event.loan.loanId)
                ? event.loan.loanId
                : null;

            return (
              <View key={event.key} style={styles.row}>
                <Avatar avatarUrl={avatarUrl} label={avatarLabel} size={40} />
                <View style={styles.rowMiddle}>
                  <Text style={styles.eventText}>
                    {event.kind === 'shelf_add' && (
                        <>
                          <InlineLink href={profileHref(event.actorUsername, event.actorName, event.actorAvatarUrl)}>
                            {event.actorName}
                          </InlineLink>{' '}
                          added{' '}
                          <BookLink book={{ id: event.bookId, title: event.bookTitle, cover_url: event.bookCoverUrl }} />{' '}
                          to their shelf
                        </>
                      )}
                      {event.kind === 'new_friend' && (
                        <>
                          You and{' '}
                          <InlineLink href={profileHref(event.friendUsername, event.friendName, event.friendAvatarUrl)}>
                            {event.friendName}
                          </InlineLink>{' '}
                          are now friends
                        </>
                      )}
                      {event.kind === 'loan' && <LoanEventText event={event.loan} />}
                  </Text>
                  <Text style={styles.timestamp}>{timeAgo(event.timestamp)}</Text>
                  {returnableLoanId && (
                    <Button
                      title="Mark returned"
                      variant="secondary"
                      onPress={() => runLoanStep(returnableLoanId, () => markReturned(returnableLoanId))}
                      loading={actingId === returnableLoanId}
                      style={styles.singleAction}
                    />
                  )}
                </View>
                {event.kind === 'shelf_add' && <CoverThumb url={event.bookCoverUrl} title={event.bookTitle} />}
                {event.kind === 'loan' && <CoverThumb url={event.loan.book.cover_url} title={event.loan.book.title} />}
              </View>
            );
          })
        )}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: 16, flexGrow: 1 },
  section: {
    marginBottom: 16,
  },
  sectionTitle: {
    fontFamily: fonts.semibold,
    fontSize: 13,
    color: colors.textMuted,
    textTransform: 'uppercase',
    marginBottom: 8,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  rowMiddle: {
    flex: 1,
  },
  eventText: {
    fontFamily: fonts.regular,
    fontSize: 14,
    color: colors.text,
  },
  needsYouActions: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 8,
  },
  singleAction: {
    alignSelf: 'flex-start',
    marginTop: 8,
  },
  timestamp: {
    fontFamily: fonts.regular,
    fontSize: 12,
    color: colors.textFaint,
    marginTop: 3,
  },
  cover: {
    width: 40,
    height: 60,
    backgroundColor: colors.chipBackground,
    borderRadius: radius.sm,
    overflow: 'hidden',
  },
  coverPlaceholder: {
    width: 40,
    height: 60,
    backgroundColor: colors.chipBackground,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 3,
    borderRadius: radius.sm,
    overflow: 'hidden',
  },
  coverPlaceholderText: {
    fontFamily: fonts.display,
    fontSize: 8,
    color: colors.text,
    textAlign: 'center',
  },
  empty: { alignItems: 'center', justifyContent: 'center', paddingTop: 60 },
  emptyTitle: { fontFamily: fonts.semibold, fontSize: 18, color: colors.text, marginBottom: 8 },
  emptyBody: {
    fontFamily: fonts.regular,
    fontSize: 14,
    color: colors.textMuted,
    textAlign: 'center',
    paddingHorizontal: 32,
  },
  emptyInvite: { marginTop: 20, alignSelf: 'stretch', paddingHorizontal: 32 },
});
