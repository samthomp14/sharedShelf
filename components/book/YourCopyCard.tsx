import type { ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Switch, Text, View } from 'react-native';
import {
  acceptRequest,
  callOffLoan,
  cancelRequest,
  declineRequest,
  firstName,
  markHandedOver,
  markReturned,
  personName,
  setCopyAvailable,
  type Person,
} from '../../lib/loans';
import type { BookCopy, BookLoan, BookRequest } from '../../lib/bookDetail';
import { duration, timeAgo } from '../../lib/time';
import { Avatar } from '../Avatar';
import { Button } from '../Button';
import { LoanStepper, LoanTimeline, type LoanStep } from './LoanTimeline';
import { colors, fonts, radius } from '../../lib/theme';

// Runs one lending step: `key` marks which button shows a spinner (and
// disables the rest), `success` is an optional toast. The book page owns it
// so it can show errors and reload afterwards.
export type RunStep = (key: string, step: () => Promise<unknown>, success?: string) => void;

// "Sep 3", or "Sep 3, 2025" outside the current year.
export function formatDate(iso: string): string {
  const date = new Date(iso);
  const sameYear = date.getFullYear() === new Date().getFullYear();
  return date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    ...(sameYear ? {} : { year: 'numeric' }),
  });
}

// How long a book's been out: "3 weeks · since Sep 3", or "Since today".
function outSince(iso: string): string {
  const length = duration(iso);
  return length === 'today' ? 'Since today' : `${length} · since ${formatDate(iso)}`;
}

// The owner's view of a loan, oldest step first. A direct lend has no
// request and starts handed over, so it skips straight to that step.
function ownerSteps(loan: BookLoan): LoanStep[] {
  const promisedFirst =
    !!loan.request || !loan.handed_over_at || Date.parse(loan.handed_over_at) > Date.parse(loan.created_at);
  const steps: LoanStep[] = [];
  if (loan.request) {
    steps.push({ label: `${firstName(loan.borrower)} asked`, done: true, date: formatDate(loan.request.created_at) });
  }
  if (promisedFirst) {
    steps.push({ label: 'You said yes', done: true, date: formatDate(loan.created_at) });
  }
  steps.push(
    {
      label: 'Handed over',
      done: !!loan.handed_over_at,
      date: loan.handed_over_at ? formatDate(loan.handed_over_at) : undefined,
    },
    { label: 'Back on your shelf', done: false }
  );
  return steps;
}

function Card({ label, children }: { label: string; children: ReactNode }) {
  return (
    <View style={styles.card}>
      <Text style={styles.eyebrow}>{label}</Text>
      {children}
    </View>
  );
}

// Avatar beside a serif heading and a one-line note — the top of most cards.
function PersonHeading({
  person,
  heading,
  note,
  noteAccent,
}: {
  person: Person | null;
  heading: string;
  note?: string;
  noteAccent?: boolean;
}) {
  return (
    <View style={styles.personHeading}>
      <Avatar avatarUrl={person?.avatar_url} label={personName(person)} size={48} />
      <View style={styles.flex}>
        <Text style={styles.heading}>{heading}</Text>
        {note && <Text style={[styles.note, noteAccent && styles.noteAccent]}>{note}</Text>}
      </View>
    </View>
  );
}

// An X drawn with two crossed bars, so it doesn't need an icon library.
function CloseGlyph() {
  return (
    <View style={styles.closeGlyph}>
      <View style={[styles.closeBar, { transform: [{ rotate: '45deg' }] }]} />
      <View style={[styles.closeBar, { transform: [{ rotate: '-45deg' }] }]} />
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

// A copy you own: promised or lent out (with the loan's timeline), otherwise
// the lending switch and anyone who's asked for it.
export function OwnedCopyCard({ copy, loan, requests, busy, run, onLendToFriend }: OwnedCopyCardProps) {
  const disabled = busy !== null;

  if (copy.lend_status === 'promised' && loan) {
    const name = firstName(loan.borrower);
    return (
      <Card label="Your copy">
        <PersonHeading person={loan.borrower} heading={`For ${name}`} note="Hand it over when you see them." />
        <LoanTimeline steps={ownerSteps(loan)} />
        <View style={styles.actions}>
          <Button
            title="Handed over"
            onPress={() => run(`handover-${loan.id}`, () => markHandedOver(loan.id), `Lent to ${name}`)}
            loading={busy === `handover-${loan.id}`}
            disabled={disabled}
            style={styles.flex}
          />
          <Button
            title="Call it off"
            variant="ghost"
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
      <Card label="Your copy">
        <PersonHeading
          person={loan.borrower}
          heading={`With ${personName(loan.borrower)}`}
          note={outSince(loan.handed_over_at ?? loan.created_at)}
          noteAccent
        />
        <LoanTimeline steps={ownerSteps(loan)} />
        <Button
          title="Mark returned"
          onPress={() => run(`return-${loan.id}`, () => markReturned(loan.id), 'Back on your shelf')}
          loading={busy === `return-${loan.id}`}
          disabled={disabled}
        />
      </Card>
    );
  }

  // Available or not lending. (Promised/on loan with the loan row not loaded
  // yet lands here too, with the switch locked; a refresh sorts it out.)
  const available = copy.lend_status === 'available';
  const locked = copy.lend_status === 'promised' || copy.lend_status === 'on_loan';
  const switchKey = `available-${copy.id}`;
  return (
    <Card label="Your copy">
      <View style={styles.switchRow}>
        <View style={styles.flex}>
          <Text style={styles.heading}>{available ? 'Available to borrow' : 'Not lending'}</Text>
          <Text style={styles.note}>
            {available ? 'Friends can ask for it' : "Friends can't ask to borrow it"}
          </Text>
        </View>
        {busy === switchKey ? (
          <ActivityIndicator color={colors.text} />
        ) : (
          <Switch
            value={available}
            onValueChange={(next) => run(switchKey, () => setCopyAvailable(copy.id, next))}
            disabled={disabled || locked}
            trackColor={{ false: colors.chipBackground, true: colors.text }}
            thumbColor={colors.background}
            accessibilityLabel="Available to borrow"
          />
        )}
      </View>

      {available && requests.length > 0 && (
        <View style={styles.divided}>
          <Text style={styles.subhead}>
            {requests.length === 1 ? '1 friend asked' : `${requests.length} friends asked`}
          </Text>
          {requests.map((request, i) => {
            const name = personName(request.requester);
            const declineKey = `decline-${request.id}`;
            return (
              <View key={request.id} style={[styles.request, i === requests.length - 1 && styles.lastRow]}>
                <Avatar avatarUrl={request.requester?.avatar_url} label={name} size={40} />
                <View style={styles.flex}>
                  <Text style={styles.requestName} numberOfLines={1}>
                    {name}
                  </Text>
                  <Text style={styles.faint}>Asked {timeAgo(request.created_at)}</Text>
                </View>
                {/* The oldest request gets the strong button: first come, first served. */}
                <Button
                  title="Accept"
                  variant={i === 0 ? 'primary' : 'secondary'}
                  size="compact"
                  onPress={() =>
                    run(`accept-${request.id}`, () => acceptRequest(request.id), `Promised to ${firstName(request.requester)}`)
                  }
                  loading={busy === `accept-${request.id}`}
                  disabled={disabled}
                />
                <Pressable
                  onPress={() => run(declineKey, () => declineRequest(request.id), 'Declined')}
                  disabled={disabled}
                  hitSlop={8}
                  accessibilityRole="button"
                  accessibilityLabel={`Decline ${firstName(request.requester)}'s request`}
                  style={({ pressed }) => [styles.iconButton, (pressed || disabled) && styles.dimmed]}
                >
                  {busy === declineKey ? <ActivityIndicator color={colors.textMuted} /> : <CloseGlyph />}
                </Pressable>
              </View>
            );
          })}
        </View>
      )}

      {available && (
        <View style={styles.footer}>
          <Pressable
            onPress={onLendToFriend}
            disabled={disabled}
            accessibilityRole="button"
            style={({ pressed }) => [styles.footerButton, (pressed || disabled) && styles.dimmed]}
          >
            <Text style={styles.footerText}>Lend it to someone directly</Text>
            <Text style={styles.chevron}>›</Text>
          </Pressable>
        </View>
      )}
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
  const name = firstName(loan.owner);

  if (loan.handed_over_at) {
    return (
      <Card label="Borrowing">
        <PersonHeading
          person={loan.owner}
          heading={`Borrowing from ${name}`}
          note={outSince(loan.handed_over_at)}
          noteAccent
        />
      </Card>
    );
  }

  return (
    <Card label="Borrowing">
      <PersonHeading person={loan.owner} heading={`Pick up from ${name}`} note={`Tap "Got it" once it's in your hands.`} />
      <LoanStepper
        steps={[
          ...(loan.request ? [{ label: 'Asked', done: true }] : []),
          { label: `${name} said yes`, done: true },
          { label: 'Pick it up', done: false },
        ]}
      />
      <View style={styles.actions}>
        <Button
          title="Got it"
          onPress={() => run(`gotit-${loan.id}`, () => markHandedOver(loan.id), 'Enjoy the book')}
          loading={busy === `gotit-${loan.id}`}
          disabled={disabled}
          style={styles.flex}
        />
        <Button
          title="Call it off"
          variant="ghost"
          onPress={() => run(`calloff-${loan.id}`, () => callOffLoan(loan.id), 'Called off')}
          loading={busy === `calloff-${loan.id}`}
          disabled={disabled}
        />
      </View>
    </Card>
  );
}

interface RequestCardProps {
  request: BookRequest;
  owner: Person | null;
  busy: string | null;
  run: RunStep;
}

// You asked to borrow a friend's copy and they haven't answered yet.
export function RequestCard({ request, owner, busy, run }: RequestCardProps) {
  const name = firstName(owner);
  const key = `cancel-${request.id}`;
  return (
    <Card label="Your request">
      <PersonHeading person={owner} heading={`Waiting on ${name}`} note={`You asked ${timeAgo(request.created_at)}`} />
      <LoanStepper
        steps={[
          { label: 'Asked', done: true },
          { label: `${name} says yes`, done: false },
          { label: 'Pick it up', done: false },
        ]}
      />
      <Button
        title="Cancel request"
        variant="ghost"
        onPress={() => run(key, () => cancelRequest(request.id), 'Request cancelled')}
        loading={busy === key}
        disabled={busy !== null}
        style={styles.startAligned}
      />
    </Card>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#fbfcfd',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: 16,
    marginBottom: 24,
    gap: 14,
  },
  eyebrow: {
    fontFamily: fonts.bold,
    fontSize: 11,
    letterSpacing: 0.66,
    color: colors.accent,
    textTransform: 'uppercase',
    marginBottom: -6,
  },
  flex: { flex: 1 },
  personHeading: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  heading: { fontFamily: fonts.displaySemibold, fontSize: 18, color: colors.text },
  note: { fontFamily: fonts.regular, fontSize: 13, color: colors.textMuted, marginTop: 2 },
  noteAccent: { fontFamily: fonts.semibold, color: colors.accent },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  // Full-bleed divider: pull out to the card's edges, pad back in.
  divided: {
    borderTopWidth: 1,
    borderTopColor: colors.border,
    marginHorizontal: -16,
    paddingHorizontal: 16,
    paddingTop: 12,
    marginTop: 2,
  },
  subhead: { fontFamily: fonts.semibold, fontSize: 13, color: colors.textMuted, marginBottom: 2 },
  request: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  lastRow: { borderBottomWidth: 0, paddingBottom: 0 },
  requestName: { fontFamily: fonts.semibold, fontSize: 15, color: colors.text },
  faint: { fontFamily: fonts.regular, fontSize: 12, color: colors.textFaint, marginTop: 2 },
  iconButton: { width: 32, height: 36, alignItems: 'center', justifyContent: 'center' },
  dimmed: { opacity: 0.5 },
  closeGlyph: { width: 16, height: 16, alignItems: 'center', justifyContent: 'center' },
  closeBar: {
    position: 'absolute',
    width: 16,
    height: 1.75,
    borderRadius: 1,
    backgroundColor: colors.textMuted,
  },
  footer: {
    borderTopWidth: 1,
    borderTopColor: colors.border,
    marginHorizontal: -16,
    marginBottom: -8,
    paddingHorizontal: 8,
    paddingTop: 4,
  },
  footerButton: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 6,
    paddingVertical: 10,
    paddingHorizontal: 8,
  },
  footerText: { fontFamily: fonts.semibold, fontSize: 14, color: colors.text },
  chevron: { fontFamily: fonts.semibold, fontSize: 18, lineHeight: 20, color: colors.text },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  startAligned: { alignSelf: 'flex-start', paddingHorizontal: 2, marginTop: -6 },
});
