import { useCallback, useState } from 'react';
import { useFocusEffect, useRouter } from 'expo-router';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { supabase } from '../../../lib/supabase';
import { profileHref } from '../../../lib/profileHref';
import { useAuth } from '../../../contexts/AuthContext';
import { Avatar } from '../../../components/Avatar';
import { Skeleton } from '../../../components/Skeleton';
import { RefreshControl } from '../../../components/RefreshControl';
import { useRefetchOnVisible, useRefreshing } from '../../../lib/refresh';
import { colors, fonts, organicCorners } from '../../../lib/theme';

interface FriendRow {
  friendId: string;
  username: string;
  displayName: string | null;
  avatarUrl: string | null;
}

export default function Friends() {
  const router = useRouter();
  const { session } = useAuth();
  const uid = session?.user?.id ?? null;
  const [friends, setFriends] = useState<FriendRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [hasLoaded, setHasLoaded] = useState(false);

  const load = useCallback(async () => {
    if (!uid) {
      setLoading(false);
      setHasLoaded(true);
      return;
    }
    setLoading(true);

    const { data, error } = await supabase
      .from('friendships')
      .select(
        'id, requester_id, addressee_id, requester:profiles!friendships_requester_id_fkey(id, username, display_name, avatar_url), addressee:profiles!friendships_addressee_id_fkey(id, username, display_name, avatar_url)'
      )
      .eq('status', 'accepted')
      .or(`requester_id.eq.${uid},addressee_id.eq.${uid}`);

    if (!error && data) {
      const rows: FriendRow[] = data.map((row: any) => {
        const isRequester = row.requester_id === uid;
        const friend = isRequester ? row.addressee : row.requester;
        return {
          friendId: friend.id,
          username: friend.username,
          displayName: friend.display_name,
          avatarUrl: friend.avatar_url,
        };
      });
      setFriends(rows);
    }

    setLoading(false);
    setHasLoaded(true);
  }, [uid]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );
  const { refreshing, onRefresh } = useRefreshing(load);
  useRefetchOnVisible(load);

  if (!hasLoaded) {
    return (
      <View style={styles.container}>
        <View style={styles.list}>
          {Array.from({ length: 6 }).map((_, i) => (
            <View key={i} style={styles.row}>
              <Skeleton width={44} height={44} style={organicCorners} />
              <View style={{ flex: 1 }}>
                <Skeleton width="45%" height={16} />
                <Skeleton width="30%" height={14} style={{ marginTop: 6 }} />
              </View>
            </View>
          ))}
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <FlatList
        data={friends}
        keyExtractor={(item) => item.friendId}
        contentContainerStyle={styles.list}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        ListEmptyComponent={
          !loading ? (
            <View style={styles.empty}>
              <Text style={styles.emptyTitle}>No friends yet</Text>
              <Text style={styles.emptyBody}>Search for a username to send a friend request.</Text>
            </View>
          ) : null
        }
        renderItem={({ item }) => (
          <Pressable
            style={styles.row}
            onPress={() => router.push(profileHref(item.username, item.displayName, item.avatarUrl))}
          >
            <Avatar avatarUrl={item.avatarUrl} label={item.displayName ?? item.username} size={44} />
            <View>
              <Text style={styles.name}>{item.displayName ?? item.username}</Text>
              <Text style={styles.username}>@{item.username}</Text>
            </View>
          </Pressable>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  list: { padding: 16, flexGrow: 1 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  name: { fontFamily: fonts.semibold, fontSize: 16, color: colors.text },
  username: { fontFamily: fonts.regular, fontSize: 14, color: colors.textMuted, marginTop: 2 },
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
