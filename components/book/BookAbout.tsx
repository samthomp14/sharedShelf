import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SkeletonText } from '../Skeleton';
import { colors, fonts } from '../../lib/theme';

const CLAMP_LINES = 4;

// The book's description, clamped to a few lines with a More/Less toggle.
// The toggle only shows when the text actually overflows: an invisible,
// unclamped copy is laid out alongside and the two heights compared
// (onTextLayout doesn't fire on react-native-web, onLayout does).
export function BookAbout({ description }: { description: string }) {
  // Keep paragraph breaks, but no runs of blank lines or stray edges.
  const text = description.replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  const [expanded, setExpanded] = useState(false);
  const [clampedHeight, setClampedHeight] = useState(0);
  const [fullHeight, setFullHeight] = useState(0);
  // A pixel of slack for rounding between the two layouts.
  const overflows = fullHeight > clampedHeight + 1;

  return (
    <View style={styles.section}>
      <Text style={styles.heading}>About</Text>
      <View style={styles.clip}>
        <Text
          style={styles.body}
          numberOfLines={expanded ? undefined : CLAMP_LINES}
          onLayout={(e) => {
            if (!expanded) setClampedHeight(e.nativeEvent.layout.height);
          }}
        >
          {text}
        </Text>
        <View style={styles.measure} pointerEvents="none" aria-hidden>
          <Text style={styles.body} onLayout={(e) => setFullHeight(e.nativeEvent.layout.height)}>
            {text}
          </Text>
        </View>
      </View>
      {(overflows || expanded) && (
        <Pressable onPress={() => setExpanded((v) => !v)} hitSlop={8} style={styles.toggle}>
          <Text style={styles.toggleText}>{expanded ? 'Less' : 'More'}</Text>
        </Pressable>
      )}
    </View>
  );
}

// Stands in for the About section while its text is being fetched.
export function BookAboutSkeleton() {
  return (
    <View style={styles.section}>
      <Text style={styles.heading}>About</Text>
      <SkeletonText lines={3} lineHeight={13} gap={9} lastLineWidth="70%" />
    </View>
  );
}

// "2014 · 288 pages · Knopf", skipping whatever's missing; null if nothing.
export function bookMetaLine(
  year: number | null | undefined,
  pageCount: number | null | undefined,
  publisher: string | null | undefined
): string | null {
  const parts = [
    year ? String(year) : null,
    pageCount ? `${pageCount} pages` : null,
    publisher?.trim() || null,
  ].filter(Boolean);
  return parts.length ? parts.join(' · ') : null;
}

// A few genre pills under the header. Just labels — nothing to tap.
export function GenreChips({ categories }: { categories: string[] }) {
  const shown = categories.filter((c) => c.trim()).slice(0, 3);
  if (!shown.length) return null;
  return (
    <View style={styles.chips}>
      {shown.map((c) => (
        <View key={c} style={styles.chip}>
          <Text style={styles.chipText} numberOfLines={1}>
            {c}
          </Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  section: { marginBottom: 20, gap: 6 },
  heading: {
    fontFamily: fonts.semibold,
    fontSize: 12,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    color: colors.textFaint,
  },
  body: {
    fontFamily: fonts.regular,
    fontSize: 14,
    lineHeight: 21,
    color: colors.text,
  },
  // Keeps the hidden full-length copy from stretching the page's scroll area.
  clip: { overflow: 'hidden' },
  measure: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    opacity: 0,
  },
  toggle: { alignSelf: 'flex-start' },
  toggleText: {
    fontFamily: fonts.semibold,
    fontSize: 14,
    color: colors.accent,
  },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 2 },
  chip: {
    backgroundColor: colors.chipBackground,
    borderRadius: 999,
    paddingVertical: 3,
    paddingHorizontal: 9,
    maxWidth: '100%',
  },
  chipText: {
    fontFamily: fonts.medium,
    fontSize: 11,
    color: colors.textMuted,
  },
});
