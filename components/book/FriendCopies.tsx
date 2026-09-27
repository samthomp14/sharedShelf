import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { personName, requestLoan } from '../../lib/loans';
import type { BookCopy, BookLoan, BookRequest } from '../../lib/bookDetail';
import { Avatar } from '../Avatar';
import { Button } from '../Button';
import { Chip } from '../Chip';
import { PushAfterRequest } from '../PushPrompt';
import { Skeleton } from '../Skeleton';
import type { RunStep } from './YourCopyCard';
import { colors, fonts, organicCorners } from '../../lib/theme';

export function FriendCopiesSkeleton() {
  return (
    <View>
      {[0, 1].map((i) => (
        <View key={i} style={styles.row}>
          <Skeleton width={36} height={36} style={organicCorners} />
          <Skeleton width="45%" height={16} />
        </View>
      ))}
    </View>
  );
}

interface FriendCopiesProps {
  copies: BookCopy[]; // friends' copies only
  // Your side of those copies: loans you're borrowing on, requests you made.
  loans: BookLoan[];
  requests: BookRequest[];
  // You have your own copy: the list is just "who else has it", no asking.
  ownsCopy: boolean;
  busy: string | null;
  run: RunStep;
}

// "On friends' shelves": each friend's copy with its state and, when it's
// free and you don't own the book, an "Ask to borrow" button. Copies that
// are promised, lent or held back all read "Unavailable" — who has it is
// only for the two people involved.
export function FriendCopies({ copies, loans, requests, ownsCopy, busy, run }: FriendCopiesProps) {
  // Set after a request goes through: offers push ("Want to know when Sam answers?").
  const [askedName, setAskedName] = useState<string | null>(null);

  if (ownsCopy && copies.length === 0) return null;

  return (
    <View>
      <Text style={styles.sectionTitle}>{ownsCopy ? "Also on friends' shelves" : "On friends' shelves"}</Text>
      {copies.length === 0 ? (
        <Text style={styles.empty}>No one in your circle has this on their shelf yet.</Text>
      ) : (
        copies.map((copy, i) => {
          const name = personName(copy.owner);
          const myLoan = loans.find((l) => l.shelf_item_id === copy.id) ?? null;
          const myRequest = requests.find((r) => r.shelf_item_id === copy.id) ?? null;
          const available = copy.lend_status === 'available';
          const faded = !myLoan && !myRequest && !available;
          return (
            <View key={copy.id} style={[styles.row, i === copies.length - 1 && styles.lastRow]}>
              <View style={faded && styles.faded}>
                <Avatar avatarUrl={copy.owner?.avatar_url} label={name} size={36} />
              </View>
              <View style={styles.flex}>
                <Text style={[styles.name, faded && styles.nameFaded]} numberOfLines={1}>
                  {name}
                </Text>
                {!myLoan && !myRequest && (
                  <Text style={available ? styles.available : styles.unavailable}>
                    {available ? 'Available' : 'Unavailable'}
                  </Text>
                )}
              </View>
              {myLoan ? (
                <Chip label={myLoan.handed_over_at ? 'Borrowing' : 'Pick up'} />
              ) : myRequest ? (
                <Chip label="Requested" />
              ) : available && !ownsCopy ? (
                <Button
                  title="Ask to borrow"
                  variant="secondary"
                  size="compact"
                  onPress={() =>
                    run(
                      `request-${copy.id}`,
                      async () => {
                        await requestLoan(copy.id);
                        setAskedName(name.split(' ')[0]);
                      },
                      `Asked ${name}`
                    )
                  }
                  loading={busy === `request-${copy.id}`}
                  disabled={busy !== null}
                />
              ) : null}
            </View>
          );
        })
      )}
      {askedName && <PushAfterRequest ownerName={askedName} />}
    </View>
  );
}

const styles = StyleSheet.create({
  sectionTitle: {
    fontFamily: fonts.semibold,
    fontSize: 13,
    color: colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    marginBottom: 4,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  lastRow: { borderBottomWidth: 0 },
  flex: { flex: 1 },
  faded: { opacity: 0.5 },
  name: { fontFamily: fonts.semibold, fontSize: 15, color: colors.text },
  nameFaded: { color: colors.textMuted },
  available: { fontFamily: fonts.semibold, fontSize: 12, color: colors.accent, marginTop: 2 },
  unavailable: { fontFamily: fonts.regular, fontSize: 12, color: colors.textFaint, marginTop: 2 },
  empty: { fontFamily: fonts.regular, fontSize: 14, color: colors.textMuted, paddingVertical: 8 },
});
