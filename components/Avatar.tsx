import { Image, StyleSheet, Text, View } from 'react-native';
import { colors, fonts, organicCorners } from '../lib/theme';

interface AvatarProps {
  avatarUrl?: string | null;
  label: string;
  size?: number;
}

// Asymmetric "worn-edge" corners, matching book covers, instead of a
// hard square or a circle.
export function Avatar({ avatarUrl, label, size = 72 }: AvatarProps) {
  const initial = label.trim().charAt(0).toUpperCase() || '?';
  const dimensions = { width: size, height: size, ...organicCorners };

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
    overflow: 'hidden',
  },
  placeholder: {
    backgroundColor: colors.chipBackground,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  initial: {
    fontFamily: fonts.displayItalic,
    color: colors.accent,
  },
});
