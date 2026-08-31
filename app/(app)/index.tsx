import { useCallback, useState } from 'react';
import { useFocusEffect, useRouter } from 'expo-router';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { supabase } from '../../lib/supabase';
import { Button } from '../../components/Button';
import { colors, fonts } from '../../lib/theme';

interface LoanRequestNeedsYou {
  id: string;
  requester: { id: string; username: string; display_name: string | null } | null;
  shelf_item: { book: { title: string } | null } | null;
}

interface FriendRequestNeedsYou {
  id: string;
  requester: { id: string; username: string; display_name: string | null } | null;
}

type FeedEvent =
  | {
      key: string;
      timestamp: string;
      kind: 'shelf_add';
      actorId: string;
      actorName: string;
      bookId: string;
      bookTitle: string;
    }
  | { key: string; timestamp: string; kind: 'new_friend'; friendId: string; friendName: string }
  | {
      key: string;
      timestamp: string;
      kind: 'loan_active';
      role: 'lender' | 'borrower';
      loanId: string;
      counterpartId: string;
      counterpartName: string;
      bookTitle: string;
    }
  | {
      key: string;
      timestamp: string;
      kind: 'loan_returned';
      role: 'lender' | 'borrower';
      counterpartId: string;
      counterpartName: string;
      bookTitle: string;
    };

function personName(p: { username: string; display_name: string | null } | null | undefined) {
  return p?.display_name ?? p?.username ?? 'Someone';
}

export default function Activity() {
  const router = useRouter();
  const [loanRequests, setLoanRequests] = useState<LoanRequestNeedsYou[]>([]);
  const [friendRequests, setFriendRequests] = useState<FriendRequestNeedsYou[]>([]);
  const [events, setEvents] = useState<FeedEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [actingId, setActingId] = useState<string | null>(null);
  const [returningId, setReturningId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const { data: userData } = await supabase.auth.getUser();
    const uid = userData.user?.id;
    if (!uid) {
      setLoading(false);
      return;
    }

    const [loanReqRes, friendReqRes, shelfAddRes, friendshipsRes, loansRes] = await Promise.all([
      supabase
        .from('loan_requests')
        .select(
          'id, requester:profiles(id, username, display_name), shelf_item:shelf_items!inner(id, owner_id, book:books(title))'
        )
        .eq('status', 'pending')
        .eq('shelf_item.owner_id', uid),
      supabase
        .from('friendships')
        .select('id, requester:profiles!friendships_requester_id_fkey(id, username, display_name)')
        .eq('status', 'pending')
        .eq('addressee_id', uid),
      supabase
        .from('shelf_items')
        .select('id, created_at, owner:profiles(id, username, display_name), book:books(id, title)')
        .neq('owner_id', uid)
        .order('created_at', { ascending: false })
        .limit(30),
      supabase
        .from('friendships')
        .select(
          'id, requester_id, addressee_id, responded_at, created_at, requester:profiles!friendships_requester_id_fkey(id, username, display_name), addressee:profiles!friendships_addressee_id_fkey(id, username, display_name)'
        )
        .eq('status', 'accepted')
        .order('responded_at', { ascending: false })
        .limit(30),
      supabase
        .from('loans')
        .select(
          'id, lender_id, borrower_id, started_at, returned_at, shelf_item:shelf_items(book:books(title)), lender:profiles!loans_lender_id_fkey(id, username, display_name), borrower:profiles!loans_borrower_id_fkey(id, username, display_name)'
        )
        .or(`lender_id.eq.${uid},borrower_id.eq.${uid}`)
        .order('started_at', { ascending: false })
        .limit(30),
    ]);

    if (!loanReqRes.error && loanReqRes.data) {
      setLoanRequests(loanReqRes.data as unknown as LoanRequestNeedsYou[]);
    }
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
          actorName: personName(row.owner),
          bookId: row.book.id,
          bookTitle: row.book.title,
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
          friendName: personName(friend),
        });
      }
    }

    if (!loansRes.error && loansRes.data) {
      for (const row of loansRes.data as any[]) {
        const bookTitle = row.shelf_item?.book?.title ?? 'a book';
        const role: 'lender' | 'borrower' = row.lender_id === uid ? 'lender' : 'borrower';
        const counterpart = role === 'lender' ? row.borrower : row.lender;
        if (!counterpart) continue;
        if (row.returned_at) {
          merged.push({
            key: `loan-${row.id}-returned`,
            timestamp: row.returned_at,
            kind: 'loan_returned',
            role,
            counterpartId: counterpart.id,
            counterpartName: personName(counterpart),
            bookTitle,
          });
        } else {
          merged.push({
            key: `loan-${row.id}-active`,
            timestamp: row.started_at,
            kind: 'loan_active',
            role,
            loanId: row.id,
            counterpartId: counterpart.id,
            counterpartName: personName(counterpart),
            bookTitle,
          });
        }
      }
    }

    merged.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
    setEvents(merged.slice(0, 40));
    setLoading(false);
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  async function respondLoanRequest(requestId: string, status: 'accepted' | 'declined') {
    setActingId(requestId);
    const { error } = await supabase
      .from('loan_requests')
      .update({ status, responded_at: new Date().toISOString() })
      .eq('id', requestId);
    setActingId(null);
    if (!error) load();
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

  async function markReturned(loanId: string) {
    setReturningId(loanId);
    await supabase
      .from('loans')
      .update({ returned_at: new Date().toISOString() })
      .eq('id', loanId);
    setReturningId(null);
    load();
  }

  const hasNeedsYou = loanRequests.length > 0 || friendRequests.length > 0;

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />}
    >
      {hasNeedsYou && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Needs you</Text>
          {loanRequests.map((req) => (
            <View key={req.id} style={styles.needsYouRow}>
              <Text style={styles.needsYouText}>
                <Text style={styles.bold}>{personName(req.requester)}</Text> wants to borrow "
                {req.shelf_item?.book?.title ?? 'a book'}"
              </Text>
              <View style={styles.needsYouActions}>
                <Button
                  title="Decline"
                  variant="secondary"
                  onPress={() => respondLoanRequest(req.id, 'declined')}
                  loading={actingId === req.id}
                />
                <Button
                  title="Accept"
                  onPress={() => respondLoanRequest(req.id, 'accepted')}
                  loading={actingId === req.id}
                />
              </View>
            </View>
          ))}
          {friendRequests.map((req) => (
            <View key={req.id} style={styles.needsYouRow}>
              <Text style={styles.needsYouText}>
                <Text style={styles.bold}>{personName(req.requester)}</Text> sent you a friend
                request
              </Text>
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
          </View>
        ) : (
          events.map((event) => (
            <Pressable
              key={event.key}
              style={styles.eventRow}
              onPress={() => {
                if (event.kind === 'shelf_add') router.push(`/book/${event.bookId}`);
                else if (event.kind === 'new_friend') router.push(`/profile/${event.friendId}`);
                else router.push(`/profile/${event.counterpartId}`);
              }}
            >
              {event.kind === 'shelf_add' && (
                <Text style={styles.eventText}>
                  <Text style={styles.bold}>{event.actorName}</Text> added "{event.bookTitle}" to
                  their shelf
                </Text>
              )}
              {event.kind === 'new_friend' && (
                <Text style={styles.eventText}>
                  You and <Text style={styles.bold}>{event.friendName}</Text> are now friends
                </Text>
              )}
              {event.kind === 'loan_active' && (
                <View style={styles.loanRow}>
                  <Text style={styles.eventText}>
                    {event.role === 'lender' ? (
                      <>
                        You lent "{event.bookTitle}" to{' '}
                        <Text style={styles.bold}>{event.counterpartName}</Text>
                      </>
                    ) : (
                      <>
                        <Text style={styles.bold}>{event.counterpartName}</Text> lent you "
                        {event.bookTitle}"
                      </>
                    )}
                  </Text>
                  {event.role === 'lender' && (
                    <Button
                      title="Mark returned"
                      variant="secondary"
                      onPress={() => markReturned(event.loanId)}
                      loading={returningId === event.loanId}
                    />
                  )}
                </View>
              )}
              {event.kind === 'loan_returned' && (
                <Text style={styles.eventText}>
                  {event.role === 'lender' ? (
                    <>
                      <Text style={styles.bold}>{event.counterpartName}</Text> returned "
                      {event.bookTitle}"
                    </>
                  ) : (
                    <>
                      You returned "{event.bookTitle}" to{' '}
                      <Text style={styles.bold}>{event.counterpartName}</Text>
                    </>
                  )}
                </Text>
              )}
            </Pressable>
          ))
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
  needsYouRow: {
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    gap: 8,
  },
  needsYouText: {
    fontFamily: fonts.regular,
    fontSize: 14,
    color: colors.text,
  },
  needsYouActions: {
    flexDirection: 'row',
    gap: 8,
  },
  eventRow: {
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  eventText: {
    fontFamily: fonts.regular,
    fontSize: 14,
    color: colors.text,
  },
  loanRow: {
    gap: 8,
  },
  bold: {
    fontFamily: fonts.semibold,
    color: colors.text,
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
});
