import { useCallback, useRef, useState } from 'react';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { FlatList, Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { supabase } from '../../../lib/supabase';
import { prefetchBook } from '../../../lib/bookDetail';
import { Skeleton } from '../../../components/Skeleton';
import { RefreshControl } from '../../../components/RefreshControl';
import { useRefetchOnVisible, useRefreshing } from '../../../lib/refresh';
import { colors, fonts, organicCorners } from '../../../lib/theme';

interface Book {
  id: string;
  title: string;
  cover_url: string | null;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Same as SQL author_name_key, minus the name tidying: lowercased, letters
// and digits only.
function nameKey(name: string) {
  return name.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
}

function safeDecode(s: string) {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

// Old links (push notifications, shared URLs) are /author/<name>. Find the
// author by exact name, then by matching spelling.
async function findAuthorByName(name: string): Promise<{ id: string; name: string } | null> {
  const exact = await supabase.from('authors').select('id, name').eq('name', name).limit(1);
  if (exact.data?.[0]) return exact.data[0];
  const key = nameKey(name);
  if (!key) return null;
  const byKey = await supabase.from('authors').select('id, name').eq('name_key', key).limit(1);
  return byKey.data?.[0] ?? null;
}

export default function AuthorBooks() {
  const { id: idParam, name: nameParam } = useLocalSearchParams<{ id: string; name?: string }>();
  const router = useRouter();
  const [books, setBooks] = useState<Book[]>([]);
  const [loading, setLoading] = useState(true);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [notFound, setNotFound] = useState(false);

  const routeId = idParam ? safeDecode(idParam) : '';
  // The list you tapped from already had the name; a legacy link is the name.
  const [authorName, setAuthorName] = useState(
    nameParam || (UUID_RE.test(routeId) ? '' : routeId)
  );
  // Resolved once per route (refs, so resolving doesn't re-run load).
  const resolved = useRef<{ route: string; id: string; name: boolean } | null>(null);

  const load = useCallback(async () => {
    if (!routeId) return;
    setLoading(true);
    if (resolved.current?.route !== routeId) {
      if (UUID_RE.test(routeId)) {
        resolved.current = { route: routeId, id: routeId, name: !!nameParam };
      } else {
        const found = await findAuthorByName(routeId);
        if (!found) {
          setNotFound(true);
          setLoading(false);
          setHasLoaded(true);
          return;
        }
        resolved.current = { route: routeId, id: found.id, name: true };
        setAuthorName(found.name);
      }
    }
    const author = resolved.current;

    // One row per work, only books with a copy you can see (sorted by title).
    const [booksRes, authorRes] = await Promise.all([
      supabase.rpc('circle_author_books', { p_author_id: author.id }),
      author.name ? null : supabase.from('authors').select('name').eq('id', author.id).maybeSingle(),
    ]);

    if (authorRes?.data) {
      author.name = true;
      setAuthorName(authorRes.data.name);
    } else if (authorRes && !authorRes.error) {
      setNotFound(true);
    }
    if (!booksRes.error && booksRes.data) {
      setBooks(booksRes.data);
    }
    setLoading(false);
    setHasLoaded(true);
  }, [routeId, nameParam]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );
  const { refreshing, onRefresh } = useRefreshing(load);
  useRefetchOnVisible(load);

  if (notFound) {
    return (
      <View style={styles.container}>
        <Text style={styles.emptyBody}>Couldn't find that author.</Text>
      </View>
    );
  }

  // Name is usually known from the route — render it immediately, and
  // skeleton the grid until the first fetch for this author lands.
  if (!hasLoaded) {
    return (
      <View style={styles.container}>
        <View style={styles.list}>
          {authorName ? (
            <Text style={styles.title}>{authorName}</Text>
          ) : (
            <Skeleton width="50%" height={21} style={styles.title} />
          )}
          <View style={styles.grid}>
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} width="31%" style={styles.gridTile} />
            ))}
          </View>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <FlatList
        data={books}
        keyExtractor={(item) => item.id}
        numColumns={3}
        columnWrapperStyle={styles.gridRow}
        contentContainerStyle={styles.list}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        ListHeaderComponent={<Text style={styles.title}>{authorName}</Text>}
        ListEmptyComponent={
          !loading ? <Text style={styles.emptyBody}>No books by this author yet.</Text> : null
        }
        renderItem={({ item }) => (
          <Pressable
            style={styles.card}
            onPressIn={() => prefetchBook(item.id)}
            onPress={() =>
              router.push({
                pathname: '/book/[id]',
                params: { id: item.id, title: item.title, coverUrl: item.cover_url ?? '' },
              })
            }
          >
            {item.cover_url ? (
              <Image source={{ uri: item.cover_url }} style={styles.cover} resizeMode="cover" />
            ) : (
              <View style={styles.spinePlaceholder}>
                <Text style={styles.spineTitle} numberOfLines={5}>
                  {item.title}
                </Text>
              </View>
            )}
            <Text style={styles.cardTitle} numberOfLines={2}>
              {item.title}
            </Text>
          </Pressable>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  list: { padding: 16, flexGrow: 1 },
  title: {
    fontFamily: fonts.displaySemibold,
    fontSize: 21,
    color: colors.text,
    marginBottom: 16,
  },
  gridRow: {
    justifyContent: 'flex-start',
    gap: 12,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'flex-start',
    gap: 12,
  },
  gridTile: {
    aspectRatio: 2 / 3,
    marginBottom: 20,
    ...organicCorners,
  },
  card: {
    width: '31%',
    marginBottom: 20,
  },
  cover: {
    width: '100%',
    aspectRatio: 2 / 3,
    backgroundColor: colors.chipBackground,
    marginBottom: 6,
    overflow: 'hidden',
    ...organicCorners,
  },
  spinePlaceholder: {
    width: '100%',
    aspectRatio: 2 / 3,
    backgroundColor: colors.chipBackground,
    marginBottom: 6,
    padding: 8,
    justifyContent: 'center',
    overflow: 'hidden',
    ...organicCorners,
  },
  spineTitle: {
    fontFamily: fonts.display,
    fontSize: 12,
    color: colors.text,
    textAlign: 'center',
  },
  cardTitle: {
    fontFamily: fonts.medium,
    fontSize: 12,
    color: colors.text,
  },
  emptyBody: {
    fontFamily: fonts.regular,
    fontSize: 14,
    color: colors.textMuted,
    textAlign: 'center',
    paddingTop: 40,
  },
});
