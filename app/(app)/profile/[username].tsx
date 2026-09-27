import { useCallback, useState } from 'react';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { Alert, ScrollView, StyleSheet, Text, View } from 'react-native';
import { supabase } from '../../../lib/supabase';
import { useAuth } from '../../../contexts/AuthContext';
import { Avatar } from '../../../components/Avatar';
import { Button } from '../../../components/Button';
import { ShelfGrid } from '../../../components/ShelfGrid';
import { Skeleton, SkeletonText } from '../../../components/Skeleton';
import { RefreshControl } from '../../../components/RefreshControl';
import { useRefetchOnVisible, useRefreshing } from '../../../lib/refresh';
import { colors, fonts } from '../../../lib/theme';
import type { CopyLendStatus } from '../../../lib/database.types';

interface OtherProfile {
  id: string;
  username: string;
  display_name: string | null;
  avatar_url: string | null;
  bio: string | null;
}

interface ShelfItemRow {
  id: string;
  lend_status: CopyLendStatus;
  book: { id: string; title: string; cover_url: string | null } | null;
}

type FriendStatus = 'none' | 'pending_sent' | 'pending_received' | 'friends';

export default function UserProfile() {
  const {
    username,
    displayName: placeholderDisplayName,
    avatarUrl: placeholderAvatarUrl,
  } = useLocalSearchParams<{ username: string; displayName?: string; avatarUrl?: string }>();
  const router = useRouter();
  const { session } = useAuth();
  const ownerId = session?.user?.id ?? null;
  // The list/feed we tapped from already knew the name and avatar — render
  // those immediately, and only skeleton the parts that need their own
  // fetch (bio, friend/book counts, friendship status, shelf).
  const [profile, setProfile] = useState<OtherProfile | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [friendCount, setFriendCount] = useState<number | null>(null);
  const [items, setItems] = useState<ShelfItemRow[] | null>(null);
  const [friendshipId, setFriendshipId] = useState<string | null>(null);
  const [status, setStatus] = useState<FriendStatus | null>(null);
  const [acting, setActing] = useState(false);
  const [confirmingUnfriend, setConfirmingUnfriend] = useState(false);

  const load = useCallback(async () => {
    if (!username) return;

    const profileResult = await supabase
      .from('profiles')
      .select('id, username, display_name, avatar_url, bio')
      .eq('username', username)
      .single();

    if (profileResult.error || !profileResult.data) {
      setNotFound(true);
      return;
    }

    const targetId = profileResult.data.id;

    if (ownerId && ownerId === targetId) {
      router.replace('/profile');
      return;
    }

    setProfile(profileResult.data);

    const [countResult, friendshipResult, itemsResult] = await Promise.all([
      supabase.rpc('friend_count', { target: targetId }),
      ownerId
        ? supabase
            .from('friendships')
            .select('id, requester_id, status')
            .or(`and(requester_id.eq.${ownerId},addressee_id.eq.${targetId}),and(requester_id.eq.${targetId},addressee_id.eq.${ownerId})`)
            .maybeSingle()
        : Promise.resolve({ data: null, error: null }),
      supabase
        .from('shelf_items')
        .select('id, lend_status, book:books(id, title, cover_url)')
        .eq('owner_id', targetId)
        .order('sort_order', { ascending: true })
        .order('created_at', { ascending: false }),
    ]);

    if (!countResult.error && typeof countResult.data === 'number') {
      setFriendCount(countResult.data);
    }
    if (!itemsResult.error && itemsResult.data) {
      setItems(itemsResult.data as unknown as ShelfItemRow[]);
    }

    if (friendshipResult.data) {
      setFriendshipId(friendshipResult.data.id);
      if (friendshipResult.data.status === 'accepted') {
        setStatus('friends');
      } else if (friendshipResult.data.requester_id === ownerId) {
        setStatus('pending_sent');
      } else {
        setStatus('pending_received');
      }
    } else {
      setFriendshipId(null);
      setStatus('none');
    }
  }, [username, router, ownerId]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );
  const { refreshing, onRefresh } = useRefreshing(load);
  useRefetchOnVisible(load);

  async function sendRequest() {
    if (!ownerId || !profile) return;
    setActing(true);
    const { error } = await supabase
      .from('friendships')
      .insert({ requester_id: ownerId, addressee_id: profile.id });
    setActing(false);
    if (error) {
      Alert.alert('Could not send request', error.message);
    } else {
      load();
    }
  }

  async function respond(newStatus: 'accepted' | 'declined') {
    if (!friendshipId) return;
    setActing(true);
    if (newStatus === 'accepted') {
      await supabase
        .from('friendships')
        .update({ status: 'accepted', responded_at: new Date().toISOString() })
        .eq('id', friendshipId);
    } else {
      await supabase.from('friendships').delete().eq('id', friendshipId);
    }
    setActing(false);
    load();
  }

  async function unfriend() {
    if (!friendshipId) return;
    setActing(true);
    const { error } = await supabase.from('friendships').delete().eq('id', friendshipId);
    setActing(false);
    if (error) {
      Alert.alert('Could not unfriend', error.message);
      return;
    }
    setConfirmingUnfriend(false);
    load();
  }

  if (notFound) {
    return (
      <View style={styles.container}>
        <Text style={[styles.content, styles.emptyBody]}>Couldn't find that profile.</Text>
      </View>
    );
  }

  // Name/avatar/@username are known the moment we land here — either from
  // the full profile once it's loaded, or from what the list we tapped from
  // already had. Everything else (bio, counts, status, shelf) waits on its
  // own fetch and shows a skeleton until then.
  const name = profile?.display_name ?? profile?.username ?? (placeholderDisplayName || username);
  const avatarUrl = profile ? profile.avatar_url : placeholderAvatarUrl || null;
  const detailsLoaded = status !== null;
  const isFriends = status === 'friends';

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
    >
      <View style={styles.topRow}>
        <Avatar avatarUrl={avatarUrl} label={name} size={80} />
        <View style={styles.stats}>
          {!detailsLoaded ? (
            <>
              <View style={styles.stat}>
                <Skeleton width={28} height={18} style={styles.statSkeleton} />
                <Skeleton width={40} height={12} style={styles.statSkeleton} />
              </View>
              <View style={styles.stat}>
                <Skeleton width={28} height={18} style={styles.statSkeleton} />
                <Skeleton width={40} height={12} style={styles.statSkeleton} />
              </View>
            </>
          ) : (
            <>
              {isFriends && (
                <View style={styles.stat}>
                  <Text style={styles.statNumber}>{items?.length ?? 0}</Text>
                  <Text style={styles.statLabel}>{items?.length === 1 ? 'book' : 'books'}</Text>
                </View>
              )}
              <View style={styles.stat}>
                <Text style={styles.statNumber}>{friendCount ?? 0}</Text>
                <Text style={styles.statLabel}>{friendCount === 1 ? 'friend' : 'friends'}</Text>
              </View>
            </>
          )}
        </View>
      </View>

      <Text style={styles.name}>{name}</Text>
      <Text style={styles.username}>@{username}</Text>
      {!detailsLoaded ? (
        <SkeletonText lines={1} lineHeight={14} lastLineWidth="40%" style={styles.bioSkeleton} />
      ) : (
        profile?.bio && <Text style={styles.bio}>{profile.bio}</Text>
      )}

      {!detailsLoaded && (
        <View style={styles.actions}>
          <Skeleton height={44} borderRadius={999} />
        </View>
      )}

      {detailsLoaded && !isFriends && (
        <View style={styles.actions}>
          {status === 'none' && <Button title="Add friend" onPress={sendRequest} loading={acting} />}
          {status === 'pending_sent' && (
            <Button
              title="Cancel request"
              variant="secondary"
              onPress={() => respond('declined')}
              loading={acting}
            />
          )}
          {status === 'pending_received' && (
            <>
              <Button title="Accept request" onPress={() => respond('accepted')} loading={acting} />
              <Button
                title="Decline"
                variant="secondary"
                onPress={() => respond('declined')}
                loading={acting}
              />
            </>
          )}
          <Text style={styles.hint}>Add each other as friends to see their shelf.</Text>
        </View>
      )}

      {detailsLoaded && isFriends && (
        <View style={styles.actions}>
          {confirmingUnfriend ? (
            <View style={styles.confirm}>
              <Text style={styles.confirmText}>
                Unfriend @{username}? You'll stop seeing each other's shelves, and any open borrow
                requests between you are cancelled. Books already lent stay tracked until they're back.
              </Text>
              <Button title="Unfriend" onPress={unfriend} loading={acting} />
              <Button
                title="Cancel"
                variant="ghost"
                onPress={() => setConfirmingUnfriend(false)}
                disabled={acting}
              />
            </View>
          ) : (
            <Button
              title="Friends ✓"
              variant="secondary"
              size="compact"
              onPress={() => setConfirmingUnfriend(true)}
            />
          )}
        </View>
      )}

      {detailsLoaded && isFriends && (
        <View style={styles.grid}>
          <ShelfGrid
            items={(items ?? []).map((item) => ({
              id: item.id,
              book: item.book,
              // Friends never learn who has a copy, or why it's off.
              badge: item.lend_status === 'available' ? null : { kind: 'unavailable', label: 'Unavailable' },
            }))}
            emptyText="This shelf is empty so far."
          />
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: 16, flexGrow: 1 },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 24,
    marginBottom: 16,
  },
  stats: {
    flex: 1,
    flexDirection: 'row',
  },
  stat: {
    flex: 1,
    alignItems: 'center',
  },
  statSkeleton: {
    marginTop: 4,
  },
  statNumber: {
    fontFamily: fonts.semibold,
    fontSize: 18,
    color: colors.text,
  },
  statLabel: {
    fontFamily: fonts.regular,
    fontSize: 13,
    color: colors.textMuted,
    marginTop: 2,
  },
  name: {
    fontFamily: fonts.displayItalic,
    fontSize: 19,
    color: colors.text,
  },
  username: {
    fontFamily: fonts.regular,
    fontSize: 14,
    color: colors.textMuted,
    marginTop: 2,
  },
  bio: {
    fontFamily: fonts.regular,
    fontSize: 14,
    color: colors.text,
    marginTop: 8,
  },
  bioSkeleton: {
    marginTop: 10,
  },
  actions: {
    gap: 10,
    marginTop: 16,
  },
  grid: {
    marginTop: 20,
  },
  confirm: {
    gap: 10,
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
  },
  confirmText: {
    fontFamily: fonts.regular,
    fontSize: 14,
    color: colors.text,
    lineHeight: 20,
  },
  hint: {
    fontFamily: fonts.regular,
    fontSize: 13,
    color: colors.textFaint,
    textAlign: 'center',
  },
  emptyBody: {
    fontFamily: fonts.regular,
    fontSize: 14,
    color: colors.textMuted,
  },
});
