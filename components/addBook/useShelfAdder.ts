import { useCallback, useState } from 'react';
import {
  addToShelf,
  removeFromShelf,
  type AddToShelfInput,
  type CatalogBook,
  type ExternalBook,
} from '../../lib/bookLookup';
import { useToast } from '../Toast';
import type { BookResultStatus } from './BookResultCard';

// One-tap add with an Undo toast, for screens that show several addable
// books at once (search results, "Is it one of these?"). Tracks each book's
// status by a caller-chosen key so rows can show Add / Added ✓ / On your
// shelf. Mirrors ScannerModal's add/undo handling.

// Status keys, shared so the same book keeps its status across views.
export const catalogKey = (book: CatalogBook) => `c:${book.id}`;
export const externalKey = (book: ExternalBook) => `x:${book.isbn}`;

// What addToShelf needs for a book we found (vs. one typed in by hand).
export function foundBookInput(
  found: { kind: 'catalog'; book: CatalogBook } | { kind: 'external'; book: ExternalBook }
): AddToShelfInput {
  return found.kind === 'catalog'
    ? { bookId: found.book.id }
    : {
        isbn: found.book.isbn,
        title: found.book.title,
        authors: found.book.authors,
        coverUrl: found.book.coverUrl,
        source: found.book.source,
      };
}

export interface AddResult {
  outcome: 'added' | 'on_shelf' | 'error';
  error: string | null;
}

interface Entry {
  status: BookResultStatus;
  error: string | null;
}

interface AddOptions {
  // Runs after a successful Undo, e.g. to put a cleared form back.
  onUndone?: () => void;
}

export function useShelfAdder() {
  const toast = useToast();
  const [entries, setEntries] = useState<Record<string, Entry>>({});

  const setEntry = useCallback((key: string, status: BookResultStatus, error: string | null = null) => {
    setEntries((current) => ({ ...current, [key]: { status, error } }));
  }, []);

  async function undo(key: string, shelfItemId: string, title: string, options?: AddOptions) {
    try {
      await removeFromShelf(shelfItemId);
    } catch {
      toast.show({ message: `Couldn't undo — ${title} is still on your shelf.` });
      return;
    }
    setEntry(key, 'addable');
    options?.onUndone?.();
  }

  async function add(
    key: string,
    input: AddToShelfInput,
    title: string,
    options?: AddOptions
  ): Promise<AddResult> {
    setEntry(key, 'adding');
    try {
      const { shelfItemId, alreadyOnShelf } = await addToShelf(input);
      if (alreadyOnShelf) {
        setEntry(key, 'on_shelf');
        toast.show({ message: `${title} is already on your shelf` });
        return { outcome: 'on_shelf', error: null };
      }
      setEntry(key, 'added');
      toast.show({
        message: `Added ${title}`,
        actionLabel: 'Undo',
        onAction: () => undo(key, shelfItemId, title, options),
      });
      return { outcome: 'added', error: null };
    } catch (e) {
      const error = e instanceof Error ? e.message : 'Could not add this book.';
      setEntry(key, 'addable', error);
      return { outcome: 'error', error };
    }
  }

  // Local status wins (it's newer); otherwise fall back to what the lookup said.
  function statusOf(key: string, onMyShelf = false): BookResultStatus {
    return entries[key]?.status ?? (onMyShelf ? 'on_shelf' : 'addable');
  }

  function errorOf(key: string): string | null {
    return entries[key]?.error ?? null;
  }

  const reset = useCallback(() => setEntries({}), []);

  return { add, statusOf, errorOf, reset };
}
