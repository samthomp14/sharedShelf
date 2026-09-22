import { useCallback, useState } from 'react';
import { useFocusEffect, useRouter } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { supabase } from '../../../../lib/supabase';
import { useAuth } from '../../../../contexts/AuthContext';
import { Avatar } from '../../../../components/Avatar';
import { Button } from '../../../../components/Button';
import { ShelfGrid } from '../../../../components/ShelfGrid';
import { colors, fonts } from '../../../../lib/theme';

interface OwnProfile {
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

export default function Profile() {
  const router = useRouter();
  const { session } = useAuth();
  const uid = session?.user?.id ?? null;
  const [profile, setProfile] = useState<OwnProfile | null>(null);
  const [friendCount, setFriendCount] = useState(0);
  const [items, setItems] = useState<ShelfItemRow[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!uid) {
      setLoading(false);
      return;
    }
    setLoading(true);

    const [profileResult, countResult, itemsResult] = await Promise.all([
      supabase.from('profiles').select('username, display_name, avatar_url, bio').eq('id', uid).single(),
      supabase.rpc('friend_count', { target: uid }),
      supabase
        .from('shelf_items')
        .select('id, status, book:books(id, title, cover_url)')
        .eq('owner_id', uid)
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
    setLoading(false);
  }, [uid]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  if (loading || !profile) {
    return <View style={styles.container} />;
  }

  const name = profile.display_name ?? profile.username;

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.topRow}>
        <Avatar avatarUrl={profile.avatar_url} label={name} size={80} />
        <View style={styles.stats}>
          <View style={styles.stat}>
            <Text style={styles.statNumber}>{items.length}</Text>
            <Text style={styles.statLabel}>{items.length === 1 ? 'book' : 'books'}</Text>
          </View>
          <Pressable style={styles.stat} onPress={() => router.push('/profile/friends')}>
            <Text style={styles.statNumber}>{friendCount}</Text>
            <Text style={styles.statLabel}>{friendCount === 1 ? 'friend' : 'friends'}</Text>
          </Pressable>
        </View>
      </View>

      <Text style={styles.name}>{name}</Text>
      <Text style={styles.username}>@{profile.username}</Text>
      {profile.bio && <Text style={styles.bio}>{profile.bio}</Text>}

      <Button
        title="Edit profile"
        variant="secondary"
        onPress={() => router.push('/profile/settings')}
        style={styles.editButton}
      />

      <ShelfGrid items={items} emptyText="Your shelf is empty. Add a book to get started." />
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
  editButton: {
    marginTop: 16,
    marginBottom: 24,
  },
});
