import { useCallback, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { FlatList, StyleSheet, Text, View } from 'react-native';
import { supabase } from '../../lib/supabase';
import { Chip } from '../../components/Chip';
import { Button } from '../../components/Button';
import { colors, fonts } from '../../lib/theme';

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
            <View style={{ flex: 1 }}>
              <Text style={styles.bookTitle}>{item.book?.title ?? 'Unknown title'}</Text>
              <Text style={styles.bookAuthor}>{item.book?.authors?.join(', ')}</Text>
            </View>
            <Chip label={item.status.replace('_', ' ')} />
          </View>
        )}
      />
      <View style={styles.footer}>
        <Button title="Sign out" variant="secondary" onPress={signOut} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  list: { padding: 16, flexGrow: 1 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  bookTitle: { fontFamily: fonts.semibold, fontSize: 16, color: colors.text },
  bookAuthor: { fontFamily: fonts.regular, fontSize: 14, color: colors.textMuted, marginTop: 2 },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingTop: 80 },
  emptyTitle: { fontFamily: fonts.semibold, fontSize: 18, color: colors.text, marginBottom: 8 },
  emptyBody: {
    fontFamily: fonts.regular,
    fontSize: 14,
    color: colors.textMuted,
    textAlign: 'center',
    paddingHorizontal: 32,
  },
  footer: {
    padding: 16,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
});
