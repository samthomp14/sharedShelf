import { useCallback, useState } from 'react';
import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import { Alert, Image, ScrollView, StyleSheet, Text, View } from 'react-native';
import { supabase } from '../../../lib/supabase';
import { loadBookAndCopies } from '../../../lib/bookDetail';
import { useAuth } from '../../../contexts/AuthContext';
import { Chip } from '../../../components/Chip';
import { Button } from '../../../components/Button';
import { AuthorList } from '../../../components/AuthorList';
import { colors, fonts, organicCorners } from '../../../lib/theme';

interface Book {
  id: string;
  title: string;
  authors: string[];
  cover_url: string | null;
}

interface CopyRow {
  id: string;
  status: string;
  owner_id: string;
  owner: { username: string; display_name: string | null } | null;
}

export default function BookDetail() {
  const { id, title: placeholderTitle, coverUrl: placeholderCoverUrl } = useLocalSearchParams<{
    id: string;
    title?: string;
    coverUrl?: string;
  }>();
  const { session } = useAuth();
  const ownerId = session?.user?.id ?? null;
  // The list you tapped from already had the title/cover — render with that
  // immediately instead of a blank screen while the full fetch is in flight.
  const [book, setBook] = useState<Book | null>(() =>
    id && placeholderTitle
      ? { id, title: placeholderTitle, authors: [], cover_url: placeholderCoverUrl || null }
      : null
  );
  const [copies, setCopies] = useState<CopyRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [requestingId, setRequestingId] = useState<string | null>(null);
  const [returningId, setReturningId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);

    const [bookResult, copiesResult] = await loadBookAndCopies(id);

    if (!bookResult.error && bookResult.data) {
      setBook(bookResult.data);
    } else if (bookResult.error) {
      setBook(null);
    }
    if (!copiesResult.error && copiesResult.data) {
      setCopies(copiesResult.data as unknown as CopyRow[]);
    }
    setLoading(false);
  }, [id]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  async function requestToBorrow(shelfItemId: string) {
    if (!ownerId) return;
    setRequestingId(shelfItemId);
    const { error } = await supabase
      .from('loan_requests')
      .insert({ shelf_item_id: shelfItemId, requester_id: ownerId });
    setRequestingId(null);

    if (error) {
      Alert.alert('Could not send request', error.message);
    } else {
      Alert.alert('Request sent', "They'll see it and can hand the book off in person.");
      load();
    }
  }

  async function markReturned(shelfItemId: string) {
    setReturningId(shelfItemId);
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
    setReturningId(null);
  }

  if (loading && !book) {
    return <View style={styles.container} />;
  }

  if (!book) {
    return (
      <View style={styles.container}>
        <Text style={styles.emptyBody}>Couldn't find that book.</Text>
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.header}>
        {book.cover_url ? (
          <Image source={{ uri: book.cover_url }} style={styles.cover} resizeMode="cover" />
        ) : (
          <View style={styles.spinePlaceholder}>
            <Text style={styles.spineTitle} numberOfLines={6}>
              {book.title}
            </Text>
          </View>
        )}
        <Text style={styles.title}>{book.title}</Text>
        <AuthorList authors={book.authors} textStyle={styles.authors} />
      </View>

      <Text style={styles.sectionTitle}>Copies you can see</Text>
      {copies.length === 0 ? (
        <Text style={styles.emptyBody}>
          No one in your circle has this on their shelf yet.
        </Text>
      ) : (
        copies.map((copy) => {
          const isMine = copy.owner_id === ownerId;
          return (
            <View key={copy.id} style={styles.copyRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.copyOwner}>
                  {isMine ? 'You' : copy.owner?.display_name ?? copy.owner?.username}
                </Text>
              </View>
              {!isMine && copy.status === 'available' && (
                <Button
                  title="Ask to borrow"
                  variant="secondary"
                  onPress={() => requestToBorrow(copy.id)}
                  loading={requestingId === copy.id}
                />
              )}
              {isMine && copy.status === 'on_loan' && (
                <Button
                  title="Mark returned"
                  variant="secondary"
                  onPress={() => markReturned(copy.id)}
                  loading={returningId === copy.id}
                />
              )}
              {(isMine ? copy.status !== 'on_loan' : copy.status !== 'available') && (
                <Chip label={copy.status.replace('_', ' ')} />
              )}
            </View>
          );
        })
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: 16, flexGrow: 1 },
  header: {
    alignItems: 'center',
    marginBottom: 24,
  },
  cover: {
    width: 160,
    height: 240,
    backgroundColor: colors.chipBackground,
    marginBottom: 16,
    overflow: 'hidden',
    ...organicCorners,
  },
  spinePlaceholder: {
    width: 160,
    height: 240,
    backgroundColor: colors.chipBackground,
    marginBottom: 16,
    padding: 12,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    ...organicCorners,
  },
  spineTitle: {
    fontFamily: fonts.display,
    fontSize: 14,
    color: colors.text,
    textAlign: 'center',
  },
  title: {
    fontFamily: fonts.displaySemibold,
    fontSize: 21,
    color: colors.text,
    textAlign: 'center',
    marginBottom: 4,
  },
  authors: {
    fontSize: 15,
    color: colors.textMuted,
    textAlign: 'center',
  },
  sectionTitle: {
    fontFamily: fonts.semibold,
    fontSize: 13,
    color: colors.textMuted,
    textTransform: 'uppercase',
    marginBottom: 8,
  },
  copyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  copyOwner: { fontFamily: fonts.semibold, fontSize: 16, color: colors.text },
  emptyBody: {
    fontFamily: fonts.regular,
    fontSize: 14,
    color: colors.textMuted,
  },
});
