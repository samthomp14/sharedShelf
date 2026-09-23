import { useState } from 'react';
import { ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Button } from '../../../components/Button';
import { ToastProvider, useToast } from '../../../components/Toast';
import { ScannerModal } from '../../../components/addBook/ScannerModal';
import { addToShelf } from '../../../lib/bookLookup';
import { normalizeIsbn } from '../../../lib/isbn';
import { colors, fonts, inputStyle } from '../../../lib/theme';

// Add-book hub: scanning is the main path; search and manual entry are the
// fallbacks. Adding never navigates away — you stay here to add the next one.

export default function AddBook() {
  return (
    <ToastProvider>
      <AddBookHub />
    </ToastProvider>
  );
}

function AddBookHub() {
  const toast = useToast();
  const [scanning, setScanning] = useState(false);
  // ISBN handed over by the scanner's "Enter it manually" — prefills the
  // manual form below. `n` remounts the form even when the same ISBN is handed over twice.
  const [manualPrefill, setManualPrefill] = useState({ isbn: '', n: 0 });

  function handleScannerClose(addedCount: number) {
    setScanning(false);
    if (addedCount > 0) {
      toast.show({ message: `Added ${addedCount} ${addedCount === 1 ? 'book' : 'books'}` });
    }
  }

  return (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
      <Button title="Scan barcode" onPress={() => setScanning(true)} style={styles.scanButton} />
      <Text style={styles.explainer}>
        Scan the barcode on the back of each book — you can add several in a row.
      </Text>

      {/* SearchPanel (phase 3) */}

      <ManualForm key={manualPrefill.n} initialIsbn={manualPrefill.isbn} />

      <ScannerModal
        visible={scanning}
        onClose={handleScannerClose}
        onManualEntry={(isbn) => setManualPrefill((p) => ({ isbn, n: p.n + 1 }))}
      />
    </ScrollView>
  );
}

// TODO(phase 3): replace with ManualForm
function ManualForm({ initialIsbn }: { initialIsbn: string }) {
  const toast = useToast();
  const [isbn, setIsbn] = useState(initialIsbn);
  const [title, setTitle] = useState('');
  const [authors, setAuthors] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleAdd() {
    setError(null);

    const trimmedTitle = title.trim();
    if (!trimmedTitle) {
      setError('Title is required.');
      return;
    }

    let normalized: string | null = null;
    if (isbn.trim()) {
      normalized = normalizeIsbn(isbn);
      if (!normalized) {
        setError("That ISBN doesn't look right — check it, or leave it blank.");
        return;
      }
    }

    setLoading(true);
    try {
      const { alreadyOnShelf } = await addToShelf({
        isbn: normalized,
        title: trimmedTitle,
        authors: authors
          .split(',')
          .map((a) => a.trim())
          .filter(Boolean),
        source: 'manual',
      });
      setIsbn('');
      setTitle('');
      setAuthors('');
      toast.show({
        message: alreadyOnShelf ? `${trimmedTitle} is already on your shelf` : `Added ${trimmedTitle}`,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not add this book.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <View style={styles.manual}>
      <Text style={styles.sectionTitle}>Enter manually</Text>
      {initialIsbn !== '' && isbn === initialIsbn && (
        <Text style={styles.prefillNote}>
          We couldn't find ISBN {initialIsbn} — add its title and author below.
        </Text>
      )}

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

      <Button title="Add to shelf" variant="secondary" onPress={handleAdd} loading={loading} />
    </View>
  );
}

const styles = StyleSheet.create({
  scroll: {
    flex: 1,
    backgroundColor: colors.background,
  },
  container: {
    padding: 16,
    paddingBottom: 96, // room for the toast over the last field
  },
  scanButton: {
    paddingVertical: 16,
  },
  explainer: {
    fontFamily: fonts.regular,
    fontSize: 14,
    color: colors.textMuted,
    textAlign: 'center',
    marginTop: 10,
  },
  manual: {
    marginTop: 32,
  },
  sectionTitle: {
    fontFamily: fonts.semibold,
    fontSize: 13,
    color: colors.textMuted,
    textTransform: 'uppercase',
    marginBottom: 12,
  },
  prefillNote: {
    fontFamily: fonts.regular,
    fontSize: 14,
    color: colors.text,
    marginBottom: 12,
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
});
