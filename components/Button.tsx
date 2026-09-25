import type { ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View, type PressableProps } from 'react-native';
import { colors, fonts, radius, shadow } from '../lib/theme';

interface ButtonProps extends PressableProps {
  title: string;
  // ghost: a quiet text-only button for the secondary choice next to a
  // primary one ("Decline", "Call off").
  variant?: 'primary' | 'secondary' | 'ghost';
  // compact: a little shorter, for buttons inside cards and list rows.
  size?: 'default' | 'compact';
  loading?: boolean;
  // Optional glyph shown before the title.
  icon?: ReactNode;
}

export function Button({
  title,
  variant = 'primary',
  size = 'default',
  loading,
  icon,
  disabled,
  style,
  ...props
}: ButtonProps) {
  const isPrimary = variant === 'primary';
  return (
    <Pressable
      {...props}
      disabled={disabled || loading}
      style={(state) => [
        styles.base,
        size === 'compact' && styles.compact,
        styles[variant],
        typeof style === 'function' ? style(state) : style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={isPrimary ? colors.background : colors.text} />
      ) : (
        <View style={styles.content}>
          {icon}
          <Text style={[styles.text, isPrimary ? styles.primaryText : variant === 'ghost' ? styles.ghostText : styles.secondaryText]}>
            {title}
          </Text>
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    borderRadius: radius.md,
    paddingVertical: 12,
    paddingHorizontal: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  compact: {
    paddingVertical: 9,
    paddingHorizontal: 16,
    borderRadius: 10,
  },
  primary: {
    backgroundColor: colors.text,
  },
  secondary: {
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.border,
    ...shadow,
  },
  ghost: {
    backgroundColor: 'transparent',
    paddingHorizontal: 10,
  },
  content: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  text: {
    fontFamily: fonts.semibold,
    fontSize: 14,
  },
  primaryText: {
    color: colors.background,
  },
  secondaryText: {
    color: colors.text,
  },
  ghostText: {
    color: colors.textMuted,
  },
});
