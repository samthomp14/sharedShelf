import { useCallback, useMemo, useState } from 'react';
import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import { Alert, FlatList, StyleSheet, Text, TextInput, View } from 'react-native';
import { supabase } from '../../../lib/supabase';
import { Chip } from '../../../components/Chip';
import { Button } from '../../../components/Button';
import { colors, fonts, inputStyle } from '../../../lib/theme';

interface FriendShelfItem {
  id: string;
  status: string;
  book: { title: string; authors: string[] } | null;
}

export default function FriendShelf() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [items, setItems] = useState<FriendShelfItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');

  const filteredItems = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter((item) => {
      const title = item.book?.title?.toLowerCase() ?? '';
      const authors = item.book?.authors?.join(' ').toLowerCase() ?? '';
      return title.includes(q) || authors.includes(q);
    });
  }, [items, query]);

  const loadShelf = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    const { data, error } = await supabase
      .from('shelf_items')
      .select('id, status, book:books(title, authors)')
      .eq('owner_id', id)
      .order('created_at', { ascending: false });

    if (!error && data) {
      setItems(data as unknown as FriendShelfItem[]);
    }
    setLoading(false);
  }, [id]);

  useFocusEffect(
    useCallback(() => {
      loadShelf();
    }, [loadShelf])
  );

  async function requestToBorrow(shelfItemId: string) {
    const { data: userData } = await supabase.auth.getUser();
    const uid = userData.user?.id;
    if (!uid) return;

    const { error } = await supabase
      .from('loan_requests')
      .insert({ shelf_item_id: shelfItemId, requester_id: uid });

    if (error) {
      Alert.alert('Could not send request', error.message);
    } else {
      Alert.alert('Request sent', "They'll see it and can hand the book off in person.");
      loadShelf();
    }
  }

  return (
    <View style={styles.container}>
      <FlatList
        data={filteredItems}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        refreshing={loading}
        onRefresh={loadShelf}
        ListHeaderComponent={
          items.length > 0 ? (
            <TextInput
              style={[inputStyle, styles.searchInput]}
              placeholder="Search this shelf by title or author"
              placeholderTextColor={colors.textFaint}
              value={query}
              onChangeText={setQuery}
              autoCapitalize="none"
            />
          ) : null
        }
        ListEmptyComponent={
          !loading ? (
            <View style={styles.empty}>
              <Text style={styles.emptyBody}>
                {items.length === 0 ? 'This shelf is empty so far.' : `No books match "${query}".`}
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
            {item.status === 'available' ? (
              <Button title="Ask to borrow" variant="secondary" onPress={() => requestToBorrow(item.id)} />
            ) : (
              <Chip label={item.status.replace('_', ' ')} />
            )}
          </View>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  list: { padding: 16, flexGrow: 1 },
  searchInput: {
    marginBottom: 16,
  },
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
  emptyBody: {
    fontFamily: fonts.regular,
    fontSize: 14,
    color: colors.textMuted,
    textAlign: 'center',
    paddingHorizontal: 32,
  },
});
