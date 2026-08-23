import { useState } from 'react';
import { Alert, FlatList, StyleSheet, Text, TextInput, View } from 'react-native';
import { supabase } from '../../lib/supabase';
import { Button } from '../../components/Button';
import { colors, fonts, inputStyle } from '../../lib/theme';

interface ProfileResult {
  id: string;
  username: string;
  display_name: string | null;
}

export default function AddFriend() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<ProfileResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [sendingId, setSendingId] = useState<string | null>(null);

  async function search() {
    if (!query.trim()) return;
    setSearching(true);

    const { data: userData } = await supabase.auth.getUser();
    const uid = userData.user?.id;

    const { data, error } = await supabase
      .from('profiles')
      .select('id, username, display_name')
      .ilike('username', `%${query.trim()}%`)
      .neq('id', uid ?? '')
      .limit(20);

    if (!error && data) {
      setResults(data);
    }
    setSearching(false);
  }

  async function sendRequest(target: ProfileResult) {
    setSendingId(target.id);

    const { data: userData } = await supabase.auth.getUser();
    const uid = userData.user?.id;
    if (!uid) {
      setSendingId(null);
      return;
    }

    const { data: existing } = await supabase
      .from('friendships')
      .select('id, requester_id, status')
      .or(
        `and(requester_id.eq.${uid},addressee_id.eq.${target.id}),and(requester_id.eq.${target.id},addressee_id.eq.${uid})`
      )
      .maybeSingle();

    if (existing) {
      if (existing.status === 'accepted') {
        Alert.alert('Already friends', `You and @${target.username} are already connected.`);
      } else if (existing.requester_id === uid) {
        Alert.alert('Request already sent');
      } else {
        // They already requested us — accept it and skip a redundant round trip.
        const { error } = await supabase
          .from('friendships')
          .update({ status: 'accepted', responded_at: new Date().toISOString() })
          .eq('id', existing.id);
        if (error) {
          Alert.alert('Could not accept request', error.message);
        } else {
          Alert.alert('You are now friends!', `@${target.username} had already requested you.`);
        }
      }
      setSendingId(null);
      return;
    }

    const { error } = await supabase
      .from('friendships')
      .insert({ requester_id: uid, addressee_id: target.id });

    setSendingId(null);

    if (error) {
      Alert.alert('Could not send request', error.message);
    } else {
      Alert.alert('Request sent', `@${target.username} will see your request.`);
    }
  }

  return (
    <View style={styles.container}>
      <View style={styles.searchRow}>
        <TextInput
          style={[inputStyle, styles.searchInput]}
          placeholder="Search by username"
          placeholderTextColor={colors.textFaint}
          value={query}
          onChangeText={setQuery}
          autoCapitalize="none"
          onSubmitEditing={search}
          returnKeyType="search"
        />
        <Button title="Search" variant="secondary" onPress={search} loading={searching} />
      </View>

      <FlatList
        data={results}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        ListEmptyComponent={
          !searching ? (
            <Text style={styles.emptyText}>Search for a username to send a friend request.</Text>
          ) : null
        }
        renderItem={({ item }) => (
          <View style={styles.row}>
            <View style={{ flex: 1 }}>
              <Text style={styles.name}>{item.display_name ?? item.username}</Text>
              <Text style={styles.username}>@{item.username}</Text>
            </View>
            <Button
              title="Add"
              variant="secondary"
              onPress={() => sendRequest(item)}
              loading={sendingId === item.id}
            />
          </View>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background, padding: 16 },
  searchRow: { flexDirection: 'row', gap: 8, alignItems: 'flex-start' },
  searchInput: { flex: 1, marginBottom: 0 },
  list: { paddingTop: 16, flexGrow: 1 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  name: { fontFamily: fonts.semibold, fontSize: 16, color: colors.text },
  username: { fontFamily: fonts.regular, fontSize: 14, color: colors.textMuted, marginTop: 2 },
  emptyText: {
    fontFamily: fonts.regular,
    fontSize: 14,
    color: colors.textMuted,
    textAlign: 'center',
    marginTop: 40,
  },
});
