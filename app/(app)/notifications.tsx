import { useCallback, useState, type ReactNode } from 'react';
import { Link, useFocusEffect } from 'expo-router';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { supabase } from '../../lib/supabase';
import { prefetchBook } from '../../lib/bookDetail';
import {
  acceptRequest,
  callOffLoan,
  declineRequest,
  markHandedOver,
  personName,
  type BookRef,
} from '../../lib/loans';
import { fetchNotifications, type EarlierItem, type NeedsYouItem } from '../../lib/notifications';
import { useAuth } from '../../contexts/AuthContext';
import { Avatar } from '../../components/Avatar';
import { Button } from '../../components/Button';
import { RefreshControl } from '../../components/RefreshControl';
import { ToastProvider, useToast } from '../../components/Toast';
import { CoverThumb } from '../../components/activity/CoverThumb';
import { LoanEventText } from '../../components/activity/LoanEventText';
import { bookHref, PersonLink } from '../../components/activity/links';
import { useRefetchOnVisible, useRefreshing } from '../../lib/refresh';
import { timeAgo } from '../../lib/time';
import { colors, fonts } from '../../lib/theme';

export default function Notifications() {
  return (
    <ToastProvider>
      <NotificationsList />
    </ToastProvider>
  );
}

function NotificationsList() {
  const { session } = useAuth();
  const toast = useToast();
  const uid = session?.user?.id ?? null;
  const [needsYou, setNeedsYou] = useState<NeedsYouItem[]>([]);
  const [earlier, setEarlier] = useState<EarlierItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [actingId, setActingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!uid) {
      setLoading(false);
      return;
    }
    const result = await fetchNotifications(uid);
    setNeedsYou(result.needsYou);
    setEarlier(result.earlier);
    setLoading(false);
  }, [uid]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );
  const { refreshing, onRefresh } = useRefreshing(load);
  useRefetchOnVisible(load);

  // Runs one step on a card, shows its refusal (if any) as a toast, then
  // reloads — the state may have moved on either way. `actingId` is the
  // card's key, so only that card's buttons spin.
  async function runStep(key: string, run: () => Promise<unknown>) {
    setActingId(key);
    try {
      await run();
    } catch (e) {
      toast.show({ message: e instanceof Error ? e.message : 'Something went wrong' });
    }
    setActingId(null);
    load();
  }

  async function respondFriendRequest(requestId: string, accept: boolean) {
    const { error } = accept
      ? await supabase
          .from('friendships')
          .update({ status: 'accepted', responded_at: new Date().toISOString() })
          .eq('id', requestId)
      : await supabase.from('friendships').delete().eq('id', requestId);
    if (error) throw new Error(error.message);
  }

  function renderCard(item: NeedsYouItem) {
    const busy = actingId === item.key;

    switch (item.kind) {
      case 'borrow_request': {
        const { request } = item;
        return (
          <NeedsYouCard
            key={item.key}
            eyebrow="Borrow request"
            book={request.book}
            line={
              <>
                {request.requester ? <PersonLink person={request.requester} /> : 'Someone'} wants to borrow
              </>
            }
            timestamp={timeAgo(request.created_at)}
          >
            <Button
              title="Accept"
              size="compact"
              onPress={() => runStep(item.key, () => acceptRequest(request.id))}
              loading={busy}
            />
            <Button
              title="Decline"
              variant="ghost"
              size="compact"
              onPress={() => runStep(item.key, () => declineRequest(request.id))}
              disabled={busy}
            />
          </NeedsYouCard>
        );
      }
      case 'hand_over':
      case 'pick_up': {
        const { loan } = item;
        const handOver = item.kind === 'hand_over';
        return (
          <NeedsYouCard
            key={item.key}
            eyebrow={handOver ? 'Hand over' : 'Pick up'}
            book={loan.book}
            line={
              handOver ? (
                <>You promised it to {loan.borrower ? <PersonLink person={loan.borrower} /> : 'someone'}</>
              ) : (
                <>{loan.owner ? <PersonLink person={loan.owner} /> : 'Someone'} is lending you</>
              )
            }
            timestamp={`${handOver ? 'Promised' : 'Said yes'} ${timeAgo(loan.created_at)}`}
          >
            <Button
              title={handOver ? 'Handed over' : 'Got it'}
              variant="secondary"
              size="compact"
              onPress={() => runStep(item.key, () => markHandedOver(loan.id))}
              loading={busy}
            />
            <Button
              title="Call off"
              variant="ghost"
              size="compact"
              onPress={() => runStep(item.key, () => callOffLoan(loan.id))}
              disabled={busy}
            />
          </NeedsYouCard>
        );
      }
      case 'friend_request':
        return (
          <NeedsYouCard
            key={item.key}
            eyebrow="Friend request"
            avatar={<Avatar avatarUrl={item.requester.avatar_url} label={personName(item.requester)} size={40} />}
            line={
              <>
                <PersonLink person={item.requester} /> wants to be friends
              </>
            }
            timestamp={timeAgo(item.timestamp)}
          >
            <Button
              title="Accept"
              size="compact"
              onPress={() => runStep(item.key, () => respondFriendRequest(item.id, true))}
              loading={busy}
            />
            <Button
              title="Decline"
              variant="secondary"
              size="compact"
              onPress={() => runStep(item.key, () => respondFriendRequest(item.id, false))}
              disabled={busy}
            />
          </NeedsYouCard>
        );
    }
  }

  const isEmpty = needsYou.length === 0 && earlier.length === 0;

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
    >
      {isEmpty && !loading && (
        <View style={styles.empty}>
          <Text style={styles.emptyTitle}>You're all caught up</Text>
          <Text style={styles.emptyBody}>
            Borrow requests, hand-offs and friend requests will show up here.
          </Text>
        </View>
      )}

      {needsYou.length > 0 && (
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Needs you</Text>
            <Text style={styles.sectionCount}>{needsYou.length}</Text>
          </View>
          <View style={styles.cards}>{needsYou.map(renderCard)}</View>
        </View>
      )}

      {earlier.length > 0 && (
        <View style={styles.section}>
          <Text style={[styles.sectionTitle, styles.sectionHeader]}>Earlier</Text>
          {earlier.map((item, i) => {
            const person = item.kind === 'loan' ? item.event.counterpart : item.friend;
            return (
              <View key={item.key} style={[styles.row, i === earlier.length - 1 && styles.lastRow]}>
                <Avatar avatarUrl={person.avatar_url} label={personName(person)} size={40} />
                <View style={styles.rowMiddle}>
                  <Text style={styles.eventText}>
                    {item.kind === 'loan' ? (
                      <LoanEventText event={item.event} />
                    ) : (
                      <>
                        You and <PersonLink person={item.friend} /> are now friends
                      </>
                    )}
                  </Text>
                  <Text style={styles.timestamp}>{timeAgo(item.timestamp)}</Text>
                </View>
                {item.kind === 'loan' && <CoverThumb book={item.event.book} linked />}
              </View>
            );
          })}
        </View>
      )}
    </ScrollView>
  );
}

// One "Needs you" card: what it is, who and which book, when, and the
// buttons — with the cover inset on the right (or, for a friend request,
// their avatar on the left).
function NeedsYouCard({
  eyebrow,
  line,
  book,
  avatar,
  timestamp,
  children,
}: {
  eyebrow: string;
  line: ReactNode;
  book?: BookRef | null;
  avatar?: ReactNode;
  timestamp: string;
  children: ReactNode;
}) {
  return (
    <View style={styles.card}>
      {avatar && <View style={styles.cardAvatar}>{avatar}</View>}
      <View style={styles.cardBody}>
        <Text style={styles.eyebrow}>{eyebrow}</Text>
        <Text style={styles.eventText}>{line}</Text>
        {book && (
          <Link
            href={bookHref(book.id, book.title, book.cover_url)}
            onPressIn={() => prefetchBook(book.id)}
            style={styles.bookTitle}
          >
            {book.title}
          </Link>
        )}
        <Text style={styles.timestamp}>{timestamp}</Text>
        <View style={styles.actions}>{children}</View>
      </View>
      {book && <CoverThumb book={book} width={76} linked />}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: 16, flexGrow: 1 },
  section: {
    marginBottom: 24,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  sectionTitle: {
    fontFamily: fonts.semibold,
    fontSize: 13,
    color: colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  sectionCount: {
    fontFamily: fonts.regular,
    fontSize: 12,
    color: colors.textFaint,
  },
  cards: {
    gap: 12,
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    // A touch lighter than the page so the cards lift off it.
    backgroundColor: '#fbfcfd',
  },
  cardAvatar: {
    alignSelf: 'flex-start',
  },
  cardBody: {
    flex: 1,
    minWidth: 0,
    gap: 3,
  },
  eyebrow: {
    fontFamily: fonts.bold,
    fontSize: 11,
    letterSpacing: 0.66,
    textTransform: 'uppercase',
    color: colors.accent,
  },
  bookTitle: {
    fontFamily: fonts.display,
    fontSize: 15,
    lineHeight: 20,
    color: colors.text,
  },
  actions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 4,
    marginTop: 8,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  lastRow: {
    borderBottomWidth: 0,
  },
  rowMiddle: {
    flex: 1,
  },
  eventText: {
    fontFamily: fonts.regular,
    fontSize: 14,
    lineHeight: 20,
    color: colors.text,
  },
  timestamp: {
    fontFamily: fonts.regular,
    fontSize: 12,
    color: colors.textFaint,
    marginTop: 3,
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
