import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { prefetchBook } from '../../lib/bookDetail';
import { personName, type ActiveLoan } from '../../lib/loans';
import { colors, fonts, organicCorners } from '../../lib/theme';

// "12 Sep", or "12 Sep 2025" when it's not this year.
export function shortDate(iso: string) {
  const date = new Date(iso);
  const sameYear = date.getFullYear() === new Date().getFullYear();
  return date.toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    ...(sameYear ? {} : { year: 'numeric' }),
  });
}

// One line on who has the copy, from your side of the loan.
function describe(loan: ActiveLoan, side: 'lent' | 'borrowing') {
  if (side === 'lent') {
    const who = personName(loan.borrower);
    return loan.handed_over_at
      ? `With ${who} since ${shortDate(loan.handed_over_at)}`
      : `Promised to ${who} · ${shortDate(loan.created_at)}`;
  }
  const who = personName(loan.owner);
  return loan.handed_over_at ? `From ${who} since ${shortDate(loan.handed_over_at)}` : `Pick up from ${who}`;
}

interface LoanListProps {
  loans: ActiveLoan[];
  side: 'lent' | 'borrowing';
  emptyText: string;
}

// The "Lent out" and "Borrowing" tabs on your own profile: a row per active
// loan, tapping through to the book page.
export function LoanList({ loans, side, emptyText }: LoanListProps) {
  const router = useRouter();

  if (loans.length === 0) {
    return <Text style={styles.emptyText}>{emptyText}</Text>;
  }

  return (
    <View style={styles.list}>
      {loans.map((loan) => (
        <Pressable
          key={loan.id}
          style={styles.row}
          onPressIn={() => loan.book && prefetchBook(loan.book.id)}
          onPress={() =>
            loan.book &&
            router.push({
              pathname: '/book/[id]',
              params: { id: loan.book.id, title: loan.book.title, coverUrl: loan.book.cover_url ?? '' },
            })
          }
        >
          {loan.book?.cover_url ? (
            <Image source={{ uri: loan.book.cover_url }} style={styles.cover} resizeMode="cover" />
          ) : (
            <View style={[styles.cover, styles.spinePlaceholder]}>
              <Text style={styles.spineTitle} numberOfLines={4}>
                {loan.book?.title ?? 'Unknown title'}
              </Text>
            </View>
          )}
          <View style={styles.body}>
            <Text style={styles.title} numberOfLines={2}>
              {loan.book?.title ?? 'Unknown title'}
            </Text>
            {!!loan.book?.authors?.length && (
              <Text style={styles.authors} numberOfLines={1}>
                {loan.book.authors.join(', ')}
              </Text>
            )}
            <Text style={styles.note}>{describe(loan, side)}</Text>
          </View>
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  list: {
    gap: 16,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  cover: {
    width: 56,
    aspectRatio: 2 / 3,
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
  },
  title: {
    fontFamily: fonts.display,
    fontSize: 15,
    color: colors.text,
  },
  authors: {
    fontFamily: fonts.regular,
    fontSize: 13,
    color: colors.textMuted,
    marginTop: 2,
  },
  note: {
    fontFamily: fonts.medium,
    fontSize: 13,
    color: colors.accent,
    marginTop: 6,
  },
  emptyText: {
    fontFamily: fonts.regular,
    fontSize: 14,
    color: colors.textMuted,
    textAlign: 'center',
    paddingTop: 8,
  },
});
