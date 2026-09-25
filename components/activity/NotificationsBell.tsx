import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useNeedsYouCount } from '../../lib/notifications';
import { colors, fonts } from '../../lib/theme';

// Header bell that opens Notifications, with a small ink badge counting
// what needs you (hidden at zero). The glyph is drawn with Views, like
// ShareGlyph, so there's no icon library.
export function NotificationsBell() {
  const router = useRouter();
  const count = useNeedsYouCount();
  const label = count > 0 ? `Notifications, ${count} need${count === 1 ? 's' : ''} you` : 'Notifications';

  return (
    <Pressable
      onPress={() => router.push('/notifications')}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [styles.button, pressed && styles.pressed]}
    >
      <View style={styles.glyph}>
        <View style={styles.dome} />
        <View style={styles.rim} />
        <View style={styles.clapper} />
      </View>
      {count > 0 && (
        <View style={styles.badge}>
          <Text style={styles.badgeText}>{count > 99 ? '99+' : count}</Text>
        </View>
      )}
    </Pressable>
  );
}

const STROKE = 1.8;

const styles = StyleSheet.create({
  button: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 8,
  },
  pressed: { opacity: 0.6 },
  glyph: {
    width: 18,
    height: 20,
    alignItems: 'center',
  },
  // Rounded top and straight sides, open at the bottom.
  dome: {
    marginTop: 1,
    width: 13,
    height: 13,
    borderWidth: STROKE,
    borderBottomWidth: 0,
    borderColor: colors.text,
    borderTopLeftRadius: 6.5,
    borderTopRightRadius: 6.5,
  },
  rim: {
    width: 17,
    height: STROKE,
    borderRadius: STROKE / 2,
    backgroundColor: colors.text,
  },
  clapper: {
    marginTop: 2,
    width: 5,
    height: STROKE,
    borderRadius: STROKE / 2,
    backgroundColor: colors.text,
  },
  badge: {
    position: 'absolute',
    top: 5,
    right: 4,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    paddingHorizontal: 4,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.text,
    // A ring of page colour so the badge reads as separate from the glyph.
    borderWidth: 2,
    borderColor: colors.background,
  },
  badgeText: {
    fontFamily: fonts.bold,
    fontSize: 11,
    lineHeight: 13,
    color: colors.background,
  },
});
