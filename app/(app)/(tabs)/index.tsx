import { useCallback, useState } from 'react';
import { useFocusEffect, type Href } from 'expo-router';
import { Image, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { supabase } from '../../../lib/supabase';
import { prefetchBook } from '../../../lib/bookDetail';
import { profileHref } from '../../../lib/profileHref';
import { useAuth } from '../../../contexts/AuthContext';
import { Avatar } from '../../../components/Avatar';
import { Button } from '../../../components/Button';
import { InlineLink } from '../../../components/InlineLink';
import { timeAgo } from '../../../lib/time';
import { colors, fonts, radius } from '../../../lib/theme';

function bookHref(id: string, title: string, coverUrl: string | null): Href {
  return { pathname: '/book/[id]', params: { id, title, coverUrl: coverUrl ?? '' } };
}

interface LoanRequestNeedsYou {
  id: string;
  created_at: string;
  requester: {
    id: string;
    username: string;
    display_name: string | null;
    avatar_url: string | null;
  } | null;
  shelf_item: { book: { id: string; title: string; cover_url: string | null } | null } | null;
}

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
      kind: 'loan_active';
      role: 'lender' | 'borrower';
      loanId: string;
      counterpartId: string;
      counterpartUsername: string;
      counterpartName: string;
      counterpartAvatarUrl: string | null;
      bookId: string;
      bookTitle: string;
      bookCoverUrl: string | null;
    }
  | {
      key: string;
      timestamp: string;
      kind: 'loan_returned';
      role: 'lender' | 'borrower';
      counterpartId: string;
      counterpartUsername: string;
      counterpartName: string;
      counterpartAvatarUrl: string | null;
      bookId: string;
      bookTitle: string;
      bookCoverUrl: string | null;
    };

function personName(p: { username: string; display_name: string | null } | null | undefined) {
  return p?.display_name ?? p?.username ?? 'Someone';
}

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
  const { session } = useAuth();
  const uid = session?.user?.id ?? null;
  const [loanRequests, setLoanRequests] = useState<LoanRequestNeedsYou[]>([]);
  const [friendRequests, setFriendRequests] = useState<FriendRequestNeedsYou[]>([]);
  const [events, setEvents] = useState<FeedEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [actingId, setActingId] = useState<string | null>(null);
  const [returningId, setReturningId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!uid) {
      setLoading(false);
      return;
    }
    setLoading(true);

    const [loanReqRes, friendReqRes, shelfAddRes, friendshipsRes, loansRes] = await Promise.all([
      supabase
        .from('loan_requests')
        .select(
          'id, created_at, requester:profiles(id, username, display_name, avatar_url), shelf_item:shelf_items!inner(id, owner_id, book:books(id, title, cover_url))'
        )
        .eq('status', 'pending')
        .eq('shelf_item.owner_id', uid),
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
      supabase
        .from('loans')
        .select(
          'id, lender_id, borrower_id, started_at, returned_at, shelf_item:shelf_items(book:books(id, title, cover_url)), lender:profiles!loans_lender_id_fkey(id, username, display_name, avatar_url), borrower:profiles!loans_borrower_id_fkey(id, username, display_name, avatar_url)'
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

    if (!loansRes.error && loansRes.data) {
      for (const row of loansRes.data as any[]) {
        const book = row.shelf_item?.book;
        if (!book) continue;
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
            counterpartUsername: counterpart.username,
            counterpartName: personName(counterpart),
            counterpartAvatarUrl: counterpart.avatar_url,
            bookId: book.id,
            bookTitle: book.title,
            bookCoverUrl: book.cover_url,
          });
        } else {
          merged.push({
            key: `loan-${row.id}-active`,
            timestamp: row.started_at,
            kind: 'loan_active',
            role,
            loanId: row.id,
            counterpartId: counterpart.id,
            counterpartUsername: counterpart.username,
            counterpartName: personName(counterpart),
            counterpartAvatarUrl: counterpart.avatar_url,
            bookId: book.id,
            bookTitle: book.title,
            bookCoverUrl: book.cover_url,
          });
        }
      }
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
          {loanRequests.map((req) => {
            const book = req.shelf_item?.book;
            return (
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
                    wants to borrow "
                    {book ? (
                      <InlineLink
                        href={bookHref(book.id, book.title, book.cover_url)}
                        onPressIn={() => prefetchBook(book.id)}
                      >
                        {book.title}
                      </InlineLink>
                    ) : (
                      'a book'
                    )}
                    "
                  </Text>
                  <Text style={styles.timestamp}>{timeAgo(req.created_at)}</Text>
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
                {book && <CoverThumb url={book.cover_url} title={book.title} />}
              </View>
            );
          })}
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
          </View>
        ) : (
          events.map((event) => {
            const avatarUrl =
              event.kind === 'shelf_add'
                ? event.actorAvatarUrl
                : event.kind === 'new_friend'
                  ? event.friendAvatarUrl
                  : event.counterpartAvatarUrl;
            const avatarLabel =
              event.kind === 'shelf_add'
                ? event.actorName
                : event.kind === 'new_friend'
                  ? event.friendName
                  : event.counterpartName;

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
                          added "
                          <InlineLink
                            href={bookHref(event.bookId, event.bookTitle, event.bookCoverUrl)}
                            onPressIn={() => prefetchBook(event.bookId)}
                          >
                            {event.bookTitle}
                          </InlineLink>
                          " to their shelf
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
                      {event.kind === 'loan_active' &&
                        (event.role === 'lender' ? (
                          <>
                            You lent "
                            <InlineLink
                              href={bookHref(event.bookId, event.bookTitle, event.bookCoverUrl)}
                              onPressIn={() => prefetchBook(event.bookId)}
                            >
                              {event.bookTitle}
                            </InlineLink>
                            " to{' '}
                            <InlineLink
                              href={profileHref(event.counterpartUsername, event.counterpartName, event.counterpartAvatarUrl)}
                            >
                              {event.counterpartName}
                            </InlineLink>
                          </>
                        ) : (
                          <>
                            <InlineLink
                              href={profileHref(event.counterpartUsername, event.counterpartName, event.counterpartAvatarUrl)}
                            >
                              {event.counterpartName}
                            </InlineLink>{' '}
                            lent you "
                            <InlineLink
                              href={bookHref(event.bookId, event.bookTitle, event.bookCoverUrl)}
                              onPressIn={() => prefetchBook(event.bookId)}
                            >
                              {event.bookTitle}
                            </InlineLink>
                            "
                          </>
                        ))}
                      {event.kind === 'loan_returned' &&
                        (event.role === 'lender' ? (
                          <>
                            <InlineLink
                              href={profileHref(event.counterpartUsername, event.counterpartName, event.counterpartAvatarUrl)}
                            >
                              {event.counterpartName}
                            </InlineLink>{' '}
                            returned "
                            <InlineLink
                              href={bookHref(event.bookId, event.bookTitle, event.bookCoverUrl)}
                              onPressIn={() => prefetchBook(event.bookId)}
                            >
                              {event.bookTitle}
                            </InlineLink>
                            "
                          </>
                        ) : (
                          <>
                            You returned "
                            <InlineLink
                              href={bookHref(event.bookId, event.bookTitle, event.bookCoverUrl)}
                              onPressIn={() => prefetchBook(event.bookId)}
                            >
                              {event.bookTitle}
                            </InlineLink>
                            " to{' '}
                            <InlineLink
                              href={profileHref(event.counterpartUsername, event.counterpartName, event.counterpartAvatarUrl)}
                            >
                              {event.counterpartName}
                            </InlineLink>
                          </>
                        ))}
                  </Text>
                  <Text style={styles.timestamp}>{timeAgo(event.timestamp)}</Text>
                  {event.kind === 'loan_active' && event.role === 'lender' && (
                    <Button
                      title="Mark returned"
                      variant="secondary"
                      onPress={() => markReturned(event.loanId)}
                      loading={returningId === event.loanId}
                      style={styles.markReturnedButton}
                    />
                  )}
                </View>
                {(event.kind === 'shelf_add' ||
                  event.kind === 'loan_active' ||
                  event.kind === 'loan_returned') && (
                  <CoverThumb url={event.bookCoverUrl} title={event.bookTitle} />
                )}
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
  markReturnedButton: {
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
});
