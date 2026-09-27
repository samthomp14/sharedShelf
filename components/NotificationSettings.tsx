import { StyleSheet, Switch, Text, View } from 'react-native';
import { useNotificationPrefs, usePushState, type PrefKey } from '../lib/push';
import { colors, fonts } from '../lib/theme';
import { Button } from './Button';

const KINDS: { key: PrefKey; label: string; hint: string }[] = [
  { key: 'borrow_requests', label: 'Borrow requests', hint: 'A friend asks to borrow one of your books' },
  { key: 'your_requests', label: 'Your requests', hint: 'A friend says yes or no to your request' },
  { key: 'loans', label: 'Loans', hint: 'A friend lends you a book or calls off a hand-off' },
  { key: 'friends', label: 'Friends', hint: 'Friend requests and new friends' },
];

// Settings → Notifications. The top switch is this device only; the kinds
// below are for your account (every device).
export function NotificationSettings({ uid }: { uid: string | null }) {
  const { state, busy, enable, disable } = usePushState();
  const { prefs, setPref } = useNotificationPrefs(uid);

  if (state === 'loading' || state === 'unsupported') return null;

  return (
    <View>
      <Text style={styles.heading}>Notifications</Text>

      {state === 'needs-install' && (
        <Text style={styles.note}>
          On iPhone, notifications work from the home-screen app. Tap Share, then Add to Home Screen, and open
          sharedShelf from there.
        </Text>
      )}

      {state === 'denied' && (
        <Text style={styles.note}>
          Notifications are blocked for sharedShelf. Turn them on in your phone's Settings (iPhone: Settings →
          Notifications → sharedShelf), then come back here.
        </Text>
      )}

      {state === 'off' && (
        <View style={styles.offRow}>
          <Text style={styles.note}>Notifications are off on this device.</Text>
          <Button title="Turn on" size="compact" onPress={enable} loading={busy} />
        </View>
      )}

      {state === 'on' && (
        <>
          <View style={styles.row}>
            <View style={styles.flex}>
              <Text style={styles.label}>On this device</Text>
            </View>
            <Switch
              value
              disabled={busy}
              onValueChange={(v) => {
                if (!v) disable();
              }}
            />
          </View>
          {KINDS.map((kind) => (
            <View key={kind.key} style={styles.row}>
              <View style={styles.flex}>
                <Text style={styles.label}>{kind.label}</Text>
                <Text style={styles.hint}>{kind.hint}</Text>
              </View>
              <Switch value={prefs[kind.key]} onValueChange={(v) => setPref(kind.key, v)} />
            </View>
          ))}
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  heading: {
    fontFamily: fonts.semibold,
    fontSize: 13,
    color: colors.textMuted,
    marginBottom: 6,
    marginTop: 24,
  },
  note: {
    fontFamily: fonts.regular,
    fontSize: 14,
    lineHeight: 20,
    color: colors.textMuted,
    flexShrink: 1,
  },
  offRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 8,
  },
  flex: { flex: 1 },
  label: {
    fontFamily: fonts.medium,
    fontSize: 15,
    color: colors.text,
  },
  hint: {
    fontFamily: fonts.regular,
    fontSize: 13,
    color: colors.textMuted,
    marginTop: 2,
  },
});
