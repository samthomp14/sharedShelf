import { StyleSheet, View } from 'react-native';
import { colors } from '../lib/theme';

// iOS's share icon — a tray with an arrow out of the top — drawn with Views
// so it sits inline with copy without pulling in an icon library.
export function ShareGlyph({ color = colors.accent }: { color?: string }) {
  return (
    <View style={glyph.wrap} accessibilityLabel="Share">
      <View style={[glyph.arrowHead, { borderColor: color }]} />
      <View style={[glyph.shaft, { backgroundColor: color }]} />
      <View style={[glyph.tray, { borderColor: color }]} />
    </View>
  );
}

const glyph = StyleSheet.create({
  wrap: {
    width: 14,
    height: 17,
    alignItems: 'center',
  },
  arrowHead: {
    width: 6,
    height: 6,
    borderTopWidth: 1.5,
    borderLeftWidth: 1.5,
    transform: [{ rotate: '45deg' }],
    marginTop: 1,
  },
  shaft: {
    position: 'absolute',
    top: 1.5,
    width: 1.5,
    height: 9,
  },
  tray: {
    position: 'absolute',
    bottom: 0,
    width: 13,
    height: 9,
    borderWidth: 1.5,
    borderTopWidth: 0,
    borderBottomLeftRadius: 2,
    borderBottomRightRadius: 2,
  },
});
