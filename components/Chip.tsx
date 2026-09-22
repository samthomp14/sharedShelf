import { StyleSheet, Text, View } from 'react-native';
import { colors, fonts, radius } from '../lib/theme';

export function Chip({ label }: { label: string }) {
  return (
    <View style={styles.chip}>
      <Text style={styles.text}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  chip: {
    alignSelf: 'flex-start',
    backgroundColor: colors.chipBackground,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    paddingVertical: 5,
    paddingHorizontal: 10,
  },
  text: {
    fontFamily: fonts.semibold,
    fontSize: 12,
    color: colors.accent,
  },
});
