import { useCallback, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { supabase } from '../../../lib/supabase';
import { personName, type Person } from '../../../lib/loans';
import { useAuth } from '../../../contexts/AuthContext';
import { Avatar } from '../../../components/Avatar';
import { InstallBanner } from '../../../components/InstallBanner';
import { RefreshControl } from '../../../components/RefreshControl';
import { ShareAppButton } from '../../../components/ShareAppButton';
import { CoverThumb } from '../../../components/activity/CoverThumb';
import { BookLink, PersonLink } from '../../../components/activity/links';
import { useRefetchOnVisible, useRefreshing } from '../../../lib/refresh';
import { timeAgo } from '../../../lib/time';
import { colors, fonts } from '../../../lib/theme';

// Friends' activity: what they've added to their shelves. Anything about you
// (requests, your loan history, new friendships) lives in Notifications,
// behind the header bell.

interface FeedBook {
  id: string;
  title: string;
  cover_url: string | null;
}

interface FeedEvent {
  key: string;
  timestamp: string; // the newest add
  kind: 'shelf_add';
  actor: Person;
  books: FeedBook[]; // newest first; several = a run of adds grouped into one row
}

// Adds by the same friend, back to back in the feed and within this long of
// their newest one, collapse into one "added 3 books" row.
const GROUP_WINDOW_MS = 24 * 60 * 60 * 1000;
const MAX_GROUP_COVERS = 4;

// Folds consecutive shelf adds by the same person into one event. Expects
// the events newest first, one book each.
function groupShelfAdds(events: FeedEvent[]): FeedEvent[] {
  const grouped: FeedEvent[] = [];
  for (const event of events) {
    const prev = grouped[grouped.length - 1];
    if (
      prev &&
      prev.actor.id === event.actor.id &&
      Date.parse(prev.timestamp) - Date.parse(event.timestamp) <= GROUP_WINDOW_MS
    ) {
      prev.books.push(...event.books);
    } else {
      grouped.push(event);
    }
  }
  return grouped;
}

export default function Activity() {
  const { session } = useAuth();
  const uid = session?.user?.id ?? null;
  const [events, setEvents] = useState<FeedEvent[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!uid) {
      setLoading(false);
      return;
    }
    setLoading(true);

    const shelfAddRes = await supabase
      .from('shelf_items')
      .select(
        'id, created_at, owner:profiles(id, username, display_name, avatar_url), book:books(id, title, cover_url)'
      )
      .neq('owner_id', uid)
      .order('created_at', { ascending: false })
      .limit(60);

    const merged: FeedEvent[] = [];

    if (!shelfAddRes.error && shelfAddRes.data) {
      for (const row of shelfAddRes.data as any[]) {
        if (!row.book || !row.owner) continue;
        merged.push({
          key: `shelf-${row.id}`,
          timestamp: row.created_at,
          kind: 'shelf_add',
          actor: row.owner,
          books: [row.book],
        });
      }
    }

    setEvents(groupShelfAdds(merged).slice(0, 40));
    setLoading(false);
  }, [uid]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );
  const { refreshing, onRefresh } = useRefreshing(load);
  useRefetchOnVisible(load);

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
    >
      <InstallBanner />
      {events.length === 0 && !loading ? (
        <View style={styles.empty}>
          <Text style={styles.emptyTitle}>Nothing here yet</Text>
          <Text style={styles.emptyBody}>Add friends and books to start seeing activity.</Text>
          <ShareAppButton style={styles.emptyInvite} />
        </View>
      ) : (
        events.map((event, i) => {
          const person = event.actor;
          const single = event.books.length === 1 ? event.books[0] : null;

          return (
            <View key={event.key} style={[styles.row, i === events.length - 1 && styles.lastRow]}>
              <Avatar avatarUrl={person.avatar_url} label={personName(person)} size={40} />
              <View style={styles.rowMiddle}>
                <Text style={styles.eventText}>
                  {single ? (
                    <>
                      <PersonLink person={event.actor} /> added <BookLink book={single} /> to their shelf
                    </>
                  ) : (
                    <>
                      <PersonLink person={event.actor} /> added {event.books.length} books to their shelf
                    </>
                  )}
                </Text>
                <Text style={styles.timestamp}>{timeAgo(event.timestamp)}</Text>
                {!single && (
                  <View style={styles.coverRow}>
                    {event.books.slice(0, MAX_GROUP_COVERS).map((book, j) => (
                      <CoverThumb key={`${book.id}-${j}`} book={book} width={44} linked />
                    ))}
                  </View>
                )}
              </View>
              {single && <CoverThumb book={single} linked />}
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
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  lastRow: {
    borderBottomWidth: 0,
  },
  rowMiddle: {
    flex: 1,
  },
  eventText: {
    fontFamily: fonts.regular,
    fontSize: 14,
    lineHeight: 20,
    color: colors.text,
  },
  timestamp: {
    fontFamily: fonts.regular,
    fontSize: 12,
    color: colors.textFaint,
    marginTop: 3,
  },
  coverRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 8,
  },
  empty: { alignItems: 'center', justifyContent: 'center', paddingTop: 60 },
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
