import type { ReactNode } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Button } from '../Button';
import { MiniAvatar } from './MiniAvatar';
import { prefetchBook } from '../../lib/bookDetail';
import { firstName, type ActiveLoan, type BookRef, type OutgoingRequest, type Person } from '../../lib/loans';
import { dayLabel, duration, durationAgo } from '../../lib/time';
import { colors, fonts, organicCorners } from '../../lib/theme';

// The "Lent out" and "Borrowing" tabs on your own profile: sections of rows,
// each tapping through to the book page, most with one step button.

// Past this, a loan's duration turns amber on the Lent out tab.
const LONG_LOAN_DAYS = 56;
const AMBER = '#9a4a0b';

const since = (loan: ActiveLoan) => loan.handed_over_at ?? loan.created_at;
const oldestFirst = (a: string, b: string) => a.localeCompare(b);

interface LentOutListProps {
  loans: ActiveLoan[];
  actingId: string | null;
  onHandedOver: (loan: ActiveLoan) => void;
  onReturned: (loan: ActiveLoan) => void;
  emptyText: string;
}

export function LentOutList({ loans, actingId, onHandedOver, onReturned, emptyText }: LentOutListProps) {
  // Waiting longest first in both: the oldest promise, the longest out.
  const toHandOver = loans.filter((l) => !l.handed_over_at).sort((a, b) => oldestFirst(a.created_at, b.created_at));
  const outNow = loans.filter((l) => l.handed_over_at).sort((a, b) => oldestFirst(since(a), since(b)));

  if (loans.length === 0) {
    return <Text style={styles.emptyText}>{emptyText}</Text>;
  }

  return (
    <View>
      {toHandOver.length > 0 && (
        <Section title="To hand over">
          {toHandOver.map((loan) => (
            <LoanRow
              key={loan.id}
              book={loan.book}
              person={loan.borrower}
              who={
                <>
                  Promised to <Text style={styles.name}>{firstName(loan.borrower)}</Text> · {dayLabel(loan.created_at)}
                </>
              }
              action={
                <Button
                  title="Handed over"
                  variant="secondary"
                  size="compact"
                  loading={actingId === loan.id}
                  onPress={() => onHandedOver(loan)}
                />
              }
            />
          ))}
        </Section>
      )}
      {outNow.length > 0 && (
        <Section title="Out now">
          {outNow.map((loan) => {
            const long = Date.now() - Date.parse(since(loan)) > LONG_LOAN_DAYS * 86400000;
            return (
              <LoanRow
                key={loan.id}
                book={loan.book}
                person={loan.borrower}
                who={
                  <>
                    <Text style={styles.name}>{firstName(loan.borrower)}</Text> ·{' '}
                    <Text style={[styles.duration, long && styles.durationLong]}>{duration(since(loan))}</Text>
                  </>
                }
                action={
                  <Button
                    title="Returned"
                    variant="secondary"
                    size="compact"
                    loading={actingId === loan.id}
                    onPress={() => onReturned(loan)}
                  />
                }
              />
            );
          })}
        </Section>
      )}
    </View>
  );
}

interface BorrowingListProps {
  loans: ActiveLoan[];
  requests: OutgoingRequest[];
  actingId: string | null;
  onGotIt: (loan: ActiveLoan) => void;
  onCancelRequest: (request: OutgoingRequest) => void;
  emptyText: string;
}

export function BorrowingList({ loans, requests, actingId, onGotIt, onCancelRequest, emptyText }: BorrowingListProps) {
  const toPickUp = loans.filter((l) => !l.handed_over_at).sort((a, b) => oldestFirst(a.created_at, b.created_at));
  const reading = loans.filter((l) => l.handed_over_at).sort((a, b) => oldestFirst(since(a), since(b)));

  if (loans.length === 0 && requests.length === 0) {
    return <Text style={styles.emptyText}>{emptyText}</Text>;
  }

  return (
    <View>
      {toPickUp.length > 0 && (
        <Section title="To pick up">
          {toPickUp.map((loan) => (
            <LoanRow
              key={loan.id}
              book={loan.book}
              person={loan.owner}
              who={
                <>
                  From <Text style={styles.name}>{firstName(loan.owner)}</Text> · said yes {durationAgo(loan.created_at)}
                </>
              }
              action={
                <Button
                  title="Got it"
                  variant="secondary"
                  size="compact"
                  loading={actingId === loan.id}
                  onPress={() => onGotIt(loan)}
                />
              }
            />
          ))}
        </Section>
      )}
      {reading.length > 0 && (
        <Section title="Reading">
          {reading.map((loan) => (
            <LoanRow
              key={loan.id}
              book={loan.book}
              person={loan.owner}
              who={
                <>
                  From <Text style={styles.name}>{firstName(loan.owner)}</Text> · {duration(since(loan))}
                </>
              }
            />
          ))}
        </Section>
      )}
      {requests.length > 0 && (
        <Section title="Waiting on">
          {requests.map((request) => (
            <LoanRow
              key={request.id}
              book={request.book}
              person={request.owner}
              faded
              who={
                <>
                  Asked <Text style={styles.name}>{firstName(request.owner)}</Text> · {durationAgo(request.created_at)}
                </>
              }
              action={
                <Button
                  title="Cancel"
                  variant="ghost"
                  size="compact"
                  loading={actingId === request.id}
                  onPress={() => onCancelRequest(request)}
                />
              }
            />
          ))}
        </Section>
      )}
    </View>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {children}
    </View>
  );
}

interface LoanRowProps {
  book: BookRef | null;
  person: Person | null;
  who: ReactNode;
  action?: ReactNode;
  // Not yours yet (a request still waiting): dim the cover.
  faded?: boolean;
}

function LoanRow({ book, person, who, action, faded }: LoanRowProps) {
  const router = useRouter();
  return (
    <Pressable
      style={styles.row}
      onPressIn={() => book && prefetchBook(book.id)}
      onPress={() =>
        book &&
        router.push({
          pathname: '/book/[id]',
          params: { id: book.id, title: book.title, coverUrl: book.cover_url ?? '' },
        })
      }
    >
      <View style={faded && styles.faded}>
        {book?.cover_url ? (
          <Image source={{ uri: book.cover_url }} style={styles.cover} resizeMode="cover" />
        ) : (
          <View style={[styles.cover, styles.spinePlaceholder]}>
            <Text style={styles.spineTitle} numberOfLines={4}>
              {book?.title ?? 'Unknown title'}
            </Text>
          </View>
        )}
      </View>
      <View style={styles.body}>
        <Text style={styles.title} numberOfLines={2}>
          {book?.title ?? 'Unknown title'}
        </Text>
        {!!book?.authors?.length && (
          <Text style={styles.authors} numberOfLines={1}>
            {book.authors.join(', ')}
          </Text>
        )}
        <View style={styles.who}>
          <MiniAvatar label={firstName(person)} avatarUrl={person?.avatar_url} />
          <Text style={styles.whoText} numberOfLines={2}>
            {who}
          </Text>
        </View>
      </View>
      {action}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  section: {
    marginBottom: 20,
  },
  sectionTitle: {
    fontFamily: fonts.semibold,
    fontSize: 13,
    color: colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  faded: {
    opacity: 0.7,
  },
  cover: {
    width: 56,
    height: 84,
    backgroundColor: colors.chipBackground,
    overflow: 'hidden',
    ...organicCorners,
  },
  spinePlaceholder: {
    padding: 4,
    justifyContent: 'center',
  },
  spineTitle: {
    fontFamily: fonts.display,
    fontSize: 8,
    color: colors.text,
    textAlign: 'center',
  },
  body: {
    flex: 1,
    minWidth: 0,
  },
  title: {
    fontFamily: fonts.display,
    fontSize: 15,
    lineHeight: 20,
    color: colors.text,
  },
  authors: {
    fontFamily: fonts.regular,
    fontSize: 13,
    color: colors.textMuted,
    marginTop: 2,
  },
  who: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 6,
  },
  whoText: {
    flexShrink: 1,
    fontFamily: fonts.regular,
    fontSize: 13,
    color: colors.text,
  },
  name: {
    fontFamily: fonts.semibold,
  },
  duration: {
    fontFamily: fonts.semibold,
    color: colors.accent,
  },
  durationLong: {
    color: AMBER,
  },
  emptyText: {
    fontFamily: fonts.regular,
    fontSize: 14,
    color: colors.textMuted,
    textAlign: 'center',
    paddingTop: 8,
  },
});
