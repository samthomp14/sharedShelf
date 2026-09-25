import { useCallback, useState } from 'react';
import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import { Image, ScrollView, StyleSheet, Text, View } from 'react-native';
import {
  loadBookDetail,
  type BookCopy,
  type BookInfo,
  type BookLoan,
  type BookRequest,
} from '../../../lib/bookDetail';
import { cancelRequest, lendToFriend, personName, requestLoan, type Person } from '../../../lib/loans';
import { useAuth } from '../../../contexts/AuthContext';
import { Chip } from '../../../components/Chip';
import { Button } from '../../../components/Button';
import { AuthorList } from '../../../components/AuthorList';
import { Skeleton } from '../../../components/Skeleton';
import { RefreshControl } from '../../../components/RefreshControl';
import { ToastProvider, useToast } from '../../../components/Toast';
import { BorrowingCard, OwnedCopyCard, type RunStep } from '../../../components/book/YourCopyCard';
import { FriendPicker } from '../../../components/book/FriendPicker';
import { useRefetchOnVisible, useRefreshing } from '../../../lib/refresh';
import { colors, fonts, organicCorners } from '../../../lib/theme';

function CopiesSkeleton() {
  return (
    <>
      {[0, 1].map((i) => (
        <View key={i} style={styles.copyRow}>
          <Skeleton width="45%" height={16} />
        </View>
      ))}
    </>
  );
}

// One page for everyone: a "Your copy" card on top for each copy you own or
// are borrowing/picking up, then the book and every copy you can see.
export default function BookDetailScreen() {
  return (
    <ToastProvider>
      <BookDetail />
    </ToastProvider>
  );
}

function BookDetail() {
  const { id, title: placeholderTitle, coverUrl: placeholderCoverUrl } = useLocalSearchParams<{
    id: string;
    title?: string;
    coverUrl?: string;
  }>();
  const { session } = useAuth();
  const uid = session?.user?.id ?? null;
  const toast = useToast();
  // The list you tapped from already had the title/cover — render with that
  // immediately instead of a blank screen while the full fetch is in flight.
  const [book, setBook] = useState<BookInfo | null>(() =>
    id && placeholderTitle
      ? { id, title: placeholderTitle, authors: [], cover_url: placeholderCoverUrl || null }
      : null
  );
  const [copies, setCopies] = useState<BookCopy[]>([]);
  const [loans, setLoans] = useState<BookLoan[]>([]);
  const [requests, setRequests] = useState<BookRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [bookLoaded, setBookLoaded] = useState(false);
  const [copiesLoaded, setCopiesLoaded] = useState(false);
  // Which lending step is in flight (see RunStep); one at a time.
  const [busy, setBusy] = useState<string | null>(null);
  // The copy "Lend to a friend" was tapped on, while the picker is open.
  const [lendingCopyId, setLendingCopyId] = useState<string | null>(null);

  const load = useCallback(async ({ fresh = false }: { fresh?: boolean } = {}) => {
    if (!id) return;
    setLoading(true);

    const detail = await loadBookDetail(id, { fresh });

    if (detail.book) {
      setBook(detail.book);
      setBookLoaded(true);
    } else if (detail.bookError) {
      setBook(null);
      setBookLoaded(true);
    }
    if (detail.copies) {
      setCopies(detail.copies);
      setLoans(detail.loans);
      setRequests(detail.requests);
    }
    setCopiesLoaded(true);
    setLoading(false);
  }, [id]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );
  // Explicit refreshes always go to the network, never a prefetched result.
  const refetch = useCallback(() => load({ fresh: true }), [load]);
  const { refreshing, onRefresh } = useRefreshing(refetch);
  useRefetchOnVisible(refetch);

  // The step functions refuse anything out of turn with a readable message
  // (e.g. someone else just called it off), so show it as-is and reload
  // either way: the page may simply have been out of date.
  const run: RunStep = useCallback(
    async (key, step, success) => {
      setBusy(key);
      try {
        await step();
        if (success) toast.show({ message: success });
      } catch (e) {
        toast.show({ message: e instanceof Error ? e.message : 'Something went wrong. Try again.' });
      }
      await load({ fresh: true });
      setBusy(null);
    },
    [load, toast]
  );

  function lendTo(friend: Person) {
    const copyId = lendingCopyId;
    setLendingCopyId(null);
    if (!copyId) return;
    run(`lend-${copyId}`, () => lendToFriend(copyId, friend.id), `Lent to ${personName(friend)}`);
  }

  const myCopies = copies.filter((c) => c.owner_id === uid);
  const borrowing = loans.filter((l) => l.borrower_id === uid);
  const loanFor = (copyId: string) => loans.find((l) => l.shelf_item_id === copyId) ?? null;
  const myRequestFor = (copyId: string) =>
    requests.find((r) => r.shelf_item_id === copyId && r.requester_id === uid) ?? null;

  // No placeholder to paint from (a direct/deep link, not tapped from a
  // list) — skeleton the whole layout until the first fetch lands.
  if (!book && loading) {
    return (
      <ScrollView style={styles.container} contentContainerStyle={styles.content}>
        <View style={styles.header}>
          <Skeleton width={160} height={240} style={styles.coverSkeleton} />
          <Skeleton width="70%" height={21} style={styles.titleSkeleton} />
          <Skeleton width="40%" height={15} style={styles.authorsSkeleton} />
        </View>
        <Text style={styles.sectionTitle}>Copies you can see</Text>
        <CopiesSkeleton />
      </ScrollView>
    );
  }

  if (!book) {
    return (
      <View style={styles.container}>
        <Text style={styles.emptyBody}>Couldn't find that book.</Text>
      </View>
    );
  }

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
    >
      {myCopies.map((copy) => (
        <OwnedCopyCard
          key={copy.id}
          copy={copy}
          loan={loanFor(copy.id)}
          requests={requests.filter((r) => r.shelf_item_id === copy.id && r.requester_id !== uid)}
          busy={busy}
          run={run}
          onLendToFriend={() => setLendingCopyId(copy.id)}
        />
      ))}
      {borrowing.map((loan) => (
        <BorrowingCard key={loan.id} loan={loan} busy={busy} run={run} />
      ))}

      <View style={styles.header}>
        {book.cover_url ? (
          <Image source={{ uri: book.cover_url }} style={styles.cover} resizeMode="cover" />
        ) : (
          <View style={styles.spinePlaceholder}>
            <Text style={styles.spineTitle} numberOfLines={6}>
              {book.title}
            </Text>
          </View>
        )}
        <Text style={styles.title}>{book.title}</Text>
        {bookLoaded ? (
          <AuthorList authors={book.authors} textStyle={styles.authors} />
        ) : (
          <Skeleton width="40%" height={15} style={styles.authorsSkeleton} />
        )}
      </View>

      <Text style={styles.sectionTitle}>Copies you can see</Text>
      {!copiesLoaded ? (
        <CopiesSkeleton />
      ) : copies.length === 0 ? (
        <Text style={styles.emptyBody}>
          No one in your circle has this on their shelf yet.
        </Text>
      ) : (
        copies.map((copy) => {
          const isMine = copy.owner_id === uid;
          const myLoan = isMine ? null : loanFor(copy.id);
          const myRequest = isMine ? null : myRequestFor(copy.id);
          // Friends' copies that are promised, lent or held back all read
          // "Unavailable" — who has it is only for the two people involved.
          const faded = !isMine && !myLoan && copy.lend_status !== 'available';
          return (
            <View key={copy.id} style={[styles.copyRow, faded && styles.copyRowFaded]}>
              <View style={{ flex: 1 }}>
                <Text style={styles.copyOwner}>{isMine ? 'You' : personName(copy.owner)}</Text>
              </View>
              {isMine ? (
                <Chip label={ownLabel(copy.lend_status)} />
              ) : myLoan ? (
                <Chip label={myLoan.handed_over_at ? 'Borrowing' : 'Promised to you'} />
              ) : copy.lend_status !== 'available' ? (
                <Chip label="Unavailable" />
              ) : myRequest ? (
                <>
                  <Chip label="Requested" />
                  <Button
                    title="Cancel"
                    variant="secondary"
                    onPress={() => run(`cancel-${myRequest.id}`, () => cancelRequest(myRequest.id), 'Request cancelled')}
                    loading={busy === `cancel-${myRequest.id}`}
                    disabled={busy !== null}
                  />
                </>
              ) : (
                <Button
                  title="Ask to borrow"
                  variant="secondary"
                  onPress={() =>
                    run(`request-${copy.id}`, () => requestLoan(copy.id), `Asked ${personName(copy.owner)}`)
                  }
                  loading={busy === `request-${copy.id}`}
                  disabled={busy !== null}
                />
              )}
            </View>
          );
        })
      )}

      {uid && (
        <FriendPicker
          visible={lendingCopyId !== null}
          uid={uid}
          onPick={lendTo}
          onClose={() => setLendingCopyId(null)}
        />
      )}
    </ScrollView>
  );
}

// Your own copy's state, as a short tag in the list (the card has the detail).
function ownLabel(status: BookCopy['lend_status']): string {
  switch (status) {
    case 'available':
      return 'Available';
    case 'unavailable':
      return 'Unavailable';
    case 'promised':
      return 'Promised';
    case 'on_loan':
      return 'Lent out';
  }
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: 16, flexGrow: 1 },
  header: {
    alignItems: 'center',
    marginBottom: 24,
  },
  cover: {
    width: 160,
    height: 240,
    backgroundColor: colors.chipBackground,
    marginBottom: 16,
    overflow: 'hidden',
    ...organicCorners,
  },
  spinePlaceholder: {
    width: 160,
    height: 240,
    backgroundColor: colors.chipBackground,
    marginBottom: 16,
    padding: 12,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    ...organicCorners,
  },
  spineTitle: {
    fontFamily: fonts.display,
    fontSize: 14,
    color: colors.text,
    textAlign: 'center',
  },
  title: {
    fontFamily: fonts.displaySemibold,
    fontSize: 21,
    color: colors.text,
    textAlign: 'center',
    marginBottom: 4,
  },
  titleSkeleton: {
    marginBottom: 8,
  },
  coverSkeleton: {
    marginBottom: 16,
    ...organicCorners,
  },
  authors: {
    fontSize: 15,
    color: colors.textMuted,
    textAlign: 'center',
  },
  authorsSkeleton: {
    marginTop: 4,
  },
  sectionTitle: {
    fontFamily: fonts.semibold,
    fontSize: 13,
    color: colors.textMuted,
    textTransform: 'uppercase',
    marginBottom: 8,
  },
  copyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  copyRowFaded: { opacity: 0.5 },
  copyOwner: { fontFamily: fonts.semibold, fontSize: 16, color: colors.text },
  emptyBody: {
    fontFamily: fonts.regular,
    fontSize: 14,
    color: colors.textMuted,
  },
});
