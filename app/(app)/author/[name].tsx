import { useCallback, useState } from 'react';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { FlatList, Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { supabase } from '../../../lib/supabase';
import { prefetchBook } from '../../../lib/bookDetail';
import { Skeleton } from '../../../components/Skeleton';
import { RefreshControl } from '../../../components/RefreshControl';
import { useRefetchOnVisible, useRefreshing } from '../../../lib/refresh';
import { colors, fonts, organicCorners } from '../../../lib/theme';

interface Book {
  id: string;
  title: string;
  cover_url: string | null;
}

export default function AuthorBooks() {
  const { name } = useLocalSearchParams<{ name: string }>();
  const router = useRouter();
  const [books, setBooks] = useState<Book[]>([]);
  const [loading, setLoading] = useState(true);
  const [hasLoaded, setHasLoaded] = useState(false);

  const authorName = name ? decodeURIComponent(name) : '';

  const load = useCallback(async () => {
    if (!authorName) return;
    setLoading(true);
    const { data, error } = await supabase
      .from('books')
      .select('id, title, cover_url')
      .contains('authors', [authorName])
      .order('title', { ascending: true });

    if (!error && data) {
      setBooks(data);
    }
    setLoading(false);
    setHasLoaded(true);
  }, [authorName]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );
  const { refreshing, onRefresh } = useRefreshing(load);
  useRefetchOnVisible(load);

  // Name is already known from the route — render it immediately, and
  // skeleton the grid until the first fetch for this author lands.
  if (!hasLoaded) {
    return (
      <View style={styles.container}>
        <View style={styles.list}>
          <Text style={styles.title}>{authorName}</Text>
          <View style={styles.grid}>
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} width="31%" style={styles.gridTile} />
            ))}
          </View>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <FlatList
        data={books}
        keyExtractor={(item) => item.id}
        numColumns={3}
        columnWrapperStyle={styles.gridRow}
        contentContainerStyle={styles.list}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        ListHeaderComponent={<Text style={styles.title}>{authorName}</Text>}
        ListEmptyComponent={
          !loading ? <Text style={styles.emptyBody}>No books by this author yet.</Text> : null
        }
        renderItem={({ item }) => (
          <Pressable
            style={styles.card}
            onPressIn={() => prefetchBook(item.id)}
            onPress={() =>
              router.push({
                pathname: '/book/[id]',
                params: { id: item.id, title: item.title, coverUrl: item.cover_url ?? '' },
              })
            }
          >
            {item.cover_url ? (
              <Image source={{ uri: item.cover_url }} style={styles.cover} resizeMode="cover" />
            ) : (
              <View style={styles.spinePlaceholder}>
                <Text style={styles.spineTitle} numberOfLines={5}>
                  {item.title}
                </Text>
              </View>
            )}
            <Text style={styles.cardTitle} numberOfLines={2}>
              {item.title}
            </Text>
          </Pressable>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  list: { padding: 16, flexGrow: 1 },
  title: {
    fontFamily: fonts.displaySemibold,
    fontSize: 21,
    color: colors.text,
    marginBottom: 16,
  },
  gridRow: {
    justifyContent: 'flex-start',
    gap: 12,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'flex-start',
    gap: 12,
  },
  gridTile: {
    aspectRatio: 2 / 3,
    marginBottom: 20,
    ...organicCorners,
  },
  card: {
    width: '31%',
    marginBottom: 20,
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
  cardTitle: {
    fontFamily: fonts.medium,
    fontSize: 12,
    color: colors.text,
  },
  emptyBody: {
    fontFamily: fonts.regular,
    fontSize: 14,
    color: colors.textMuted,
    textAlign: 'center',
    paddingTop: 40,
  },
});
