import { useCallback, useState } from 'react';
import { useFocusEffect, useRouter } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { supabase } from '../../../lib/supabase';
import { Avatar } from '../../../components/Avatar';
import { ShelfGrid } from '../../../components/ShelfGrid';
import { colors, fonts } from '../../../lib/theme';

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
  const [profile, setProfile] = useState<OwnProfile | null>(null);
  const [friendCount, setFriendCount] = useState(0);
  const [items, setItems] = useState<ShelfItemRow[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const { data: userData } = await supabase.auth.getUser();
    const uid = userData.user?.id;
    if (!uid) {
      setLoading(false);
      return;
    }

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
  }, []);

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
      <View style={styles.header}>
        <Avatar avatarUrl={profile.avatar_url} label={name} size={88} />
        <Text style={styles.name}>{name}</Text>
        <Text style={styles.username}>@{profile.username}</Text>
        {profile.bio && <Text style={styles.bio}>{profile.bio}</Text>}
        <Text style={styles.friendCount}>
          {friendCount} {friendCount === 1 ? 'friend' : 'friends'}
        </Text>
        <Pressable onPress={() => router.push('/profile/settings')}>
          <Text style={styles.editLink}>Edit profile</Text>
        </Pressable>
      </View>

      <ShelfGrid items={items} emptyText="Your shelf is empty. Add a book to get started." />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: 16, flexGrow: 1 },
  header: { alignItems: 'center', paddingTop: 8, paddingBottom: 28 },
  name: {
    fontFamily: fonts.semibold,
    fontSize: 20,
    color: colors.text,
    marginTop: 16,
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
    textAlign: 'center',
    marginTop: 12,
    paddingHorizontal: 16,
  },
  friendCount: {
    fontFamily: fonts.medium,
    fontSize: 13,
    color: colors.textMuted,
    marginTop: 12,
  },
  editLink: {
    fontFamily: fonts.medium,
    fontSize: 13,
    color: colors.textMuted,
    textDecorationLine: 'underline',
    marginTop: 10,
  },
});
