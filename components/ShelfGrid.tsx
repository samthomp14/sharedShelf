import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Chip } from './Chip';
import { prefetchBook } from '../lib/bookDetail';
import { colors, fonts, organicCorners } from '../lib/theme';

import type { CopyLendStatus } from '../lib/database.types';

interface ShelfGridItem {
  id: string;
  lend_status: CopyLendStatus;
  book: { id: string; title: string; cover_url: string | null } | null;
  // What to call a copy that isn't available. Friends only ever see
  // "Unavailable" (the default); your own shelf passes "With Sam" etc.
  label?: string;
}

interface ShelfGridProps {
  items: ShelfGridItem[];
  emptyText: string;
}

export function ShelfGrid({ items, emptyText }: ShelfGridProps) {
  const router = useRouter();

  if (items.length === 0) {
    return <Text style={styles.emptyText}>{emptyText}</Text>;
  }

  return (
    <View style={styles.grid}>
      {items.map((item) => (
        <Pressable
          key={item.id}
          style={styles.card}
          onPressIn={() => item.book && prefetchBook(item.book.id)}
          onPress={() =>
            item.book &&
            router.push({
              pathname: '/book/[id]',
              params: { id: item.book.id, title: item.book.title, coverUrl: item.book.cover_url ?? '' },
            })
          }
        >
          <View style={item.lend_status !== 'available' && styles.faded}>
            {item.book?.cover_url ? (
              <Image source={{ uri: item.book.cover_url }} style={styles.cover} resizeMode="cover" />
            ) : (
              <View style={styles.spinePlaceholder}>
                <Text style={styles.spineTitle} numberOfLines={5}>
                  {item.book?.title ?? 'Unknown title'}
                </Text>
              </View>
            )}
          </View>
          {item.lend_status !== 'available' && <Chip label={item.label ?? 'Unavailable'} />}
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'flex-start',
    gap: 12,
  },
  card: {
    width: '31%',
  },
  faded: {
    opacity: 0.45,
  },
  cover: {
    width: '100%',
    aspectRatio: 2 / 3,
    backgroundColor: colors.chipBackground,
    marginBottom: 6,
    overflow: 'hidden',
    ...organicCorners,
  },
  spinePlaceholder: {
    width: '100%',
    aspectRatio: 2 / 3,
    backgroundColor: colors.chipBackground,
    marginBottom: 6,
    padding: 8,
    justifyContent: 'center',
    overflow: 'hidden',
    ...organicCorners,
  },
  spineTitle: {
    fontFamily: fonts.display,
    fontSize: 12,
    color: colors.text,
    textAlign: 'center',
  },
  emptyText: {
    fontFamily: fonts.regular,
    fontSize: 14,
    color: colors.textMuted,
    textAlign: 'center',
    paddingTop: 8,
  },
});
