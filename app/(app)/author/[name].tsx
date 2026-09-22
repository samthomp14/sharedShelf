import { useCallback, useState } from 'react';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { FlatList, Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { supabase } from '../../../lib/supabase';
import { colors, fonts } from '../../../lib/theme';

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

  const authorName = name ? decodeURIComponent(name) : '';

  const load = useCallback(async () => {
    if (!authorName) return;
    setLoading(true);
    setBooks([]);
    const { data, error } = await supabase
      .from('books')
      .select('id, title, cover_url')
      .contains('authors', [authorName])
      .order('title', { ascending: true });

    if (!error && data) {
      setBooks(data);
    }
    setLoading(false);
  }, [authorName]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  return (
    <View style={styles.container}>
      <FlatList
        data={books}
        keyExtractor={(item) => item.id}
        numColumns={3}
        columnWrapperStyle={styles.gridRow}
        contentContainerStyle={styles.list}
        refreshing={loading}
        onRefresh={load}
        ListHeaderComponent={<Text style={styles.title}>{authorName}</Text>}
        ListEmptyComponent={
          !loading ? <Text style={styles.emptyBody}>No books by this author yet.</Text> : null
        }
        renderItem={({ item }) => (
          <Pressable style={styles.card} onPress={() => router.push(`/book/${item.id}`)}>
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
    fontFamily: fonts.semibold,
    fontSize: 20,
    color: colors.text,
    marginBottom: 16,
  },
  gridRow: {
    justifyContent: 'flex-start',
    gap: 12,
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
