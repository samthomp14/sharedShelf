import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Chip } from './Chip';
import { prefetchBook } from '../lib/bookDetail';
import { colors, fonts } from '../lib/theme';

interface ShelfGridItem {
  id: string;
  status: string;
  book: { id: string; title: string; cover_url: string | null } | null;
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
          {item.book?.cover_url ? (
            <Image source={{ uri: item.book.cover_url }} style={styles.cover} resizeMode="cover" />
          ) : (
            <View style={styles.spinePlaceholder}>
              <Text style={styles.spineTitle} numberOfLines={5}>
                {item.book?.title ?? 'Unknown title'}
              </Text>
            </View>
          )}
          {item.status !== 'available' && <Chip label={item.status.replace('_', ' ')} />}
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
  cover: {
    width: '100%',
    aspectRatio: 2 / 3,
    backgroundColor: colors.chipBackground,
    marginBottom: 6,
  },
  spinePlaceholder: {
    width: '100%',
    aspectRatio: 2 / 3,
    backgroundColor: colors.chipBackground,
    marginBottom: 6,
    padding: 8,
    justifyContent: 'center',
  },
  spineTitle: {
    fontFamily: fonts.semibold,
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
