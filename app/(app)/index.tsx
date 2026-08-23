import { useCallback, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { supabase } from '../../lib/supabase';

interface ShelfItemRow {
  id: string;
  status: string;
  book: { title: string; authors: string[]; cover_url: string | null } | null;
}

export default function MyShelf() {
  const [items, setItems] = useState<ShelfItemRow[]>([]);
  const [loading, setLoading] = useState(true);

  const loadShelf = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('shelf_items')
      .select('id, status, book:books(title, authors, cover_url)')
      .order('created_at', { ascending: false });

    if (!error && data) {
      setItems(data as unknown as ShelfItemRow[]);
    }
    setLoading(false);
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadShelf();
    }, [loadShelf])
  );

  async function signOut() {
    await supabase.auth.signOut();
  }

  return (
    <View style={styles.container}>
      <FlatList
        data={items}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        refreshing={loading}
        onRefresh={loadShelf}
        ListEmptyComponent={
          !loading ? (
            <View style={styles.empty}>
              <Text style={styles.emptyTitle}>Your shelf is empty</Text>
              <Text style={styles.emptyBody}>
                Book scanning/adding is coming next — this screen will list every physical book
                you own once that's wired up.
              </Text>
            </View>
          ) : null
        }
        renderItem={({ item }) => (
          <View style={styles.row}>
            <Text style={styles.bookTitle}>{item.book?.title ?? 'Unknown title'}</Text>
            <Text style={styles.bookAuthor}>{item.book?.authors?.join(', ')}</Text>
            <Text style={styles.status}>{item.status}</Text>
          </View>
        )}
      />
      <Pressable style={styles.signOut} onPress={signOut}>
        <Text style={styles.signOutText}>Sign out</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  list: { padding: 16, flexGrow: 1 },
  row: {
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#ddd',
  },
  bookTitle: { fontSize: 16, fontWeight: '600' },
  bookAuthor: { fontSize: 14, color: '#666', marginTop: 2 },
  status: { fontSize: 12, color: '#999', marginTop: 4, textTransform: 'uppercase' },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingTop: 80 },
  emptyTitle: { fontSize: 18, fontWeight: '600', marginBottom: 8 },
  emptyBody: { fontSize: 14, color: '#666', textAlign: 'center', paddingHorizontal: 32 },
  signOut: { padding: 16, alignItems: 'center' },
  signOutText: { color: '#c00', fontSize: 14 },
});
