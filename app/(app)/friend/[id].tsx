import { useCallback, useState } from 'react';
import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import { Alert, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { supabase } from '../../../lib/supabase';

interface FriendShelfItem {
  id: string;
  status: string;
  book: { title: string; authors: string[] } | null;
}

export default function FriendShelf() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [items, setItems] = useState<FriendShelfItem[]>([]);
  const [loading, setLoading] = useState(true);

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
        data={items}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        refreshing={loading}
        onRefresh={loadShelf}
        ListEmptyComponent={
          !loading ? (
            <View style={styles.empty}>
              <Text style={styles.emptyBody}>This shelf is empty so far.</Text>
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
              <Pressable style={styles.borrowButton} onPress={() => requestToBorrow(item.id)}>
                <Text style={styles.borrowButtonText}>Ask to borrow</Text>
              </Pressable>
            ) : (
              <Text style={styles.status}>{item.status}</Text>
            )}
          </View>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  list: { padding: 16, flexGrow: 1 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#ddd',
  },
  bookTitle: { fontSize: 16, fontWeight: '600' },
  bookAuthor: { fontSize: 14, color: '#666', marginTop: 2 },
  status: { fontSize: 12, color: '#999', textTransform: 'uppercase' },
  borrowButton: {
    backgroundColor: '#111',
    borderRadius: 6,
    paddingVertical: 8,
    paddingHorizontal: 12,
  },
  borrowButtonText: { color: '#fff', fontSize: 13, fontWeight: '600' },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingTop: 80 },
  emptyBody: { fontSize: 14, color: '#666', textAlign: 'center', paddingHorizontal: 32 },
});
