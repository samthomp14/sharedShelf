import { Image, StyleSheet, Text, View } from 'react-native';
import { colors, fonts, radius } from '../lib/theme';

interface AvatarProps {
  avatarUrl?: string | null;
  label: string;
  size?: number;
}

// Square, not circular — every surface in this app uses radius: 0 by design.
export function Avatar({ avatarUrl, label, size = 72 }: AvatarProps) {
  const initial = label.trim().charAt(0).toUpperCase() || '?';
  const dimensions = { width: size, height: size, borderRadius: radius };

  if (avatarUrl) {
    return <Image source={{ uri: avatarUrl }} style={[styles.image, dimensions]} />;
  }

  return (
    <View style={[styles.placeholder, dimensions]}>
      <Text style={[styles.initial, { fontSize: size * 0.4 }]}>{initial}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  image: {
    backgroundColor: colors.chipBackground,
  },
  placeholder: {
    backgroundColor: colors.chipBackground,
    alignItems: 'center',
    justifyContent: 'center',
  },
  initial: {
    fontFamily: fonts.semibold,
    color: colors.textMuted,
  },
});
