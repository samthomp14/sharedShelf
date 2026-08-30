import { useCallback, useState } from 'react';
import { useFocusEffect, useRouter } from 'expo-router';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { supabase } from '../../lib/supabase';
import { Button } from '../../components/Button';
import { colors, fonts } from '../../lib/theme';

interface FriendRow {
  friendshipId: string;
  friendId: string;
  username: string;
  displayName: string | null;
}

interface IncomingRequest {
  id: string;
  requester: { username: string; display_name: string | null } | null;
}

export default function Friends() {
  const router = useRouter();
  const [friends, setFriends] = useState<FriendRow[]>([]);
  const [requests, setRequests] = useState<IncomingRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [respondingId, setRespondingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const { data: userData } = await supabase.auth.getUser();
    const uid = userData.user?.id;
    if (!uid) {
      setLoading(false);
      return;
    }

    const [friendsResult, requestsResult] = await Promise.all([
      supabase
        .from('friendships')
        .select(
          'id, requester_id, addressee_id, requester:profiles!friendships_requester_id_fkey(id, username, display_name), addressee:profiles!friendships_addressee_id_fkey(id, username, display_name)'
        )
        .eq('status', 'accepted')
        .or(`requester_id.eq.${uid},addressee_id.eq.${uid}`),
      supabase
        .from('friendships')
        .select('id, requester:profiles!friendships_requester_id_fkey(username, display_name)')
        .eq('status', 'pending')
        .eq('addressee_id', uid),
    ]);

    if (!friendsResult.error && friendsResult.data) {
      const rows: FriendRow[] = friendsResult.data.map((row: any) => {
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

    if (!requestsResult.error && requestsResult.data) {
      setRequests(requestsResult.data as unknown as IncomingRequest[]);
    }

    setLoading(false);
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  async function accept(requestId: string) {
    setRespondingId(requestId);
    await supabase
      .from('friendships')
      .update({ status: 'accepted', responded_at: new Date().toISOString() })
      .eq('id', requestId);
    setRespondingId(null);
    load();
  }

  async function decline(requestId: string) {
    setRespondingId(requestId);
    await supabase.from('friendships').delete().eq('id', requestId);
    setRespondingId(null);
    load();
  }

  return (
    <View style={styles.container}>
      <FlatList
        data={friends}
        keyExtractor={(item) => item.friendshipId}
        contentContainerStyle={styles.list}
        refreshing={loading}
        onRefresh={load}
        ListHeaderComponent={
          <View>
            <Button
              title="+ Add a friend"
              variant="secondary"
              onPress={() => router.push('/add-friend')}
              style={styles.addButton}
            />

            {requests.length > 0 && (
              <View style={styles.requestsSection}>
                <Text style={styles.sectionTitle}>Requests</Text>
                {requests.map((req) => (
                  <View key={req.id} style={styles.requestRow}>
                    <Text style={styles.bookAuthor}>
                      {req.requester?.display_name ?? req.requester?.username}
                    </Text>
                    <View style={styles.requestActions}>
                      <Button
                        title="Decline"
                        variant="secondary"
                        onPress={() => decline(req.id)}
                        loading={respondingId === req.id}
                      />
                      <Button
                        title="Accept"
                        onPress={() => accept(req.id)}
                        loading={respondingId === req.id}
                      />
                    </View>
                  </View>
                ))}
              </View>
            )}

            <Text style={styles.sectionTitle}>Friends</Text>
          </View>
        }
        ListEmptyComponent={
          !loading ? (
            <View style={styles.empty}>
              <Text style={styles.emptyTitle}>No friends yet</Text>
              <Text style={styles.emptyBody}>
                Search for a username to send a friend request.
              </Text>
            </View>
          ) : null
        }
        renderItem={({ item }) => (
          <Pressable style={styles.row} onPress={() => router.push(`/profile/${item.friendId}`)}>
            <Text style={styles.name}>{item.displayName ?? item.username}</Text>
            <Text style={styles.username}>@{item.username}</Text>
          </Pressable>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  list: { padding: 16, flexGrow: 1 },
  addButton: { marginBottom: 16 },
  sectionTitle: {
    fontFamily: fonts.semibold,
    fontSize: 13,
    color: colors.textMuted,
    textTransform: 'uppercase',
    marginBottom: 8,
    marginTop: 8,
  },
  requestsSection: {
    marginBottom: 16,
    paddingBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  requestRow: {
    paddingVertical: 10,
    gap: 8,
  },
  requestActions: {
    flexDirection: 'row',
    gap: 8,
  },
  row: {
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  name: { fontFamily: fonts.semibold, fontSize: 16, color: colors.text },
  username: { fontFamily: fonts.regular, fontSize: 14, color: colors.textMuted, marginTop: 2 },
  bookAuthor: { fontFamily: fonts.regular, fontSize: 14, color: colors.text },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingTop: 40 },
  emptyTitle: { fontFamily: fonts.semibold, fontSize: 18, color: colors.text, marginBottom: 8 },
  emptyBody: {
    fontFamily: fonts.regular,
    fontSize: 14,
    color: colors.textMuted,
    textAlign: 'center',
    paddingHorizontal: 32,
  },
});
