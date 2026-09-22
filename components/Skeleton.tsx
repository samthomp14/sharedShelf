import { useEffect, useRef } from 'react';
import { Animated, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import { colors, radius } from '../lib/theme';

interface SkeletonProps {
  width?: number | `${number}%`;
  // Left unset lets an aspectRatio in `style` (e.g. a book-cover tile)
  // determine the height instead of a fixed one.
  height?: number;
  borderRadius?: number;
  style?: StyleProp<ViewStyle>;
}

// A pulsing placeholder block, standing in for text/covers/avatars that
// haven't loaded yet — so a screen's layout is there immediately instead of
// going blank while data is in flight.
export function Skeleton({ width = '100%', height, borderRadius = radius.sm, style }: SkeletonProps) {
  const opacity = useRef(new Animated.Value(0.55)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 1, duration: 700, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 0.55, duration: 700, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [opacity]);

  return (
    <Animated.View
      style={[styles.base, { width, borderRadius, opacity }, height !== undefined ? { height } : null, style]}
    />
  );
}

// A block of skeleton text lines, the last one narrower so it reads as a
// paragraph rather than a stack of identical bars.
export function SkeletonText({
  lines = 1,
  lineHeight = 14,
  lastLineWidth = '60%',
  gap = 8,
  style,
}: {
  lines?: number;
  lineHeight?: number;
  lastLineWidth?: number | `${number}%`;
  gap?: number;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <Animated.View style={style}>
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton
          key={i}
          height={lineHeight}
          width={i === lines - 1 ? lastLineWidth : '100%'}
          style={i > 0 ? { marginTop: gap } : undefined}
        />
      ))}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  base: {
    backgroundColor: colors.chipBackground,
  },
});
