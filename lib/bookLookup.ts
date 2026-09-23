import { supabase } from './supabase';
import { normalizeIsbn } from './isbn';
import { log } from './log';

// Book lookup for the add-book flow. Our own catalog is always checked first;
// Open Library and then Google Books are fallbacks only, and anything we take
// from them must carry a valid ISBN-13.

export interface CatalogBook {
  id: string;
  isbn: string | null;
  title: string;
  authors: string[];
  coverUrl: string | null;
  // The caller's own shelf item for this book, if they already have it.
  shelfItemId: string | null;
  onMyShelf: boolean;
}

export type ExternalSource = 'open_library' | 'google_books';

export interface ExternalBook {
  isbn: string;
  title: string;
  authors: string[];
  coverUrl: string | null;
  source: ExternalSource;
}

export type IsbnLookupResult =
  | { kind: 'catalog'; book: CatalogBook }
  | { kind: 'external'; book: ExternalBook }
  | { kind: 'not_found' };

export type AddToShelfInput =
  | { bookId: string }
  | {
      isbn?: string | null;
      title: string;
      authors: string[];
      coverUrl?: string | null;
      source: 'manual' | ExternalSource;
    };

export interface AddToShelfResult {
  bookId: string;
  shelfItemId: string;
  alreadyOnShelf: boolean;
}

const MAX_EXTERNAL_RESULTS = 15;

// ---------------------------------------------------------------------------
// Cleaning external data — all of it goes through here.

const TITLE_CASE_MINOR_WORDS = new Set([
  'a', 'an', 'the', 'and', 'but', 'or', 'nor', 'for', 'so', 'yet',
  'at', 'by', 'in', 'of', 'on', 'to', 'up', 'as', 'from', 'into', 'over', 'with',
]);

export function toTitleCase(str: string): string {
  const words = str.split(' ');
  return words
    .map((word, i) => {
      if (!word) return word;
      const isMinor = TITLE_CASE_MINOR_WORDS.has(word.toLowerCase());
      const isEdge = i === 0 || i === words.length - 1;
      if (isMinor && !isEdge) {
        return word.toLowerCase();
      }
      return word.charAt(0).toUpperCase() + word.slice(1);
    })
    .join(' ');
}

function collapse(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

function cleanTitle(raw: string | undefined): string {
  return raw ? toTitleCase(collapse(raw)) : '';
}

function cleanAuthors(raw: (string | undefined | null)[] | undefined): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const name of raw ?? []) {
    const cleaned = name ? collapse(name) : '';
    const key = cleaned.toLowerCase();
    if (!cleaned || seen.has(key)) continue;
    seen.add(key);
    out.push(cleaned);
  }
  return out;
}

function httpsUrl(url: string | undefined | null): string | null {
  if (!url) return null;
  return url.replace(/^http:\/\//i, 'https://');
}

// Build an ExternalBook, or null if it has no usable ISBN or title.
function toExternal(
  isbn: string | null,
  title: string | undefined,
  authors: (string | undefined | null)[] | undefined,
  coverUrl: string | undefined | null,
  source: ExternalSource
): ExternalBook | null {
  const cleanedTitle = cleanTitle(title);
  if (!isbn || !cleanedTitle) return null;
  return { isbn, title: cleanedTitle, authors: cleanAuthors(authors), coverUrl: httpsUrl(coverUrl), source };
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${new URL(url).host} responded ${res.status}`);
  return (await res.json()) as T;
}

// Google Books needs an API key: its keyless quota is shared by everyone and
// is usually exhausted (429). Without a key we skip it and rely on Open Library.
const GOOGLE_BOOKS_API_KEY = process.env.EXPO_PUBLIC_GOOGLE_BOOKS_API_KEY;
const googleKeyParam = GOOGLE_BOOKS_API_KEY ? `&key=${encodeURIComponent(GOOGLE_BOOKS_API_KEY)}` : '';

// ---------------------------------------------------------------------------
// Our catalog

interface CatalogRow {
  id: string;
  isbn: string | null;
  title: string;
  authors: string[] | null;
  cover_url: string | null;
  shelf_item_id: string | null;
}

function toCatalogBook(row: CatalogRow): CatalogBook {
  return {
    id: row.id,
    isbn: row.isbn,
    title: row.title,
    authors: row.authors ?? [],
    coverUrl: row.cover_url,
    shelfItemId: row.shelf_item_id,
    onMyShelf: row.shelf_item_id != null,
  };
}

export async function searchCatalog(q: string): Promise<CatalogBook[]> {
  const { data, error } = await supabase.rpc('search_catalog', { q: q.trim() });
  if (error) {
    log.error('book_lookup.search_catalog_failed', { q, error: error.message });
    throw new Error(error.message);
  }
  return ((data ?? []) as CatalogRow[]).map(toCatalogBook);
}

// ---------------------------------------------------------------------------
// External sources

interface OpenLibrarySearchDoc {
  title?: string;
  author_name?: string[];
  isbn?: string[];
  cover_i?: number;
}

interface GoogleVolume {
  volumeInfo?: {
    title?: string;
    authors?: string[];
    industryIdentifiers?: { type?: string; identifier?: string }[];
    imageLinks?: { thumbnail?: string; smallThumbnail?: string };
  };
}

interface GoogleVolumesResponse {
  items?: GoogleVolume[];
}

// Open Library's old /api/books?bibkeys= endpoint now 404s for every ISBN;
// search.json with an isbn filter is the working equivalent.
async function openLibraryByIsbn(isbn: string): Promise<ExternalBook | null> {
  const json = await fetchJson<{ docs?: OpenLibrarySearchDoc[] }>(
    `https://openlibrary.org/search.json?isbn=${encodeURIComponent(isbn)}&fields=title,author_name,cover_i&limit=1`
  );
  const doc = json.docs?.[0];
  if (!doc) return null;
  return toExternal(
    isbn,
    doc.title,
    doc.author_name,
    doc.cover_i ? `https://covers.openlibrary.org/b/id/${doc.cover_i}-M.jpg` : null,
    'open_library'
  );
}

function googleIsbn(volume: GoogleVolume): string | null {
  const ids = volume.volumeInfo?.industryIdentifiers ?? [];
  const isbn13 = ids.find((i) => i.type === 'ISBN_13')?.identifier;
  const isbn10 = ids.find((i) => i.type === 'ISBN_10')?.identifier;
  return (isbn13 && normalizeIsbn(isbn13)) || (isbn10 && normalizeIsbn(isbn10)) || null;
}

function fromGoogle(volume: GoogleVolume, isbn: string | null): ExternalBook | null {
  const info = volume.volumeInfo;
  return toExternal(
    isbn,
    info?.title,
    info?.authors,
    info?.imageLinks?.thumbnail ?? info?.imageLinks?.smallThumbnail,
    'google_books'
  );
}

async function googleBooksByIsbn(isbn: string): Promise<ExternalBook | null> {
  const json = await fetchJson<GoogleVolumesResponse>(
    `https://www.googleapis.com/books/v1/volumes?q=isbn:${encodeURIComponent(isbn)}${googleKeyParam}`
  );
  // We asked for this exact ISBN, so tag the result with it.
  for (const volume of json.items ?? []) {
    const book = fromGoogle(volume, isbn);
    if (book) return book;
  }
  return null;
}

// Prefer a real 978/979 ISBN-13 from OL's (often long, mixed) isbn array,
// falling back to converting an ISBN-10.
function pickOpenLibraryIsbn(isbns: string[] | undefined): string | null {
  const list = isbns ?? [];
  for (const raw of list) {
    if (raw.replace(/[\s-]/g, '').length === 13) {
      const n = normalizeIsbn(raw);
      if (n) return n;
    }
  }
  for (const raw of list) {
    const n = normalizeIsbn(raw);
    if (n) return n;
  }
  return null;
}

async function openLibrarySearch(q: string): Promise<ExternalBook[]> {
  const json = await fetchJson<{ docs?: OpenLibrarySearchDoc[] }>(
    `https://openlibrary.org/search.json?q=${encodeURIComponent(q)}&fields=title,author_name,isbn,cover_i&limit=20`
  );
  return (json.docs ?? [])
    .map((doc) =>
      toExternal(
        pickOpenLibraryIsbn(doc.isbn),
        doc.title,
        doc.author_name,
        doc.cover_i ? `https://covers.openlibrary.org/b/id/${doc.cover_i}-M.jpg` : null,
        'open_library'
      )
    )
    .filter((b): b is ExternalBook => b !== null);
}

async function googleBooksSearch(q: string): Promise<ExternalBook[]> {
  const json = await fetchJson<GoogleVolumesResponse>(
    `https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(q)}&maxResults=20&printType=books${googleKeyParam}`
  );
  return (json.items ?? [])
    .map((volume) => fromGoogle(volume, googleIsbn(volume)))
    .filter((b): b is ExternalBook => b !== null);
}

interface Source<T> {
  name: string;
  run: () => Promise<T>;
}

// Runs each source in order until one returns something. Throws only if every
// source errored — a clean "nothing found" from any source is not an error.
// Each failure is logged, so a broken or rate-limited API shows up in client_logs.
async function firstHit<T>(
  op: string,
  sources: Source<T>[],
  isHit: (result: T) => boolean,
  empty: T
): Promise<T> {
  const failures: { source: string; error: string }[] = [];
  let lastError: unknown;
  for (const source of sources) {
    try {
      const result = await source.run();
      if (isHit(result)) return result;
    } catch (e) {
      lastError = e;
      failures.push({ source: source.name, error: e instanceof Error ? e.message : String(e) });
      log.warn('book_lookup.source_failed', { op, source: source.name, error: e });
    }
  }
  if (sources.length > 0 && failures.length === sources.length) {
    log.error('book_lookup.all_sources_failed', { op, failures });
    throw lastError instanceof Error ? lastError : new Error('Book lookup failed');
  }
  return empty;
}

function withGoogle<T>(openLibrary: Source<T>, google: Source<T>): Source<T>[] {
  return GOOGLE_BOOKS_API_KEY ? [openLibrary, google] : [openLibrary];
}

// ---------------------------------------------------------------------------
// Public lookups

export async function lookupIsbn(isbn: string): Promise<IsbnLookupResult> {
  const normalized = normalizeIsbn(isbn);
  if (!normalized) return { kind: 'not_found' };

  const { data, error } = await supabase.rpc('lookup_isbn', { p_isbn: normalized });
  if (error) {
    log.error('book_lookup.lookup_isbn_failed', { isbn: normalized, error: error.message });
    throw new Error(error.message);
  }
  const row = ((data ?? []) as CatalogRow[])[0];
  if (row) return { kind: 'catalog', book: toCatalogBook(row) };

  const book = await firstHit<ExternalBook | null>(
    `isbn:${normalized}`,
    withGoogle(
      { name: 'open_library', run: () => openLibraryByIsbn(normalized) },
      { name: 'google_books', run: () => googleBooksByIsbn(normalized) }
    ),
    (b) => b !== null,
    null
  );
  return book ? { kind: 'external', book } : { kind: 'not_found' };
}

// External search results, minus anything already in our catalog (the caller
// shows catalog matches separately via searchCatalog).
export async function searchExternal(q: string): Promise<ExternalBook[]> {
  const query = collapse(q);
  if (query.length < 2) return [];

  const results = await firstHit<ExternalBook[]>(
    `search:${query}`,
    withGoogle(
      { name: 'open_library', run: () => openLibrarySearch(query) },
      { name: 'google_books', run: () => googleBooksSearch(query) }
    ),
    (r) => r.length > 0,
    []
  );

  const byIsbn = new Map<string, ExternalBook>();
  for (const book of results) {
    if (!byIsbn.has(book.isbn)) byIsbn.set(book.isbn, book);
  }
  if (byIsbn.size === 0) return [];

  const { data, error } = await supabase
    .from('books')
    .select('isbn')
    .in('isbn', [...byIsbn.keys()]);
  // If the catalog check fails we still show external results rather than
  // nothing; worst case a book appears in both lists.
  if (!error) {
    for (const { isbn } of data ?? []) {
      if (isbn) byIsbn.delete(isbn);
    }
  }

  return [...byIsbn.values()].slice(0, MAX_EXTERNAL_RESULTS);
}

// ---------------------------------------------------------------------------
// Shelf mutations

interface AddBookRow {
  book_id: string;
  shelf_item_id: string;
  already_on_shelf: boolean;
}

export async function addToShelf(input: AddToShelfInput): Promise<AddToShelfResult> {
  const args =
    'bookId' in input
      ? { p_book_id: input.bookId }
      : {
          p_isbn: input.isbn ?? undefined,
          p_title: input.title,
          p_authors: input.authors,
          p_cover_url: input.coverUrl ?? undefined,
          p_source: input.source,
        };
  const { data, error } = await supabase.rpc('add_book_to_shelf', args);
  if (error) {
    log.error('shelf.add_failed', { args, error: error.message });
    throw new Error(error.message);
  }
  const row = ((data ?? []) as AddBookRow[])[0];
  if (!row) throw new Error('Could not add book to your shelf');
  return {
    bookId: row.book_id,
    shelfItemId: row.shelf_item_id,
    alreadyOnShelf: row.already_on_shelf,
  };
}

export async function removeFromShelf(shelfItemId: string): Promise<void> {
  const { error } = await supabase.from('shelf_items').delete().eq('id', shelfItemId);
  if (error) {
    log.error('shelf.remove_failed', { shelfItemId, error: error.message });
    throw new Error(error.message);
  }
}
