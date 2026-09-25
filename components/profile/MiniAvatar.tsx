import { Image, StyleSheet, Text, View } from 'react-native';
import { colors, fonts } from '../../lib/theme';

interface MiniAvatarProps {
  label: string;
  avatarUrl?: string | null;
  size?: number;
}

// A tiny avatar for inline "who" lines and cover badges. Same worn-edge
// corners as Avatar, scaled down so they don't round into a blob.
export function MiniAvatar({ label, avatarUrl, size = 20 }: MiniAvatarProps) {
  const big = Math.round(size * 0.4);
  const small = Math.round(size * 0.15);
  const box = {
    width: size,
    height: size,
    borderTopLeftRadius: big,
    borderTopRightRadius: small,
    borderBottomRightRadius: big,
    borderBottomLeftRadius: small,
  };

  if (avatarUrl) {
    return <Image source={{ uri: avatarUrl }} style={[styles.box, box]} />;
  }
  return (
    <View style={[styles.box, box]}>
      <Text style={[styles.initial, { fontSize: size * 0.5, lineHeight: size }]}>
        {label.trim().charAt(0).toUpperCase() || '?'}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    backgroundColor: colors.chipBackground,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    flexShrink: 0,
  },
  initial: {
    fontFamily: fonts.displayItalic,
    color: colors.accent,
  },
});
