import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, fonts } from '../../lib/theme';

export interface ProfileTab<K extends string> {
  key: K;
  label: string;
  count: number;
}

interface ProfileTabsProps<K extends string> {
  tabs: ProfileTab<K>[];
  active: K;
  onChange: (key: K) => void;
}

// Equal-width underline tabs with a count pill: "Library 24 · Lent out 3 ·
// Borrowing 2". The active tab gets an ink underline and an inverted pill.
export function ProfileTabs<K extends string>({ tabs, active, onChange }: ProfileTabsProps<K>) {
  return (
    <View style={styles.row} accessibilityRole="tablist">
      {tabs.map((tab) => {
        const on = tab.key === active;
        return (
          <Pressable
            key={tab.key}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
            onPress={() => onChange(tab.key)}
            style={[styles.tab, on && styles.tabActive]}
          >
            <Text style={[styles.label, on && styles.labelActive]} numberOfLines={1}>
              {tab.label}
            </Text>
            <View style={[styles.count, on && styles.countActive]}>
              <Text style={[styles.countText, on && styles.countTextActive]}>{tab.count}</Text>
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    marginBottom: 16,
  },
  tab: {
    flex: 1,
    height: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    // Sit the underline on top of the row's hairline.
    marginBottom: -1,
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
  },
  tabActive: {
    borderBottomColor: colors.text,
  },
  label: {
    flexShrink: 1,
    fontFamily: fonts.medium,
    fontSize: 14,
    color: colors.textMuted,
  },
  labelActive: {
    fontFamily: fonts.semibold,
    color: colors.text,
  },
  count: {
    backgroundColor: colors.chipBackground,
    borderRadius: 10,
    paddingHorizontal: 7,
    paddingVertical: 1,
  },
  countActive: {
    backgroundColor: colors.text,
  },
  countText: {
    fontFamily: fonts.semibold,
    fontSize: 12,
    color: colors.textMuted,
  },
  countTextActive: {
    color: colors.background,
  },
});
