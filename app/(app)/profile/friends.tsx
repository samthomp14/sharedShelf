import { useCallback, useState } from 'react';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { supabase } from '../../../lib/supabase';
import { profileHref } from '../../../lib/profileHref';
import { useAuth } from '../../../contexts/AuthContext';
import { Avatar } from '../../../components/Avatar';
import { Skeleton } from '../../../components/Skeleton';
import { RefreshControl } from '../../../components/RefreshControl';
import { ShareAppButton } from '../../../components/ShareAppButton';
import { useRefetchOnVisible, useRefreshing } from '../../../lib/refresh';
import { colors, fonts, organicCorners } from '../../../lib/theme';

interface FriendRow {
  friendId: string;
  username: string;
  displayName: string | null;
  avatarUrl: string | null;
}

// Your friends, or (with an `id` param) a friend's friends. friends_of only
// answers for yourself or someone you're friends with.
export default function Friends() {
  const router = useRouter();
  const { session } = useAuth();
  const uid = session?.user?.id ?? null;
  const { id: otherId, name: otherName } = useLocalSearchParams<{ id?: string; name?: string }>();
  const target = otherId || uid;
  const isOwn = target === uid;
  const [friends, setFriends] = useState<FriendRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [hasLoaded, setHasLoaded] = useState(false);

  const load = useCallback(async () => {
    if (!target) {
      setLoading(false);
      setHasLoaded(true);
      return;
    }
    setLoading(true);

    const { data, error } = await supabase.rpc('friends_of', { target });

    if (!error && data) {
      setFriends(
        data.map((friend) => ({
          friendId: friend.id,
          username: friend.username,
          displayName: friend.display_name,
          avatarUrl: friend.avatar_url,
        }))
      );
    }

    setLoading(false);
    setHasLoaded(true);
  }, [target]);

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
        ListHeaderComponent={
          !isOwn ? (
            <Text style={styles.title}>{otherName ? `${otherName}'s friends` : 'Friends'}</Text>
          ) : friends.length > 0 ? (
            <ShareAppButton title="Invite friends to sharedShelf" variant="secondary" style={styles.invite} />
          ) : null
        }
        ListEmptyComponent={
          loading ? null : !isOwn ? (
            <View style={styles.empty}>
              <Text style={styles.emptyTitle}>No friends yet</Text>
            </View>
          ) : (
            <View style={styles.empty}>
              <Text style={styles.emptyTitle}>No friends yet</Text>
              <Text style={styles.emptyBody}>
                Invite friends to sharedShelf, or search for a username to send a friend request.
              </Text>
              <ShareAppButton style={styles.emptyInvite} />
            </View>
          )
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
  invite: { marginBottom: 8 },
  title: { fontFamily: fonts.displaySemibold, fontSize: 20, color: colors.text, marginBottom: 4 },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingTop: 40 },
  emptyTitle: { fontFamily: fonts.semibold, fontSize: 18, color: colors.text, marginBottom: 8 },
  emptyBody: {
    fontFamily: fonts.regular,
    fontSize: 14,
    color: colors.textMuted,
    textAlign: 'center',
    paddingHorizontal: 32,
  },
  emptyInvite: { marginTop: 20, alignSelf: 'stretch', paddingHorizontal: 32 },
});
