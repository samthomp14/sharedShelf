import { useCallback, useState } from 'react';
import { useFocusEffect, useRouter } from 'expo-router';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { supabase } from '../../lib/supabase';

interface FriendRow {
  friendshipId: string;
  friendId: string;
  username: string;
  displayName: string | null;
}

export default function Friends() {
  const router = useRouter();
  const [friends, setFriends] = useState<FriendRow[]>([]);
  const [loading, setLoading] = useState(true);

  const loadFriends = useCallback(async () => {
    setLoading(true);
    const { data: userData } = await supabase.auth.getUser();
    const uid = userData.user?.id;
    if (!uid) {
      setLoading(false);
      return;
    }

    const { data, error } = await supabase
      .from('friendships')
      .select(
        'id, requester_id, addressee_id, requester:profiles!friendships_requester_id_fkey(id, username, display_name), addressee:profiles!friendships_addressee_id_fkey(id, username, display_name)'
      )
      .eq('status', 'accepted')
      .or(`requester_id.eq.${uid},addressee_id.eq.${uid}`);

    if (!error && data) {
      const rows: FriendRow[] = data.map((row: any) => {
        const isRequester = row.requester_id === uid;
        const friend = isRequester ? row.addressee : row.requester;
        return {
          friendshipId: row.id,
          friendId: friend.id,
          username: friend.username,
          displayName: friend.display_name,
        };
      });
      setFriends(rows);
    }
    setLoading(false);
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadFriends();
    }, [loadFriends])
  );

  return (
    <View style={styles.container}>
      <FlatList
        data={friends}
        keyExtractor={(item) => item.friendshipId}
        contentContainerStyle={styles.list}
        refreshing={loading}
        onRefresh={loadFriends}
        ListEmptyComponent={
          !loading ? (
            <View style={styles.empty}>
              <Text style={styles.emptyTitle}>No friends yet</Text>
              <Text style={styles.emptyBody}>
                Adding/accepting friends is coming next — once connected, their shelves show up
                here.
              </Text>
            </View>
          ) : null
        }
        renderItem={({ item }) => (
          <Pressable
            style={styles.row}
            onPress={() => router.push(`/friend/${item.friendId}`)}
          >
            <Text style={styles.name}>{item.displayName ?? item.username}</Text>
            <Text style={styles.username}>@{item.username}</Text>
          </Pressable>
        )}
      />
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
  name: { fontSize: 16, fontWeight: '600' },
  username: { fontSize: 14, color: '#666', marginTop: 2 },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingTop: 80 },
  emptyTitle: { fontSize: 18, fontWeight: '600', marginBottom: 8 },
  emptyBody: { fontSize: 14, color: '#666', textAlign: 'center', paddingHorizontal: 32 },
});
