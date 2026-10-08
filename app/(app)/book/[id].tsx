import { useCallback, useEffect, useRef, useState } from 'react';
import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import { Image, ScrollView, StyleSheet, Text, View } from 'react-native';
import {
  loadBookDetail,
  requestBookDetails,
  type BookCopy,
  type BookInfo,
  type BookLoan,
  type BookRequest,
} from '../../../lib/bookDetail';
import { lendToFriend, personName, type Person } from '../../../lib/loans';
import { useAuth } from '../../../contexts/AuthContext';
import { AuthorList } from '../../../components/AuthorList';
import { Skeleton } from '../../../components/Skeleton';
import { RefreshControl } from '../../../components/RefreshControl';
import { ToastProvider, useToast } from '../../../components/Toast';
import {
  BorrowingCard,
  OwnedCopyCard,
  RequestCard,
  type RunStep,
} from '../../../components/book/YourCopyCard';
import { FriendCopies, FriendCopiesSkeleton } from '../../../components/book/FriendCopies';
import { FriendPicker } from '../../../components/book/FriendPicker';
import { BookAbout, BookAboutSkeleton, GenreChips, bookMetaLine } from '../../../components/book/BookAbout';
import { useRefetchOnVisible, useRefreshing } from '../../../lib/refresh';
import { colors, fonts, organicCorners } from '../../../lib/theme';

// One page for everyone: the book up top (with its description, when we
// have one), then a card for each copy you're involved with (yours, one
// you're borrowing or picking up, or one you've asked for), then the
// friends' copies you can see.
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
      ? {
          id,
          title: placeholderTitle,
          authors: [],
          cover_url: placeholderCoverUrl || null,
          work_id: null,
          publisher: null,
          page_count: null,
          work: null,
        }
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
  // The description/genres are fetched from the catalog lazily, the first
  // time anyone opens the book. Which book we've asked for (once per mount),
  // and whether that ask is still out.
  const detailsRequestedFor = useRef<string | null>(null);
  const [fetchingDetails, setFetchingDetails] = useState(false);

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

  // Never checked for a description yet: ask the server to look it up, and
  // reload if it found anything. A failure just means no About section.
  const needsDetails = bookLoaded && !!book?.work && !book.work.description_checked_at;
  useEffect(() => {
    if (!needsDetails || !book || detailsRequestedFor.current === book.id) return;
    detailsRequestedFor.current = book.id;
    setFetchingDetails(true);
    requestBookDetails(book.id)
      .then((found) => (found ? load({ fresh: true }) : undefined))
      .catch(() => {})
      .finally(() => setFetchingDetails(false));
  }, [needsDetails, book, load]);
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
  const friendCopies = copies.filter((c) => c.owner_id !== uid);
  const borrowing = loans.filter((l) => l.borrower_id === uid);
  const myRequests = requests.filter((r) => r.requester_id === uid);
  const loanFor = (copyId: string) => loans.find((l) => l.shelf_item_id === copyId) ?? null;
  const ownerOf = (copyId: string | null) => copies.find((c) => c.id === copyId)?.owner ?? null;
  // Skeleton the About spot from the first render that knows it'll ask,
  // not just once the request is out.
  const aboutPending =
    fetchingDetails || (needsDetails && detailsRequestedFor.current !== book?.id);
  const description = book?.work?.description?.trim() || null;
  const metaLine = book
    ? bookMetaLine(book.work?.first_publish_year, book.page_count, book.publisher)
    : null;
  // Your oldest copy, for the "On your shelf since" line.
  const shelvedAt = myCopies.map((c) => c.created_at).sort()[0];

  // No placeholder to paint from (a direct/deep link, not tapped from a
  // list) — skeleton the whole layout until the first fetch lands.
  if (!book && loading) {
    return (
      <ScrollView style={styles.container} contentContainerStyle={styles.content}>
        <View style={styles.header}>
          <Skeleton width={104} height={156} style={organicCorners} />
          <View style={styles.headerText}>
            <Skeleton width="85%" height={20} />
            <Skeleton width="55%" height={15} />
          </View>
        </View>
        <FriendCopiesSkeleton />
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
      <View style={styles.header}>
        {book.cover_url ? (
          <Image source={{ uri: book.cover_url }} style={styles.cover} resizeMode="cover" />
        ) : (
          <View style={[styles.cover, styles.spinePlaceholder]}>
            <Text style={styles.spineTitle} numberOfLines={6}>
              {book.title}
            </Text>
          </View>
        )}
        <View style={styles.headerText}>
          <Text style={styles.title}>{book.title}</Text>
          {book.work?.subtitle ? <Text style={styles.subtitle}>{book.work.subtitle}</Text> : null}
          {bookLoaded ? (
            <AuthorList
              authors={book.work?.authors.length ? book.work.authors : book.authors.map((name) => ({ name }))}
              textStyle={styles.authors}
            />
          ) : (
            <Skeleton width="55%" height={15} />
          )}
          {metaLine && <Text style={styles.meta}>{metaLine}</Text>}
          {book.work && <GenreChips categories={book.work.categories} />}
          {shelvedAt && <Text style={styles.shelvedAt}>On your shelf since {shelfMonth(shelvedAt)}</Text>}
        </View>
      </View>

      {/* Clamped to four lines, so the lending cards stay near the top. */}
      {description ? <BookAbout description={description} /> : aboutPending ? <BookAboutSkeleton /> : null}

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
      {myRequests.map((request) => (
        <RequestCard
          key={request.id}
          request={request}
          owner={ownerOf(request.shelf_item_id)}
          busy={busy}
          run={run}
        />
      ))}

      {!copiesLoaded ? (
        <FriendCopiesSkeleton />
      ) : (
        <FriendCopies
          copies={friendCopies}
          loans={borrowing}
          requests={myRequests}
          ownsCopy={myCopies.length > 0}
          busy={busy}
          run={run}
        />
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

// "March", or "March 2023" outside the current year.
function shelfMonth(iso: string): string {
  const date = new Date(iso);
  const sameYear = date.getFullYear() === new Date().getFullYear();
  return date.toLocaleDateString(undefined, { month: 'long', ...(sameYear ? {} : { year: 'numeric' }) });
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: 16, flexGrow: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 16,
    marginBottom: 20,
  },
  headerText: { flex: 1, gap: 6, paddingBottom: 4 },
  cover: {
    width: 104,
    height: 156,
    backgroundColor: colors.chipBackground,
    overflow: 'hidden',
    ...organicCorners,
  },
  spinePlaceholder: {
    padding: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  spineTitle: {
    fontFamily: fonts.display,
    fontSize: 11,
    color: colors.text,
    textAlign: 'center',
  },
  title: {
    fontFamily: fonts.displaySemibold,
    fontSize: 20,
    lineHeight: 25,
    color: colors.text,
  },
  subtitle: {
    fontFamily: fonts.display,
    fontSize: 14,
    lineHeight: 19,
    color: colors.textMuted,
    marginTop: -2,
  },
  authors: {
    fontSize: 15,
    color: colors.textMuted,
  },
  meta: {
    fontFamily: fonts.regular,
    fontSize: 13,
    color: colors.textMuted,
  },
  shelvedAt: {
    fontFamily: fonts.regular,
    fontSize: 12,
    color: colors.textFaint,
  },
  emptyBody: {
    fontFamily: fonts.regular,
    fontSize: 14,
    color: colors.textMuted,
  },
});
