import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import {
  lookupIsbn,
  searchCatalog,
  searchExternal,
  type CatalogBook,
  type ExternalBook,
  type IsbnLookupResult,
} from '../../lib/bookLookup';
import { looksLikeIsbn, normalizeIsbn } from '../../lib/isbn';
import { Button } from '../Button';
import { BookResultCard } from './BookResultCard';
import { BookRow, SOURCE_NOTES } from './BookRow';
import { catalogKey, externalKey, foundBookInput, useShelfAdder } from './useShelfAdder';
import { colors, fonts, inputStyle } from '../../lib/theme';

// Search for a book to add: one box for title, author or ISBN. Our own
// catalog is always searched first; the web (Open Library / Google Books) is
// only asked on an explicit "Search online", or when an ISBN isn't ours.
// Results are read-only — one tap adds, the toast offers Undo.

const SEARCH_DEBOUNCE_MS = 300;
const MIN_QUERY_LENGTH = 2;
// Mostly digits and long enough to be an ISBN attempt, but it failed the
// checksum — worth a hint rather than a silent text search.
const ISBN_ATTEMPT = /^[\d\s-]{9,}[\dxX]$/;

export interface ManualPrefill {
  isbn: string;
  title: string;
  // The ISBN was already looked up and nothing was found (scanner or search);
  // the form shows it locked instead of looking it up again.
  isbnNotFound: boolean;
}

interface SearchPanelProps {
  onManualEntry: (prefill: ManualPrefill) => void;
}

type IsbnState =
  | { kind: 'loading'; isbn: string }
  | { kind: 'result'; isbn: string; result: IsbnLookupResult }
  | { kind: 'error'; isbn: string };

interface ListState<T> {
  q: string;
  books: T[];
  status: 'loading' | 'done' | 'error';
}

export function SearchPanel({ onManualEntry }: SearchPanelProps) {
  const adder = useShelfAdder();
  const [query, setQuery] = useState('');
  const [isbnState, setIsbnState] = useState<IsbnState | null>(null);
  const [catalog, setCatalog] = useState<ListState<CatalogBook> | null>(null);
  const [external, setExternal] = useState<ListState<ExternalBook> | null>(null);
  // Bumped per search / per online search, so a slow response for older
  // text can't overwrite newer results.
  const requestIdRef = useRef(0);
  const externalIdRef = useRef(0);
  // What the last search actually ran for, so the debounce doesn't repeat a
  // search that "submit" already started.
  const lastRunRef = useRef('');

  function resetAll() {
    requestIdRef.current++;
    externalIdRef.current++;
    lastRunRef.current = '';
    setIsbnState(null);
    setCatalog(null);
    setExternal(null);
    adder.reset();
  }

  async function run(q: string) {
    lastRunRef.current = q;
    const requestId = ++requestIdRef.current;
    externalIdRef.current++;
    setExternal(null);

    if (looksLikeIsbn(q)) {
      const isbn = normalizeIsbn(q)!;
      setCatalog(null);
      setIsbnState({ kind: 'loading', isbn });
      try {
        const result = await lookupIsbn(isbn);
        if (requestId !== requestIdRef.current) return;
        setIsbnState({ kind: 'result', isbn, result });
      } catch {
        if (requestId !== requestIdRef.current) return;
        setIsbnState({ kind: 'error', isbn });
      }
      return;
    }

    setIsbnState(null);
    if (q.length < MIN_QUERY_LENGTH) {
      setCatalog(null);
      return;
    }

    // Keep the previous results on screen while the new ones load — less
    // flicker while typing.
    setCatalog((prev) => ({ q, books: prev?.books ?? [], status: 'loading' }));
    try {
      const books = await searchCatalog(q);
      if (requestId !== requestIdRef.current) return;
      setCatalog({ q, books, status: 'done' });
    } catch {
      if (requestId !== requestIdRef.current) return;
      setCatalog({ q, books: [], status: 'error' });
    }
  }

  async function runExternal(q: string) {
    const requestId = ++externalIdRef.current;
    setExternal({ q, books: [], status: 'loading' });
    try {
      const books = await searchExternal(q);
      if (requestId !== externalIdRef.current) return;
      setExternal({ q, books, status: 'done' });
    } catch {
      if (requestId !== externalIdRef.current) return;
      setExternal({ q, books: [], status: 'error' });
    }
  }

  useEffect(() => {
    const q = query.trim();
    if (!q) {
      resetAll();
      return;
    }
    const timer = setTimeout(() => {
      if (q !== lastRunRef.current) run(q);
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query]);

  function addCatalog(book: CatalogBook) {
    adder.add(catalogKey(book), foundBookInput({ kind: 'catalog', book }), book.title);
  }

  function addExternal(book: ExternalBook) {
    adder.add(externalKey(book), foundBookInput({ kind: 'external', book }), book.title);
  }

  const trimmed = query.trim();
  const inputIsbn = looksLikeIsbn(trimmed) ? normalizeIsbn(trimmed) : null;
  const isbnNotFound =
    isbnState?.kind === 'result' && isbnState.result.kind === 'not_found' && isbnState.isbn === inputIsbn;

  function handleManualEntry() {
    onManualEntry({
      isbn: inputIsbn ?? '',
      title: inputIsbn ? '' : trimmed,
      isbnNotFound,
    });
  }

  function renderIsbn() {
    if (!isbnState) return null;
    switch (isbnState.kind) {
      case 'loading':
        return (
          <View style={styles.statusRow}>
            <ActivityIndicator color={colors.text} />
            <Text style={styles.mutedText}>Looking up ISBN {isbnState.isbn}…</Text>
          </View>
        );
      case 'error':
        return (
          <View style={styles.block}>
            <Text style={styles.errorText}>Couldn't look up that ISBN. Check your connection and try again.</Text>
            <Button title="Retry" variant="secondary" onPress={() => run(trimmed)} style={styles.inlineButton} />
          </View>
        );
      case 'result': {
        const { result, isbn } = isbnState;
        if (result.kind === 'not_found') {
          return (
            <View style={styles.block}>
              <Text style={styles.bodyText}>We couldn't find ISBN {isbn}.</Text>
              <Button
                title="Enter it manually"
                variant="secondary"
                onPress={() => onManualEntry({ isbn, title: '', isbnNotFound: true })}
                style={styles.inlineButton}
              />
            </View>
          );
        }
        if (result.kind === 'catalog') {
          const key = catalogKey(result.book);
          return (
            <BookResultCard
              book={result.book}
              status={adder.statusOf(key, result.book.onMyShelf)}
              error={adder.errorOf(key)}
              onAdd={() => addCatalog(result.book)}
            />
          );
        }
        const key = externalKey(result.book);
        return (
          <BookResultCard
            book={result.book}
            status={adder.statusOf(key)}
            error={adder.errorOf(key)}
            note={SOURCE_NOTES[result.book.source]}
            onAdd={() => addExternal(result.book)}
          />
        );
      }
    }
  }

  function renderCatalog() {
    if (!catalog) return null;
    const firstLoad = catalog.status === 'loading' && catalog.books.length === 0;
    return (
      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>In sharedShelf</Text>
          {catalog.status === 'loading' && <ActivityIndicator size="small" color={colors.textMuted} />}
        </View>

        {catalog.status === 'error' && (
          <View style={styles.block}>
            <Text style={styles.errorText}>Couldn't search right now. Check your connection and try again.</Text>
            <Button title="Retry" variant="secondary" onPress={() => run(catalog.q)} style={styles.inlineButton} />
          </View>
        )}
        {catalog.status === 'done' && catalog.books.length === 0 && (
          <Text style={styles.mutedText}>No matches in sharedShelf yet.</Text>
        )}
        {!firstLoad &&
          catalog.books.map((book) => {
            const key = catalogKey(book);
            return (
              <BookRow
                key={key}
                book={book}
                status={adder.statusOf(key, book.onMyShelf)}
                error={adder.errorOf(key)}
                onAdd={() => addCatalog(book)}
              />
            );
          })}

        {/* Only offer the web once our own catalog has answered. */}
        {catalog.status !== 'loading' && !external && (
          <Button
            title="Not here? Search online"
            variant="secondary"
            onPress={() => runExternal(catalog.q)}
            style={styles.onlineButton}
          />
        )}
      </View>
    );
  }

  function renderExternal() {
    if (!external) return null;
    return (
      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>From the web</Text>
          {external.status === 'loading' && <ActivityIndicator size="small" color={colors.textMuted} />}
        </View>

        {external.status === 'loading' && <Text style={styles.mutedText}>Searching online…</Text>}
        {external.status === 'error' && (
          <View style={styles.block}>
            <Text style={styles.errorText}>Couldn't reach the online catalogs. Try again in a moment.</Text>
            <Button
              title="Retry"
              variant="secondary"
              onPress={() => runExternal(external.q)}
              style={styles.inlineButton}
            />
          </View>
        )}
        {external.status === 'done' && external.books.length === 0 && (
          <Text style={styles.mutedText}>Nothing new found online either.</Text>
        )}
        {external.books.map((book) => {
          const key = externalKey(book);
          return (
            <BookRow
              key={key}
              book={book}
              status={adder.statusOf(key)}
              error={adder.errorOf(key)}
              note={SOURCE_NOTES[book.source]}
              onAdd={() => addExternal(book)}
            />
          );
        })}
      </View>
    );
  }

  const badIsbnAttempt = !inputIsbn && ISBN_ATTEMPT.test(trimmed);

  return (
    <View>
      <View style={styles.inputWrap}>
        <TextInput
          style={[inputStyle, styles.input]}
          placeholder="Title, author or ISBN"
          placeholderTextColor={colors.textFaint}
          value={query}
          onChangeText={setQuery}
          onSubmitEditing={() => trimmed && run(trimmed)}
          enterKeyHint="search"
          autoCorrect={false}
          autoCapitalize="none"
          accessibilityLabel="Search by title, author or ISBN"
        />
        {query !== '' && (
          <Pressable
            style={styles.clearButton}
            onPress={() => setQuery('')}
            hitSlop={8}
            accessibilityLabel="Clear search"
          >
            <Text style={styles.clearText}>✕</Text>
          </Pressable>
        )}
      </View>

      {badIsbnAttempt && (
        <Text style={styles.hintText}>That doesn't look like a valid ISBN — check the digits.</Text>
      )}

      {isbnState && <View style={styles.isbnResult}>{renderIsbn()}</View>}
      {renderCatalog()}
      {renderExternal()}

      {trimmed !== '' && !isbnNotFound && (
        <Pressable onPress={handleManualEntry} style={styles.footerLink} hitSlop={6}>
          <Text style={styles.footerText}>
            Still can't find it? <Text style={styles.footerLinkText}>Enter manually</Text>
          </Text>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  inputWrap: {
    justifyContent: 'center',
  },
  input: {
    paddingRight: 40, // room for the clear button
  },
  clearButton: {
    position: 'absolute',
    right: 12,
    // Centered on the input, which carries a 12px bottom margin.
    top: 0,
    bottom: 12,
    justifyContent: 'center',
  },
  clearText: {
    fontFamily: fonts.medium,
    fontSize: 16,
    color: colors.textFaint,
  },
  hintText: {
    fontFamily: fonts.regular,
    fontSize: 13,
    color: colors.textMuted,
    marginBottom: 12,
  },
  isbnResult: {
    marginTop: 4,
  },
  section: {
    marginTop: 8,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 4,
  },
  sectionTitle: {
    fontFamily: fonts.semibold,
    fontSize: 13,
    color: colors.textMuted,
    textTransform: 'uppercase',
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 8,
  },
  block: {
    gap: 10,
    paddingVertical: 8,
  },
  bodyText: {
    fontFamily: fonts.regular,
    fontSize: 15,
    color: colors.text,
  },
  mutedText: {
    fontFamily: fonts.regular,
    fontSize: 14,
    color: colors.textMuted,
    paddingVertical: 8,
  },
  errorText: {
    fontFamily: fonts.medium,
    fontSize: 14,
    color: colors.danger,
  },
  inlineButton: {
    alignSelf: 'flex-start',
  },
  onlineButton: {
    marginTop: 14,
  },
  footerLink: {
    alignSelf: 'center',
    marginTop: 20,
    paddingVertical: 4,
  },
  footerText: {
    fontFamily: fonts.regular,
    fontSize: 14,
    color: colors.textMuted,
  },
  footerLinkText: {
    fontFamily: fonts.semibold,
    color: colors.text,
    textDecorationLine: 'underline',
  },
});
