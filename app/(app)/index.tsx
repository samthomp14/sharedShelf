import { useCallback, useState } from 'react';
import { useFocusEffect, useRouter } from 'expo-router';
import { FlatList, StyleSheet, Text, View } from 'react-native';
import { supabase } from '../../lib/supabase';
import { Chip } from '../../components/Chip';
import { Button } from '../../components/Button';
import { colors, fonts } from '../../lib/theme';

interface ShelfItemRow {
  id: string;
  status: string;
  book: { title: string; authors: string[]; cover_url: string | null } | null;
}

interface IncomingRequest {
  id: string;
  requester: { username: string; display_name: string | null } | null;
  shelf_item: { book: { title: string } | null } | null;
}

export default function MyShelf() {
  const router = useRouter();
  const [items, setItems] = useState<ShelfItemRow[]>([]);
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

    const [shelfResult, requestsResult] = await Promise.all([
      supabase
        .from('shelf_items')
        .select('id, status, book:books(title, authors, cover_url)')
        .eq('owner_id', uid)
        .order('created_at', { ascending: false }),
      supabase
        .from('loan_requests')
        .select(
          'id, requester:profiles(username, display_name), shelf_item:shelf_items!inner(id, owner_id, book:books(title))'
        )
        .eq('status', 'pending')
        .eq('shelf_item.owner_id', uid),
    ]);

    if (!shelfResult.error && shelfResult.data) {
      setItems(shelfResult.data as unknown as ShelfItemRow[]);
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

  async function respond(requestId: string, status: 'accepted' | 'declined') {
    setRespondingId(requestId);
    const { error } = await supabase
      .from('loan_requests')
      .update({ status, responded_at: new Date().toISOString() })
      .eq('id', requestId);
    setRespondingId(null);
    if (!error) {
      load();
    }
  }

  async function markReturned(shelfItemId: string) {
    const { data: loan } = await supabase
      .from('loans')
      .select('id')
      .eq('shelf_item_id', shelfItemId)
      .is('returned_at', null)
      .maybeSingle();

    if (loan) {
      await supabase
        .from('loans')
        .update({ returned_at: new Date().toISOString() })
        .eq('id', loan.id);
      load();
    }
  }

  async function signOut() {
    await supabase.auth.signOut();
  }

  return (
    <View style={styles.container}>
      <FlatList
        data={items}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        refreshing={loading}
        onRefresh={load}
        ListHeaderComponent={
          <View>
            <Button
              title="+ Add a book"
              variant="secondary"
              onPress={() => router.push('/add-book')}
              style={styles.addButton}
            />

            {requests.length > 0 && (
              <View style={styles.requestsSection}>
                <Text style={styles.sectionTitle}>Requests</Text>
                {requests.map((req) => (
                  <View key={req.id} style={styles.requestRow}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.bookTitle}>
                        {req.shelf_item?.book?.title ?? 'Unknown title'}
                      </Text>
                      <Text style={styles.bookAuthor}>
                        {req.requester?.display_name ?? req.requester?.username} wants to borrow this
                      </Text>
                    </View>
                    <View style={styles.requestActions}>
                      <Button
                        title="Decline"
                        variant="secondary"
                        onPress={() => respond(req.id, 'declined')}
                        loading={respondingId === req.id}
                      />
                      <Button
                        title="Accept"
                        onPress={() => respond(req.id, 'accepted')}
                        loading={respondingId === req.id}
                      />
                    </View>
                  </View>
                ))}
              </View>
            )}

            <Text style={styles.sectionTitle}>My Shelf</Text>
          </View>
        }
        ListEmptyComponent={
          !loading ? (
            <View style={styles.empty}>
              <Text style={styles.emptyTitle}>Your shelf is empty</Text>
              <Text style={styles.emptyBody}>Add the physical books you own to get started.</Text>
            </View>
          ) : null
        }
        renderItem={({ item }) => (
          <View style={styles.row}>
            <View style={{ flex: 1 }}>
              <Text style={styles.bookTitle}>{item.book?.title ?? 'Unknown title'}</Text>
              <Text style={styles.bookAuthor}>{item.book?.authors?.join(', ')}</Text>
            </View>
            {item.status === 'on_loan' ? (
              <Button title="Mark returned" variant="secondary" onPress={() => markReturned(item.id)} />
            ) : (
              <Chip label={item.status.replace('_', ' ')} />
            )}
          </View>
        )}
      />
      <View style={styles.footer}>
        <Button
          title="Profile"
          variant="secondary"
          onPress={() => router.push('/profile')}
          style={styles.footerButton}
        />
        <Button title="Sign out" variant="secondary" onPress={signOut} style={styles.footerButton} />
      </View>
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
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  bookTitle: { fontFamily: fonts.semibold, fontSize: 16, color: colors.text },
  bookAuthor: { fontFamily: fonts.regular, fontSize: 14, color: colors.textMuted, marginTop: 2 },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingTop: 40 },
  emptyTitle: { fontFamily: fonts.semibold, fontSize: 18, color: colors.text, marginBottom: 8 },
  emptyBody: {
    fontFamily: fonts.regular,
    fontSize: 14,
    color: colors.textMuted,
    textAlign: 'center',
    paddingHorizontal: 32,
  },
  footer: {
    flexDirection: 'row',
    gap: 8,
    padding: 16,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  footerButton: {
    flex: 1,
  },
});
