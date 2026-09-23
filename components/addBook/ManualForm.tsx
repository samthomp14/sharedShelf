import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { lookupIsbn, searchCatalog, type CatalogBook, type ExternalBook } from '../../lib/bookLookup';
import { normalizeIsbn } from '../../lib/isbn';
import { Button } from '../Button';
import { BookResultCard } from './BookResultCard';
import { BookRow, SOURCE_NOTES } from './BookRow';
import { catalogKey, externalKey, foundBookInput, useShelfAdder } from './useShelfAdder';
import { colors, fonts, inputStyle, radius } from '../../lib/theme';

// The one place people type book details. Before creating a new book it
// checks we don't already know it — by ISBN if one's given, otherwise by a
// close title match in our catalog — and offers the existing book instead.

interface ManualFormProps {
  initialIsbn?: string;
  // The ISBN was already looked up and not found (scanner / search): show it
  // locked with a note, and don't look it up again on submit.
  isbnNotFound?: boolean;
  initialTitle?: string;
}

type FoundBook =
  | { kind: 'catalog'; book: CatalogBook }
  | { kind: 'external'; book: ExternalBook };

// What the person typed, validated, ready to add as a new book.
interface Draft {
  isbn: string | null;
  isbnLocked: boolean;
  title: string;
  authors: string[];
}

type Stage =
  | { kind: 'form' }
  // Their ISBN matched a book we (or the web) already know.
  | { kind: 'known'; found: FoundBook; draft: Draft }
  // No ISBN, but the title closely matches books in our catalog.
  | { kind: 'matches'; books: CatalogBook[]; draft: Draft };

const MANUAL_KEY = 'manual';

function simplifyTitle(s: string): string {
  return s
    .toLowerCase()
    .replace(/[.,:;!?'"’“”()]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function isCloseTitle(a: string, b: string): boolean {
  const x = simplifyTitle(a);
  const y = simplifyTitle(b);
  if (!x || !y) return false;
  return x === y || x.includes(y) || y.includes(x);
}

export function ManualForm({ initialIsbn = '', isbnNotFound = false, initialTitle = '' }: ManualFormProps) {
  const adder = useShelfAdder();
  const titleInputRef = useRef<TextInput>(null);
  const [title, setTitle] = useState(initialTitle);
  const [authors, setAuthors] = useState<string[]>(['']);
  const [isbn, setIsbn] = useState(initialIsbn);
  const [isbnLocked, setIsbnLocked] = useState(isbnNotFound && initialIsbn !== '');
  const [stage, setStage] = useState<Stage>({ kind: 'form' });
  const [checking, setChecking] = useState(false);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isbnError, setIsbnError] = useState<string | null>(null);
  // Focus the title once the form is back on screen (it's unmounted while a
  // "known"/"matches" step is showing).
  const [focusTitle, setFocusTitle] = useState(false);
  // Current title for Undo's callback, which is created before later edits.
  const titleRef = useRef(title);
  titleRef.current = title;

  useEffect(() => {
    if (focusTitle && stage.kind === 'form') {
      titleInputRef.current?.focus();
      setFocusTitle(false);
    }
  }, [focusTitle, stage.kind]);

  function clearForm() {
    setTitle('');
    setAuthors(['']);
    setIsbn('');
    setIsbnLocked(false);
    setError(null);
    setIsbnError(null);
  }

  // Undo of an add: put what they typed back, unless they've started another.
  function restore(draft: Draft) {
    if (titleRef.current.trim()) return;
    setTitle(draft.title);
    setAuthors(draft.authors.length > 0 ? draft.authors : ['']);
    setIsbn(draft.isbn ?? '');
    setIsbnLocked(draft.isbnLocked);
  }

  function backToForm(options: { clear: boolean }) {
    if (options.clear) clearForm();
    setStage({ kind: 'form' });
    setFocusTitle(true);
  }

  function setAuthorAt(index: number, value: string) {
    setAuthors((list) => list.map((a, i) => (i === index ? value : a)));
  }

  function removeAuthorAt(index: number) {
    setAuthors((list) => list.filter((_, i) => i !== index));
  }

  async function handleSubmit() {
    setError(null);
    setIsbnError(null);

    const trimmedTitle = title.trim();
    if (!trimmedTitle) {
      setError('Title is required.');
      return;
    }

    let normalized: string | null = null;
    if (isbn.trim()) {
      normalized = normalizeIsbn(isbn);
      if (!normalized) {
        setIsbnError("That ISBN doesn't look right — check it, or leave it blank.");
        return;
      }
    }

    const draft: Draft = {
      isbn: normalized,
      isbnLocked,
      title: trimmedTitle,
      authors: authors.map((a) => a.trim()).filter(Boolean),
    };

    // Before creating anything new, make sure we don't already know it.
    setChecking(true);
    try {
      if (normalized && !isbnLocked) {
        const result = await lookupIsbn(normalized);
        if (result.kind !== 'not_found') {
          setStage({ kind: 'known', found: result, draft });
          return;
        }
      } else if (!normalized) {
        const results = await searchCatalog(trimmedTitle);
        const close = results.filter((b) => isCloseTitle(b.title, trimmedTitle));
        if (close.length > 0) {
          setStage({ kind: 'matches', books: close, draft });
          return;
        }
      }
    } catch {
      setError("Couldn't check for this book right now. Check your connection and try again.");
      return;
    } finally {
      setChecking(false);
    }

    await addDraft(draft);
  }

  // Creates the book from what they typed.
  async function addDraft(draft: Draft) {
    setError(null);
    setAdding(true);
    const { outcome, error: addError } = await adder.add(
      MANUAL_KEY,
      { isbn: draft.isbn, title: draft.title, authors: draft.authors, source: 'manual' },
      draft.title,
      { onUndone: () => restore(draft) }
    );
    setAdding(false);
    if (outcome === 'error') {
      setError(addError);
      return;
    }
    backToForm({ clear: true });
  }

  // Adds a book we already know instead of their typed details.
  async function addFound(found: FoundBook, key: string, draft: Draft) {
    const { outcome } = await adder.add(key, foundBookInput(found), found.book.title, {
      onUndone: () => restore(draft),
    });
    // Their book is on the shelf; the typed details are no longer needed.
    if (outcome === 'added') clearForm();
  }

  if (stage.kind === 'known') {
    const { found, draft } = stage;
    const key = found.kind === 'catalog' ? catalogKey(found.book) : externalKey(found.book);
    const status = adder.statusOf(key, found.kind === 'catalog' && found.book.onMyShelf);
    const done = status === 'added';
    return (
      <View style={styles.step}>
        <Text style={styles.stepTitle}>We already know this book</Text>
        <Text style={styles.stepText}>ISBN {draft.isbn} matches:</Text>
        <BookResultCard
          book={found.book}
          status={status}
          error={adder.errorOf(key)}
          note={found.kind === 'external' ? SOURCE_NOTES[found.book.source] : undefined}
          onAdd={() => addFound(found, key, draft)}
        />
        <Button
          title={done ? 'Add another book' : 'Back'}
          variant="secondary"
          onPress={() => backToForm({ clear: done })}
        />
      </View>
    );
  }

  if (stage.kind === 'matches') {
    const { books, draft } = stage;
    const anyAdded = books.some((b) => adder.statusOf(catalogKey(b)) === 'added');
    return (
      <View style={styles.step}>
        <Text style={styles.stepTitle}>Is it one of these?</Text>
        <Text style={styles.stepText}>These are already in sharedShelf.</Text>
        <View>
          {books.map((book) => {
            const key = catalogKey(book);
            return (
              <BookRow
                key={key}
                book={book}
                status={adder.statusOf(key, book.onMyShelf)}
                error={adder.errorOf(key)}
                onAdd={() => addFound({ kind: 'catalog', book }, key, draft)}
              />
            );
          })}
        </View>
        {error && <Text style={styles.errorText}>{error}</Text>}
        {anyAdded ? (
          <Button title="Add another book" variant="secondary" onPress={() => backToForm({ clear: true })} />
        ) : (
          <View style={styles.stepActions}>
            <Button
              title="No, add as new book"
              onPress={() => addDraft(draft)}
              loading={adding}
              style={styles.stepPrimary}
            />
            <Button title="Back" variant="secondary" onPress={() => backToForm({ clear: false })} />
          </View>
        )}
      </View>
    );
  }

  return (
    <View>
      {isbnLocked && (
        <Text style={styles.prefillNote}>
          We couldn't find ISBN {isbn} — add its title and author below.
        </Text>
      )}

      <Text style={styles.label}>Title</Text>
      <TextInput
        ref={titleInputRef}
        style={inputStyle}
        placeholder="The Left Hand of Darkness"
        placeholderTextColor={colors.textFaint}
        value={title}
        onChangeText={setTitle}
      />

      <Text style={styles.label}>{authors.length > 1 ? 'Authors' : 'Author'}</Text>
      {authors.map((author, i) => (
        <View key={i} style={styles.authorRow}>
          <TextInput
            style={[inputStyle, styles.authorInput]}
            placeholder={i === 0 ? 'Ursula K. Le Guin' : 'Another author'}
            placeholderTextColor={colors.textFaint}
            value={author}
            onChangeText={(v) => setAuthorAt(i, v)}
            accessibilityLabel={`Author ${i + 1}`}
          />
          {i > 0 && (
            <Pressable
              style={styles.removeAuthor}
              onPress={() => removeAuthorAt(i)}
              hitSlop={6}
              accessibilityLabel={`Remove author ${i + 1}`}
            >
              <Text style={styles.removeAuthorText}>✕</Text>
            </Pressable>
          )}
        </View>
      ))}
      <Pressable style={styles.addAuthor} onPress={() => setAuthors((list) => [...list, ''])} hitSlop={6}>
        <Text style={styles.addAuthorText}>+ Add another author</Text>
      </Pressable>

      <Text style={styles.label}>{isbnLocked ? 'ISBN' : 'ISBN (optional)'}</Text>
      {isbnLocked ? (
        <View style={[inputStyle, styles.lockedIsbn]}>
          <Text style={styles.lockedIsbnText}>{isbn}</Text>
        </View>
      ) : (
        <TextInput
          style={inputStyle}
          placeholder="9780441478125"
          placeholderTextColor={colors.textFaint}
          value={isbn}
          onChangeText={(v) => {
            setIsbn(v);
            setIsbnError(null);
          }}
          keyboardType="numbers-and-punctuation"
          enterKeyHint="done"
          onSubmitEditing={handleSubmit}
        />
      )}
      {isbnError && <Text style={styles.errorText}>{isbnError}</Text>}

      {error && <Text style={styles.errorText}>{error}</Text>}

      <Button title="Add to shelf" variant="secondary" onPress={handleSubmit} loading={checking || adding} />
    </View>
  );
}

const styles = StyleSheet.create({
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
  authorRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
  },
  authorInput: {
    flex: 1,
  },
  removeAuthor: {
    height: 46, // roughly the input's height, so the ✕ centers on it
    paddingHorizontal: 6,
    justifyContent: 'center',
  },
  removeAuthorText: {
    fontFamily: fonts.medium,
    fontSize: 16,
    color: colors.textFaint,
  },
  addAuthor: {
    alignSelf: 'flex-start',
    marginBottom: 16,
  },
  addAuthorText: {
    fontFamily: fonts.semibold,
    fontSize: 14,
    color: colors.text,
  },
  lockedIsbn: {
    backgroundColor: colors.chipBackground,
    borderRadius: radius.md,
  },
  lockedIsbnText: {
    fontFamily: fonts.regular,
    fontSize: 16,
    color: colors.textMuted,
  },
  errorText: {
    fontFamily: fonts.medium,
    color: colors.danger,
    fontSize: 14,
    marginBottom: 12,
  },
  step: {
    gap: 14,
  },
  stepTitle: {
    fontFamily: fonts.display,
    fontSize: 18,
    color: colors.text,
  },
  stepText: {
    fontFamily: fonts.regular,
    fontSize: 14,
    color: colors.textMuted,
    marginTop: -8,
  },
  stepActions: {
    flexDirection: 'row',
    gap: 8,
  },
  stepPrimary: {
    flex: 1,
  },
});
