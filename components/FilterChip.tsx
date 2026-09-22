import { Pressable, StyleSheet, Text } from 'react-native';
import { colors, fonts, radius } from '../lib/theme';

interface FilterChipProps {
  label: string;
  active: boolean;
  onPress: () => void;
}

export function FilterChip({ label, active, onPress }: FilterChipProps) {
  return (
    <Pressable onPress={onPress} style={[styles.chip, active && styles.chipActive]}>
      <Text style={[styles.text, active && styles.textActive]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  chip: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    paddingVertical: 6,
    paddingHorizontal: 12,
    marginRight: 8,
  },
  chipActive: {
    backgroundColor: colors.text,
    borderColor: colors.text,
  },
  text: {
    fontFamily: fonts.medium,
    fontSize: 13,
    color: colors.textMuted,
  },
  textActive: {
    color: colors.background,
  },
});
