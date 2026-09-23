import { useCallback, useEffect, useRef, useState } from 'react';
import { useFocusEffect, useRouter } from 'expo-router';
import { Alert, Image, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { supabase } from '../../../lib/supabase';
import { prefetchBook } from '../../../lib/bookDetail';
import { profileHref } from '../../../lib/profileHref';
import { useAuth } from '../../../contexts/AuthContext';
import { Button } from '../../../components/Button';
import { colors, fonts, inputStyle, radius } from '../../../lib/theme';

const SEARCH_DEBOUNCE_MS = 300;
const MIN_QUERY_LENGTH = 2;

interface PersonResult {
  id: string;
  username: string;
  display_name: string | null;
  avatar_url: string | null;
}

interface BookResult {
  id: string;
  title: string;
  authors: string[];
  cover_url: string | null;
}

export default function Search() {
  const router = useRouter();
  const { session } = useAuth();
  const uid = session?.user?.id ?? null;
  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [searched, setSearched] = useState(false);
  const [people, setPeople] = useState<PersonResult[]>([]);
  const [books, setBooks] = useState<BookResult[]>([]);
  const [authors, setAuthors] = useState<string[]>([]);
  const [sendingId, setSendingId] = useState<string | null>(null);
  const searchIdRef = useRef(0);

  function reset() {
    searchIdRef.current++; // invalidate any in-flight search so it can't overwrite this reset
    setQuery('');
    setSearching(false);
    setSearched(false);
    setPeople([]);
    setBooks([]);
    setAuthors([]);
  }

  // Tab screens stay mounted when you switch tabs, so clear stale results
  // (and cancel any in-flight search) when the user navigates away.
  useFocusEffect(
    useCallback(() => {
      return () => reset();
    }, [])
  );

  async function search(q: string) {
    if (q.length < MIN_QUERY_LENGTH) {
      searchIdRef.current++;
      setSearching(false);
      setSearched(false);
      setPeople([]);
      setBooks([]);
      setAuthors([]);
      return;
    }

    const requestId = ++searchIdRef.current;
    setSearching(true);
    setSearched(true);

    const [peopleRes, booksRes, authorsRes] = await Promise.all([
      supabase
        .from('profiles')
        .select('id, username, display_name, avatar_url')
        .or(`username.ilike.%${q}%,display_name.ilike.%${q}%`)
        .neq('id', uid ?? '')
        .limit(15),
      supabase.from('books').select('id, title, authors, cover_url').ilike('title', `%${q}%`).limit(15),
      supabase.from('book_authors').select('author').ilike('author', `%${q}%`).limit(50),
    ]);

    // A newer keystroke already started another search — drop this stale response.
    if (requestId !== searchIdRef.current) return;

    setPeople(peopleRes.data ?? []);
    setBooks(booksRes.data ?? []);
    setAuthors(Array.from(new Set(authorsRes.data?.map((row) => row.author) ?? [])).slice(0, 15));
    setSearching(false);
  }

  useEffect(() => {
    const timer = setTimeout(() => search(query.trim()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query]);

  async function sendRequest(target: PersonResult) {
    if (!uid) return;
    setSendingId(target.id);

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

  const hasResults = people.length > 0 || books.length > 0 || authors.length > 0;

  return (
    <View style={styles.container}>
      <View style={styles.searchRow}>
        <TextInput
          style={[inputStyle, styles.searchInput]}
          placeholder="Search people, books, and authors"
          placeholderTextColor={colors.textFaint}
          value={query}
          onChangeText={setQuery}
          autoCapitalize="none"
          onSubmitEditing={() => search(query.trim())}
          returnKeyType="search"
        />
        <Button title="Search" variant="secondary" onPress={() => search(query.trim())} loading={searching} />
      </View>

      <ScrollView style={styles.resultsScroll} contentContainerStyle={styles.results}>
        {!searched && (
          <Text style={styles.emptyText}>
            Search for a username, book title, or author.
          </Text>
        )}
        {searched && !searching && !hasResults && (
          <Text style={styles.emptyText}>No matches for "{query}".</Text>
        )}

        {people.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>People</Text>
            {people.map((item) => (
              <View key={item.id} style={styles.row}>
                <Pressable
                  style={{ flex: 1 }}
                  onPress={() => router.push(profileHref(item.username, item.display_name, item.avatar_url))}
                >
                  <Text style={styles.name}>{item.display_name ?? item.username}</Text>
                  <Text style={styles.subtext}>@{item.username}</Text>
                </Pressable>
                <Button
                  title="Add"
                  variant="secondary"
                  onPress={() => sendRequest(item)}
                  loading={sendingId === item.id}
                />
              </View>
            ))}
          </View>
        )}

        {books.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Books</Text>
            {books.map((item) => (
              <Pressable
                key={item.id}
                style={styles.bookRow}
                onPressIn={() => prefetchBook(item.id)}
                onPress={() =>
                  router.push({
                    pathname: '/book/[id]',
                    params: { id: item.id, title: item.title, coverUrl: item.cover_url ?? '' },
                  })
                }
              >
                {item.cover_url ? (
                  <Image source={{ uri: item.cover_url }} style={styles.bookCover} resizeMode="cover" />
                ) : (
                  <View style={styles.bookSpine}>
                    <Text style={styles.bookSpineText} numberOfLines={3}>
                      {item.title}
                    </Text>
                  </View>
                )}
                <View style={{ flex: 1 }}>
                  <Text style={styles.name}>{item.title}</Text>
                  <Text style={styles.subtext}>{item.authors.join(', ')}</Text>
                </View>
              </Pressable>
            ))}
          </View>
        )}

        {authors.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Authors</Text>
            {authors.map((author) => (
              <Pressable
                key={author}
                style={styles.row}
                onPress={() => router.push(`/author/${encodeURIComponent(author)}`)}
              >
                <Text style={styles.name}>{author}</Text>
              </Pressable>
            ))}
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background, padding: 16 },
  searchRow: { flexDirection: 'row', gap: 8, alignItems: 'flex-start' },
  searchInput: { flex: 1, marginBottom: 0 },
  // Full-bleed scroll area with the padding inside it: a ScrollView clips at its
  // edges, which sliced the shadow off the right-aligned "Add" buttons.
  resultsScroll: { marginHorizontal: -16 },
  results: { paddingTop: 16, paddingHorizontal: 16, flexGrow: 1 },
  section: { marginBottom: 20 },
  sectionTitle: {
    fontFamily: fonts.semibold,
    fontSize: 13,
    color: colors.textMuted,
    textTransform: 'uppercase',
    marginBottom: 8,
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
  bookRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  bookCover: {
    width: 44,
    height: 66,
    backgroundColor: colors.chipBackground,
    borderRadius: radius.sm,
    overflow: 'hidden',
  },
  bookSpine: {
    width: 44,
    height: 66,
    backgroundColor: colors.chipBackground,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 4,
    borderRadius: radius.sm,
    overflow: 'hidden',
  },
  bookSpineText: {
    fontFamily: fonts.display,
    fontSize: 9,
    color: colors.text,
    textAlign: 'center',
  },
  name: { fontFamily: fonts.semibold, fontSize: 16, color: colors.text },
  subtext: { fontFamily: fonts.regular, fontSize: 14, color: colors.textMuted, marginTop: 2 },
  emptyText: {
    fontFamily: fonts.regular,
    fontSize: 14,
    color: colors.textMuted,
    textAlign: 'center',
    marginTop: 40,
  },
});
