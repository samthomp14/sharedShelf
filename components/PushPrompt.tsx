import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import {
  afterRequestDismissed,
  cardDismissed,
  dismissAfterRequest,
  dismissCard,
  usePushState,
} from '../lib/push';
import { colors, fonts, radius } from '../lib/theme';
import { Button } from './Button';

// Top of Notifications: offers to turn push on. Hidden once it's on, when
// the browser can't do push, when blocked (Settings explains that), and for
// 30 days after "Not now". On iPhone Safari in a tab it explains that push
// needs the home-screen app instead of asking.
export function PushCard() {
  const { state, busy, enable } = usePushState();
  // Read after mount so static HTML and the first client render agree.
  const [dismissed, setDismissed] = useState(true);
  useEffect(() => setDismissed(cardDismissed()), []);

  if (dismissed || (state !== 'off' && state !== 'needs-install')) return null;

  function notNow() {
    dismissCard();
    setDismissed(true);
  }

  return (
    <View style={styles.card}>
      <Text style={styles.title}>Get notified when a friend needs you</Text>
      {state === 'needs-install' ? (
        <Text style={styles.body}>
          On iPhone, notifications work from the home-screen app. Tap Share, then Add to Home Screen, and open
          sharedShelf from there.
        </Text>
      ) : (
        <Text style={styles.body}>Borrow requests, answers to yours, and new friends.</Text>
      )}
      <View style={styles.actions}>
        {state === 'off' && <Button title="Turn on" size="compact" onPress={enable} loading={busy} />}
        <Button title="Not now" variant="ghost" size="compact" onPress={notNow} />
      </View>
    </View>
  );
}

// Under "On friends' shelves" right after you ask to borrow: the moment the
// value is obvious. Once per device — gone for good after either button.
export function PushAfterRequest({ ownerName }: { ownerName: string }) {
  const { state, busy, enable } = usePushState();
  const [hidden, setHidden] = useState(true);
  useEffect(() => setHidden(afterRequestDismissed()), []);

  if (hidden || state !== 'off') return null;

  async function turnOn() {
    dismissAfterRequest();
    await enable();
    setHidden(true);
  }

  function dismiss() {
    dismissAfterRequest();
    setHidden(true);
  }

  return (
    <View style={styles.inline}>
      <Text style={styles.inlineText}>Want to know when {ownerName} answers?</Text>
      <Pressable onPress={turnOn} disabled={busy} accessibilityRole="button" hitSlop={8}>
        <Text style={styles.inlineAction}>Turn on notifications</Text>
      </Pressable>
      <Pressable onPress={dismiss} accessibilityRole="button" accessibilityLabel="Dismiss" hitSlop={8}>
        <Text style={styles.close}>×</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: 16,
    marginBottom: 20,
    gap: 6,
  },
  title: {
    fontFamily: fonts.semibold,
    fontSize: 16,
    color: colors.text,
  },
  body: {
    fontFamily: fonts.regular,
    fontSize: 14,
    lineHeight: 20,
    color: colors.textMuted,
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 6,
  },
  inline: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 12,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: radius.sm,
    backgroundColor: colors.chipBackground,
  },
  inlineText: {
    fontFamily: fonts.regular,
    fontSize: 14,
    color: colors.text,
  },
  inlineAction: {
    fontFamily: fonts.semibold,
    fontSize: 14,
    color: colors.accent,
  },
  close: {
    fontFamily: fonts.medium,
    fontSize: 18,
    lineHeight: 18,
    color: colors.textMuted,
    marginLeft: 'auto',
  },
});
