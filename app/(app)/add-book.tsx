import { useState } from 'react';
import { useRouter } from 'expo-router';
import { Image, StyleSheet, Text, TextInput, View } from 'react-native';
import { supabase } from '../../lib/supabase';
import { Button } from '../../components/Button';
import { colors, fonts, inputStyle } from '../../lib/theme';

interface OpenLibraryBook {
  title?: string;
  authors?: { name: string }[];
  cover?: { small?: string; medium?: string; large?: string };
}

export default function AddBook() {
  const router = useRouter();
  const [isbn, setIsbn] = useState('');
  const [title, setTitle] = useState('');
  const [authors, setAuthors] = useState('');
  const [coverUrl, setCoverUrl] = useState<string | null>(null);
  const [source, setSource] = useState<'manual' | 'open_library'>('manual');
  const [lookingUp, setLookingUp] = useState(false);
  const [lookupMessage, setLookupMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function lookupIsbn() {
    const trimmed = isbn.trim();
    if (!trimmed) return;

    setLookupMessage(null);
    setLookingUp(true);

    try {
      const res = await fetch(
        `https://openlibrary.org/api/books?bibkeys=ISBN:${encodeURIComponent(trimmed)}&jscmd=data&format=json`
      );
      const json: Record<string, OpenLibraryBook> = await res.json();
      const found = json[`ISBN:${trimmed}`];

      if (!found) {
        setLookupMessage("Couldn't find that ISBN — enter the details manually below.");
      } else {
        setTitle(found.title ?? '');
        setAuthors((found.authors ?? []).map((a) => a.name).join(', '));
        setCoverUrl(found.cover?.medium ?? found.cover?.small ?? null);
        setSource('open_library');
        setLookupMessage(`Found: ${found.title}`);
      }
    } catch {
      setLookupMessage('Lookup failed — check your connection, or enter details manually.');
    } finally {
      setLookingUp(false);
    }
  }

  async function handleAdd() {
    setError(null);

    if (!title.trim()) {
      setError('Title is required.');
      return;
    }

    setLoading(true);

    const { data: userData } = await supabase.auth.getUser();
    const uid = userData.user?.id;
    if (!uid) {
      setError('You need to be signed in.');
      setLoading(false);
      return;
    }

    const authorsArray = authors
      .split(',')
      .map((a) => a.trim())
      .filter(Boolean);
    const trimmedIsbn = isbn.trim() || null;

    let bookId: string | null = null;

    if (trimmedIsbn) {
      const { data: existingBook } = await supabase
        .from('books')
        .select('id')
        .eq('isbn', trimmedIsbn)
        .maybeSingle();
      if (existingBook) {
        bookId = existingBook.id;
      }
    }

    if (!bookId) {
      const { data: newBook, error: bookError } = await supabase
        .from('books')
        .insert({
          title: title.trim(),
          authors: authorsArray,
          isbn: trimmedIsbn,
          cover_url: coverUrl,
          source,
        })
        .select('id')
        .single();

      if (bookError) {
        setError(bookError.message);
        setLoading(false);
        return;
      }
      bookId = newBook.id;
    }

    const { error: shelfError } = await supabase
      .from('shelf_items')
      .insert({ owner_id: uid, book_id: bookId });

    setLoading(false);

    if (shelfError) {
      setError(shelfError.message);
      return;
    }

    router.back();
  }

  return (
    <View style={styles.container}>
      <Text style={styles.label}>ISBN</Text>
      <View style={styles.isbnRow}>
        <TextInput
          style={[inputStyle, styles.isbnInput]}
          placeholder="9780441478125"
          placeholderTextColor={colors.textFaint}
          value={isbn}
          onChangeText={(text) => {
            setIsbn(text);
            setLookupMessage(null);
          }}
          keyboardType="numbers-and-punctuation"
          onSubmitEditing={lookupIsbn}
          returnKeyType="search"
        />
        <Button title="Look up" variant="secondary" onPress={lookupIsbn} loading={lookingUp} />
      </View>
      {lookupMessage && <Text style={styles.lookupMessage}>{lookupMessage}</Text>}

      {coverUrl && <Image source={{ uri: coverUrl }} style={styles.cover} resizeMode="contain" />}

      <Text style={styles.label}>Title</Text>
      <TextInput
        style={inputStyle}
        placeholder="The Left Hand of Darkness"
        placeholderTextColor={colors.textFaint}
        value={title}
        onChangeText={(text) => {
          setTitle(text);
          setSource('manual');
        }}
      />

      <Text style={styles.label}>Author(s)</Text>
      <TextInput
        style={inputStyle}
        placeholder="Ursula K. Le Guin"
        placeholderTextColor={colors.textFaint}
        value={authors}
        onChangeText={(text) => {
          setAuthors(text);
          setSource('manual');
        }}
      />

      {error && <Text style={styles.errorText}>{error}</Text>}

      <Button title="Add to shelf" onPress={handleAdd} loading={loading} style={styles.submit} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
    padding: 16,
  },
  label: {
    fontFamily: fonts.semibold,
    fontSize: 13,
    color: colors.textMuted,
    marginBottom: 6,
  },
  isbnRow: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'flex-start',
  },
  isbnInput: {
    flex: 1,
    marginBottom: 0,
  },
  lookupMessage: {
    fontFamily: fonts.regular,
    fontSize: 13,
    color: colors.textMuted,
    marginTop: 8,
  },
  cover: {
    width: 80,
    height: 120,
    marginTop: 12,
    marginBottom: 4,
    backgroundColor: colors.chipBackground,
  },
  errorText: {
    fontFamily: fonts.medium,
    color: colors.danger,
    fontSize: 14,
    marginBottom: 12,
  },
  submit: {
    marginTop: 20,
  },
});
