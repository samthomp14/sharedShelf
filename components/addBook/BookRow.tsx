import { Image, StyleSheet, Text, View } from 'react-native';
import { Button } from '../Button';
import { Chip } from '../Chip';
import type { BookResultCardBook, BookResultStatus } from './BookResultCard';
import type { ExternalSource } from '../../lib/bookLookup';
import { colors, fonts, organicCorners } from '../../lib/theme';

// Compact, read-only search result: small cover, title, authors, and a
// single right-side action. The list-sized sibling of BookResultCard.

export const SOURCE_NOTES: Record<ExternalSource, string> = {
  open_library: 'From Open Library',
  google_books: 'From Google Books',
};

interface BookRowProps {
  book: BookResultCardBook;
  status: BookResultStatus;
  onAdd: () => void;
  // Small provenance line, e.g. "From Open Library".
  note?: string;
  error?: string | null;
}

export function BookRow({ book, status, onAdd, note, error }: BookRowProps) {
  return (
    <View style={styles.row}>
      {book.coverUrl ? (
        <Image source={{ uri: book.coverUrl }} style={styles.cover} resizeMode="cover" />
      ) : (
        <View style={[styles.cover, styles.coverPlaceholder]}>
          <Text style={styles.coverPlaceholderText} numberOfLines={3}>
            {book.title}
          </Text>
        </View>
      )}

      <View style={styles.details}>
        <Text style={styles.title} numberOfLines={2}>
          {book.title}
        </Text>
        {book.authors.length > 0 && (
          <Text style={styles.authors} numberOfLines={1}>
            {book.authors.join(', ')}
          </Text>
        )}
        {note && <Text style={styles.note}>{note}</Text>}
        {error && <Text style={styles.errorText}>{error}</Text>}
      </View>

      {status === 'on_shelf' ? (
        <Chip label="On your shelf" />
      ) : status === 'added' ? (
        <Text style={styles.addedText}>Added ✓</Text>
      ) : (
        <Button
          title="Add"
          variant="secondary"
          onPress={onAdd}
          loading={status === 'adding'}
          style={styles.addButton}
          accessibilityLabel={`Add ${book.title} to your shelf`}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  cover: {
    width: 44,
    height: 66,
    backgroundColor: colors.chipBackground,
    overflow: 'hidden',
    ...organicCorners,
  },
  coverPlaceholder: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: 4,
  },
  coverPlaceholderText: {
    fontFamily: fonts.display,
    fontSize: 8,
    color: colors.text,
    textAlign: 'center',
  },
  details: {
    flex: 1,
  },
  title: {
    fontFamily: fonts.display,
    fontSize: 15,
    lineHeight: 21,
    color: colors.text,
  },
  authors: {
    fontFamily: fonts.regular,
    fontSize: 13,
    color: colors.textMuted,
    marginTop: 2,
  },
  note: {
    fontFamily: fonts.regular,
    fontSize: 12,
    color: colors.textFaint,
    marginTop: 4,
  },
  errorText: {
    fontFamily: fonts.medium,
    fontSize: 13,
    color: colors.danger,
    marginTop: 4,
  },
  addButton: {
    paddingVertical: 8,
    paddingHorizontal: 16,
    // Keeps the row from jumping when the label swaps for a spinner.
    minWidth: 64,
  },
  addedText: {
    fontFamily: fonts.semibold,
    fontSize: 14,
    color: colors.success,
  },
});
