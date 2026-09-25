import { Link } from 'expo-router';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { prefetchBook } from '../../lib/bookDetail';
import { colors, fonts, organicCorners } from '../../lib/theme';
import { bookHref } from './links';

interface CoverThumbProps {
  book: { id: string; title: string; cover_url: string | null };
  // Width in px; the height follows at 2:3.
  width?: number;
  // Tap through to the book page. Off where the row already links it inline.
  linked?: boolean;
}

// A small book cover for feed rows and notification cards, with the title
// on a plain tile when there's no cover image.
export function CoverThumb({ book, width = 40, linked = false }: CoverThumbProps) {
  const size = { width, height: width * 1.5 };
  const cover = book.cover_url ? (
    <Image source={{ uri: book.cover_url }} style={[styles.cover, size]} resizeMode="cover" />
  ) : (
    <View style={[styles.placeholder, size, { padding: Math.max(3, width / 12) }]}>
      <Text style={[styles.placeholderText, { fontSize: Math.max(8, width / 6) }]} numberOfLines={5}>
        {book.title}
      </Text>
    </View>
  );

  if (!linked) return cover;
  return (
    <Link href={bookHref(book.id, book.title, book.cover_url)} asChild>
      <Pressable onPressIn={() => prefetchBook(book.id)} accessibilityLabel={book.title}>
        {cover}
      </Pressable>
    </Link>
  );
}

const styles = StyleSheet.create({
  cover: {
    backgroundColor: colors.chipBackground,
    ...organicCorners,
    overflow: 'hidden',
  },
  placeholder: {
    backgroundColor: colors.chipBackground,
    alignItems: 'center',
    justifyContent: 'center',
    ...organicCorners,
    overflow: 'hidden',
  },
  placeholderText: {
    fontFamily: fonts.display,
    color: colors.text,
    textAlign: 'center',
  },
});
