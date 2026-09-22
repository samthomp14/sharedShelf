import { useCallback, useState } from 'react';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { Alert, ScrollView, StyleSheet, Text, View } from 'react-native';
import { supabase } from '../../../lib/supabase';
import { useAuth } from '../../../contexts/AuthContext';
import { Avatar } from '../../../components/Avatar';
import { Button } from '../../../components/Button';
import { ShelfGrid } from '../../../components/ShelfGrid';
import { colors, fonts } from '../../../lib/theme';

interface OtherProfile {
  username: string;
  display_name: string | null;
  avatar_url: string | null;
  bio: string | null;
}

interface ShelfItemRow {
  id: string;
  status: string;
  book: { id: string; title: string; cover_url: string | null } | null;
}

type FriendStatus = 'none' | 'pending_sent' | 'pending_received' | 'friends';

export default function UserProfile() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { session } = useAuth();
  const ownerId = session?.user?.id ?? null;
  const [profile, setProfile] = useState<OtherProfile | null>(null);
  const [friendCount, setFriendCount] = useState(0);
  const [items, setItems] = useState<ShelfItemRow[]>([]);
  const [friendshipId, setFriendshipId] = useState<string | null>(null);
  const [status, setStatus] = useState<FriendStatus>('none');
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);

    if (ownerId && ownerId === id) {
      router.replace('/profile');
      return;
    }

    const [profileResult, countResult, friendshipResult, itemsResult] = await Promise.all([
      supabase.from('profiles').select('username, display_name, avatar_url, bio').eq('id', id).single(),
      supabase.rpc('friend_count', { target: id }),
      ownerId
        ? supabase
            .from('friendships')
            .select('id, requester_id, status')
            .or(`and(requester_id.eq.${ownerId},addressee_id.eq.${id}),and(requester_id.eq.${id},addressee_id.eq.${ownerId})`)
            .maybeSingle()
        : Promise.resolve({ data: null, error: null }),
      supabase
        .from('shelf_items')
        .select('id, status, book:books(id, title, cover_url)')
        .eq('owner_id', id)
        .order('sort_order', { ascending: true })
        .order('created_at', { ascending: false }),
    ]);

    if (!profileResult.error && profileResult.data) {
      setProfile(profileResult.data);
    }
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

    setLoading(false);
  }, [id, router, ownerId]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  async function sendRequest() {
    if (!ownerId || !id) return;
    setActing(true);
    const { error } = await supabase
      .from('friendships')
      .insert({ requester_id: ownerId, addressee_id: id });
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

  if (loading || !profile) {
    return <View style={styles.container} />;
  }

  const name = profile.display_name ?? profile.username;
  const isFriends = status === 'friends';

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.topRow}>
        <Avatar avatarUrl={profile.avatar_url} label={name} size={80} />
        <View style={styles.stats}>
          {isFriends && (
            <View style={styles.stat}>
              <Text style={styles.statNumber}>{items.length}</Text>
              <Text style={styles.statLabel}>{items.length === 1 ? 'book' : 'books'}</Text>
            </View>
          )}
          <View style={styles.stat}>
            <Text style={styles.statNumber}>{friendCount}</Text>
            <Text style={styles.statLabel}>{friendCount === 1 ? 'friend' : 'friends'}</Text>
          </View>
        </View>
      </View>

      <Text style={styles.name}>{name}</Text>
      <Text style={styles.username}>@{profile.username}</Text>
      {profile.bio && <Text style={styles.bio}>{profile.bio}</Text>}

      {!isFriends && (
        <View style={styles.actions}>
          {status === 'none' && <Button title="Add friend" onPress={sendRequest} loading={acting} />}
          {status === 'pending_sent' && <Button title="Request sent" variant="secondary" disabled />}
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

      {isFriends && (
        <View style={styles.grid}>
          <ShelfGrid items={items} emptyText="This shelf is empty so far." />
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
    fontFamily: fonts.semibold,
    fontSize: 17,
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
  actions: {
    gap: 10,
    marginTop: 16,
  },
  grid: {
    marginTop: 20,
  },
  hint: {
    fontFamily: fonts.regular,
    fontSize: 13,
    color: colors.textFaint,
    textAlign: 'center',
  },
});
