import { useState } from 'react';
import { useRouter } from 'expo-router';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import { supabase } from '../../lib/supabase';
import { Button } from '../../components/Button';
import { colors, fonts, inputStyle } from '../../lib/theme';

export default function AddBook() {
  const router = useRouter();
  const [title, setTitle] = useState('');
  const [authors, setAuthors] = useState('');
  const [isbn, setIsbn] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
          source: 'manual',
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
      <Text style={styles.label}>Title</Text>
      <TextInput
        style={inputStyle}
        placeholder="The Left Hand of Darkness"
        placeholderTextColor={colors.textFaint}
        value={title}
        onChangeText={setTitle}
      />

      <Text style={styles.label}>Author(s)</Text>
      <TextInput
        style={inputStyle}
        placeholder="Ursula K. Le Guin"
        placeholderTextColor={colors.textFaint}
        value={authors}
        onChangeText={setAuthors}
      />

      <Text style={styles.label}>ISBN (optional)</Text>
      <TextInput
        style={inputStyle}
        placeholder="9780441478125"
        placeholderTextColor={colors.textFaint}
        value={isbn}
        onChangeText={setIsbn}
        keyboardType="numbers-and-punctuation"
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
  errorText: {
    fontFamily: fonts.medium,
    color: colors.danger,
    fontSize: 14,
    marginBottom: 12,
  },
  submit: {
    marginTop: 8,
  },
});
