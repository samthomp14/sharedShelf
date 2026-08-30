import { useCallback, useMemo, useState } from 'react';
import { useFocusEffect, useRouter } from 'expo-router';
import { FlatList, Image, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import DraggableFlatList, { type RenderItemParams } from 'react-native-draggable-flatlist';
import { supabase } from '../../lib/supabase';
import { Chip } from '../../components/Chip';
import { Button } from '../../components/Button';
import { AuthorList } from '../../components/AuthorList';
import { colors, fonts, inputStyle } from '../../lib/theme';

type ViewMode = 'covers' | 'list';

interface ShelfItemRow {
  id: string;
  status: string;
  sort_order: number;
  book: { id: string; title: string; authors: string[]; cover_url: string | null } | null;
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
  const [query, setQuery] = useState('');
  const [viewMode, setViewMode] = useState<ViewMode>('list');

  const filteredItems = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter((item) => {
      const title = item.book?.title?.toLowerCase() ?? '';
      const authors = item.book?.authors?.join(' ').toLowerCase() ?? '';
      return title.includes(q) || authors.includes(q);
    });
  }, [items, query]);

  const canReorder = viewMode === 'list' && !query.trim();

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
        .select('id, status, sort_order, book:books(id, title, authors, cover_url)')
        .eq('owner_id', uid)
        .order('sort_order', { ascending: true })
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

  function handleDragEnd(data: ShelfItemRow[]) {
    const reordered = data.map((item, index) => ({ ...item, sort_order: index }));
    setItems(reordered);
    Promise.all(
      reordered.map((item) =>
        supabase.from('shelf_items').update({ sort_order: item.sort_order }).eq('id', item.id)
      )
    );
  }

  function renderCard(item: ShelfItemRow, drag?: () => void, isActive?: boolean) {
    return viewMode === 'covers' ? (
      <Pressable
        style={[styles.coverCard, isActive && styles.activeRow]}
        onPress={() => item.book && router.push(`/book/${item.book.id}`)}
      >
        {item.book?.cover_url ? (
          <Image source={{ uri: item.book.cover_url }} style={styles.coverImage} resizeMode="cover" />
        ) : (
          <View style={styles.spinePlaceholder}>
            <Text style={styles.spineTitle} numberOfLines={5}>
              {item.book?.title ?? 'Unknown title'}
            </Text>
          </View>
        )}
        <Text style={styles.coverCardTitle} numberOfLines={2}>
          {item.book?.title ?? 'Unknown title'}
        </Text>
        {item.status !== 'available' && <Chip label={item.status.replace('_', ' ')} />}
      </Pressable>
    ) : (
      <Pressable
        style={[styles.row, isActive && styles.activeRow]}
        onLongPress={drag}
        disabled={isActive}
      >
        <View style={{ flex: 1 }}>
          <Pressable onPress={() => item.book && router.push(`/book/${item.book.id}`)}>
            <Text style={styles.bookTitle}>{item.book?.title ?? 'Unknown title'}</Text>
          </Pressable>
          <AuthorList authors={item.book?.authors ?? []} textStyle={styles.bookAuthor} />
        </View>
        {item.status === 'on_loan' ? (
          <Button title="Mark returned" variant="secondary" onPress={() => markReturned(item.id)} />
        ) : (
          <Chip label={item.status.replace('_', ' ')} />
        )}
      </Pressable>
    );
  }

  const listHeader = (
    <View>
      {items.length > 0 && (
        <View style={styles.viewToggle}>
          <Pressable
            style={[styles.toggleButton, viewMode === 'covers' && styles.toggleButtonActive]}
            onPress={() => setViewMode('covers')}
          >
            <Text style={[styles.toggleText, viewMode === 'covers' && styles.toggleTextActive]}>
              Covers
            </Text>
          </Pressable>
          <Pressable
            style={[styles.toggleButton, viewMode === 'list' && styles.toggleButtonActive]}
            onPress={() => setViewMode('list')}
          >
            <Text style={[styles.toggleText, viewMode === 'list' && styles.toggleTextActive]}>
              List
            </Text>
          </Pressable>
        </View>
      )}

      {items.length > 0 && (
        <TextInput
          style={[inputStyle, styles.searchInput]}
          placeholder="Search your shelf by title or author"
          placeholderTextColor={colors.textFaint}
          value={query}
          onChangeText={setQuery}
          autoCapitalize="none"
        />
      )}

      {requests.length > 0 && (
        <View style={styles.requestsSection}>
          <Text style={styles.sectionTitle}>Requests</Text>
          {requests.map((req) => (
            <View key={req.id} style={styles.requestRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.bookTitle}>{req.shelf_item?.book?.title ?? 'Unknown title'}</Text>
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
    </View>
  );

  const emptyComponent = !loading ? (
    <View style={styles.empty}>
      {items.length === 0 ? (
        <>
          <Text style={styles.emptyTitle}>Your shelf is empty</Text>
          <Text style={styles.emptyBody}>Add the physical books you own to get started.</Text>
        </>
      ) : (
        <Text style={styles.emptyBody}>No books match "{query}".</Text>
      )}
    </View>
  ) : null;

  return (
    <View style={styles.container}>
      {canReorder ? (
        <DraggableFlatList
          key={viewMode}
          data={filteredItems}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.list}
          ListHeaderComponent={listHeader}
          ListEmptyComponent={emptyComponent}
          onDragEnd={({ data }) => handleDragEnd(data)}
          renderItem={({ item, drag, isActive }: RenderItemParams<ShelfItemRow>) =>
            renderCard(item, drag, isActive)
          }
        />
      ) : (
        <FlatList
          key={viewMode}
          data={filteredItems}
          keyExtractor={(item) => item.id}
          numColumns={viewMode === 'covers' ? 3 : 1}
          columnWrapperStyle={viewMode === 'covers' ? styles.gridRow : undefined}
          contentContainerStyle={styles.list}
          refreshing={loading}
          onRefresh={load}
          ListHeaderComponent={listHeader}
          ListEmptyComponent={emptyComponent}
          renderItem={({ item }) => renderCard(item)}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  list: { padding: 16, flexGrow: 1 },
  viewToggle: {
    flexDirection: 'row',
    marginBottom: 16,
  },
  toggleButton: {
    flex: 1,
    paddingVertical: 10,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.border,
  },
  toggleButtonActive: {
    backgroundColor: colors.text,
    borderColor: colors.text,
  },
  toggleText: {
    fontFamily: fonts.medium,
    fontSize: 13,
    color: colors.textMuted,
  },
  toggleTextActive: {
    color: colors.background,
  },
  searchInput: {
    marginBottom: 16,
  },
  gridRow: {
    justifyContent: 'flex-start',
    gap: 12,
  },
  coverCard: {
    width: '31%',
    marginBottom: 20,
  },
  coverImage: {
    width: '100%',
    aspectRatio: 2 / 3,
    backgroundColor: colors.chipBackground,
    marginBottom: 6,
  },
  spinePlaceholder: {
    width: '100%',
    aspectRatio: 2 / 3,
    backgroundColor: colors.chipBackground,
    marginBottom: 6,
    padding: 8,
    justifyContent: 'center',
  },
  spineTitle: {
    fontFamily: fonts.semibold,
    fontSize: 12,
    color: colors.text,
    textAlign: 'center',
  },
  coverCardTitle: {
    fontFamily: fonts.medium,
    fontSize: 12,
    color: colors.text,
    marginBottom: 4,
  },
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
    backgroundColor: colors.background,
  },
  activeRow: {
    backgroundColor: colors.chipBackground,
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
});
