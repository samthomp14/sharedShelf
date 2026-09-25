import type { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import {
  acceptRequest,
  callOffLoan,
  declineRequest,
  markHandedOver,
  markReturned,
  personName,
  setCopyAvailable,
} from '../../lib/loans';
import type { BookCopy, BookLoan, BookRequest } from '../../lib/bookDetail';
import { Avatar } from '../Avatar';
import { Button } from '../Button';
import { colors, fonts, radius } from '../../lib/theme';

// Runs one lending step: `key` marks which button shows a spinner (and
// disables the rest), `success` is an optional toast. The book page owns it
// so it can show errors and reload afterwards.
export type RunStep = (key: string, step: () => Promise<unknown>, success?: string) => void;

// "Sep 3", or "Sep 3, 2025" outside the current year.
function formatDate(iso: string): string {
  const date = new Date(iso);
  const sameYear = date.getFullYear() === new Date().getFullYear();
  return date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    ...(sameYear ? {} : { year: 'numeric' }),
  });
}

function Card({
  label = 'Your copy',
  status,
  detail,
  children,
}: {
  label?: string;
  status: string;
  detail?: string;
  children?: ReactNode;
}) {
  return (
    <View style={styles.card}>
      <Text style={styles.label}>{label}</Text>
      <Text style={styles.status}>{status}</Text>
      {detail && <Text style={styles.detail}>{detail}</Text>}
      {children}
    </View>
  );
}

interface OwnedCopyCardProps {
  copy: BookCopy;
  loan: BookLoan | null;
  requests: BookRequest[];
  busy: string | null;
  run: RunStep;
  onLendToFriend: () => void;
}

// A copy you own: its state, who's asked for it, and the owner's steps.
export function OwnedCopyCard({ copy, loan, requests, busy, run, onLendToFriend }: OwnedCopyCardProps) {
  const disabled = busy !== null;
  const borrowerName = personName(loan?.borrower);

  if (copy.lend_status === 'promised' && loan) {
    return (
      <Card status={`Promised to ${borrowerName}`} detail="Hand it over when you see them.">
        <View style={styles.actions}>
          <Button
            title="Mark handed over"
            onPress={() => run(`handover-${loan.id}`, () => markHandedOver(loan.id), `Lent to ${borrowerName}`)}
            loading={busy === `handover-${loan.id}`}
            disabled={disabled}
          />
          <Button
            title="Call it off"
            variant="secondary"
            onPress={() => run(`calloff-${loan.id}`, () => callOffLoan(loan.id), 'Called off')}
            loading={busy === `calloff-${loan.id}`}
            disabled={disabled}
          />
        </View>
      </Card>
    );
  }

  if (copy.lend_status === 'on_loan' && loan) {
    return (
      <Card
        status={`With ${borrowerName}`}
        detail={`Since ${formatDate(loan.handed_over_at ?? loan.created_at)}`}
      >
        <View style={styles.actions}>
          <Button
            title="Mark returned"
            onPress={() => run(`return-${loan.id}`, () => markReturned(loan.id), 'Back on your shelf')}
            loading={busy === `return-${loan.id}`}
            disabled={disabled}
          />
        </View>
      </Card>
    );
  }

  if (copy.lend_status === 'unavailable') {
    return (
      <Card status="Unavailable" detail="Friends can't ask to borrow it.">
        <View style={styles.actions}>
          <Button
            title="Make available"
            variant="secondary"
            onPress={() => run(`available-${copy.id}`, () => setCopyAvailable(copy.id, true))}
            loading={busy === `available-${copy.id}`}
            disabled={disabled}
          />
        </View>
      </Card>
    );
  }

  // Available (or promised/on loan with the loan row not loaded yet, which
  // a refresh sorts out — the step functions refuse anything out of state).
  return (
    <Card
      status="Available"
      detail={
        requests.length === 0
          ? 'Friends can ask to borrow it.'
          : `${requests.length === 1 ? '1 friend wants' : `${requests.length} friends want`} to borrow it.`
      }
    >
      {requests.map((request) => {
        const name = personName(request.requester);
        return (
          <View key={request.id} style={styles.request}>
            <Avatar avatarUrl={request.requester?.avatar_url} label={name} size={36} />
            <Text style={styles.requestName} numberOfLines={1}>
              {name}
            </Text>
            <Button
              title="Accept"
              onPress={() => run(`accept-${request.id}`, () => acceptRequest(request.id), `Promised to ${name}`)}
              loading={busy === `accept-${request.id}`}
              disabled={disabled}
              style={styles.smallButton}
            />
            <Button
              title="Decline"
              variant="secondary"
              onPress={() => run(`decline-${request.id}`, () => declineRequest(request.id), 'Declined')}
              loading={busy === `decline-${request.id}`}
              disabled={disabled}
              style={styles.smallButton}
            />
          </View>
        );
      })}
      <View style={styles.actions}>
        <Button title="Lend to a friend" onPress={onLendToFriend} disabled={disabled} />
        <Button
          title="Make unavailable"
          variant="secondary"
          onPress={() => run(`unavailable-${copy.id}`, () => setCopyAvailable(copy.id, false))}
          loading={busy === `unavailable-${copy.id}`}
          disabled={disabled}
        />
      </View>
    </Card>
  );
}

interface BorrowingCardProps {
  loan: BookLoan;
  busy: string | null;
  run: RunStep;
}

// A friend's copy that's promised to you or in your hands.
export function BorrowingCard({ loan, busy, run }: BorrowingCardProps) {
  const disabled = busy !== null;
  const ownerName = personName(loan.owner);

  if (loan.handed_over_at) {
    return (
      <Card label="Borrowing" status={`Borrowing from ${ownerName}`} detail={`Since ${formatDate(loan.handed_over_at)}`} />
    );
  }

  return (
    <Card label="Borrowing" status={`Pick up from ${ownerName}`} detail={`Tap "Got it" once it's in your hands.`}>
      <View style={styles.actions}>
        <Button
          title="Got it"
          onPress={() => run(`gotit-${loan.id}`, () => markHandedOver(loan.id), 'Enjoy the book')}
          loading={busy === `gotit-${loan.id}`}
          disabled={disabled}
        />
        <Button
          title="Call it off"
          variant="secondary"
          onPress={() => run(`calloff-${loan.id}`, () => callOffLoan(loan.id), 'Called off')}
          loading={busy === `calloff-${loan.id}`}
          disabled={disabled}
        />
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  card: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: 16,
    marginBottom: 24,
    gap: 4,
  },
  label: {
    fontFamily: fonts.semibold,
    fontSize: 13,
    color: colors.textMuted,
    textTransform: 'uppercase',
  },
  status: { fontFamily: fonts.displaySemibold, fontSize: 18, color: colors.text, marginTop: 4 },
  detail: { fontFamily: fonts.regular, fontSize: 14, color: colors.textMuted },
  request: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  requestName: { flex: 1, fontFamily: fonts.semibold, fontSize: 15, color: colors.text },
  smallButton: { paddingVertical: 8, paddingHorizontal: 12 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12 },
});
