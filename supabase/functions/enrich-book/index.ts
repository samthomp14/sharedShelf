// enrich-book: fills in one book's details (work link, description,
// categories, publisher, page count) from Open Library and Google Books, then
// writes them through link_book_to_work, which only fills empty fields.
//
// Called two ways, both with {"book_id": "<id>"}:
//   * by the dispatch_book_enrich trigger (pg_net) right after a book is
//     added without details, with the x-catalog-secret header;
//   * by the app when someone opens a book whose work has no description
//     checked yet (seeded books), with the signed-in user's JWT.
// Either way it costs at most a few requests per book, once: a book that's
// enriched with its description checked is a no-op.
//
// The secret caller may also pass "adopt_edition": true, which lets a book
// with no ISBN take the matched edition's ISBN (one-off demo-data cleanup).
//
// Secrets (Edge Functions -> Secrets): CATALOG_WEBHOOK_SECRET (same value as
// the catalog_webhook_secret Vault secret), GOOGLE_BOOKS_API_KEY (optional).
// SUPABASE_URL, SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY are provided.
import { createClient } from 'jsr:@supabase/supabase-js@2';

// Open Library asks apps to identify themselves; that also raises the limit
// from 1 to 3 requests a second.
const OL_HEADERS = { 'User-Agent': 'sharedShelf (samuelthomp14@gmail.com)' };
const GOOGLE_KEY = Deno.env.get('GOOGLE_BOOKS_API_KEY');

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

interface WorkFields {
  ol_work_id?: string;
  title?: string;
  subtitle?: string;
  description?: string;
  first_publish_year?: number;
  categories?: string[];
  cover_url?: string;
  description_checked?: boolean;
  author_list?: { name: string; ol_author_id: string | null }[];
}

interface EditionFields {
  isbn?: string;
  publisher?: string;
  page_count?: number;
  language?: string;
  cover_url?: string;
}

interface OlDoc {
  key?: string;
  title?: string;
  subtitle?: string;
  author_name?: string[];
  author_key?: string[];
  author_alternative_name?: string[];
  first_publish_year?: number;
  subject?: string[];
  cover_i?: number;
  number_of_pages_median?: number;
  editions?: {
    docs?: {
      isbn?: string[];
      publisher?: string[];
      language?: string[];
      cover_i?: number;
      number_of_pages?: number;
    }[];
  };
}

const OL_FIELDS = [
  'key', 'title', 'subtitle', 'author_name', 'author_key', 'author_alternative_name', 'first_publish_year', 'subject', 'cover_i',
  'number_of_pages_median', 'editions', 'editions.isbn', 'editions.publisher',
  'editions.language', 'editions.cover_i', 'editions.number_of_pages',
].join(',');

async function getJson<T>(url: string, headers: Record<string, string> = {}): Promise<T | null> {
  const res = await fetch(url, { headers });
  if (!res.ok) {
    console.warn(`${new URL(url).host} responded ${res.status}`);
    return null;
  }
  return (await res.json()) as T;
}

const olCover = (id?: number) => (id ? `https://covers.openlibrary.org/b/id/${id}-M.jpg` : undefined);

// Comparable form of a title: lowercase, no subtitle, no punctuation or
// leading article.
function titleKey(s: string): string {
  return s
    .toLowerCase()
    .split(':')[0]
    .replace(/[^\p{L}\p{N} ]/gu, '')
    .replace(/^(the|a|an) /, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function lastNames(authors: string[]): Set<string> {
  return new Set(authors.map((a) => a.trim().split(/\s+/).pop()!.toLowerCase()).filter(Boolean));
}

// OL subjects are noisy ("Teenage girls", "Brooklyn (New York, N.Y.)"), so
// the fallback when Google has no categories only maps them onto a fixed set
// of genres — the same labels scripts/seed-catalog.mjs uses.
const GENRES: [RegExp, string][] = [
  [/science fiction|sci-fi/, 'Science fiction'],
  [/fantasy/, 'Fantasy'],
  [/mystery|detective/, 'Mystery'],
  [/thriller|suspense/, 'Thriller'],
  [/romance|love stories/, 'Romance'],
  [/horror/, 'Horror'],
  [/historical fiction/, 'Historical fiction'],
  [/young adult/, 'Young adult'],
  [/graphic novel|comic/, 'Graphic novels'],
  [/poetry|poems/, 'Poetry'],
  [/short stories/, 'Short stories'],
  [/classic/, 'Classics'],
  [/autobiography|memoir/, 'Memoir'],
  [/biography/, 'Biography'],
  [/philosophy/, 'Philosophy'],
  [/psychology/, 'Psychology'],
  [/self-help|self help/, 'Self-help'],
  [/cooking|cookery/, 'Cooking'],
  [/business/, 'Business'],
  [/economics/, 'Economics'],
  [/politic/, 'Politics'],
  [/travel/, 'Travel'],
  [/religion/, 'Religion'],
  [/^history|history$/, 'History'],
  [/^science$/, 'Science'],
  [/^fiction$/, 'Fiction'],
];

function cleanSubjects(subjects: string[] | undefined): string[] {
  const out: string[] = [];
  for (const s of subjects ?? []) {
    const lower = s.toLowerCase().trim();
    const genre = GENRES.find(([re]) => re.test(lower))?.[1];
    if (genre && !out.includes(genre)) out.push(genre);
  }
  // "Fiction" only when nothing more specific matched.
  const specific = out.filter((g) => g !== 'Fiction');
  return (specific.length ? specific : out).slice(0, 3);
}

function cleanCategories(categories: string[] | undefined): string[] {
  const out: string[] = [];
  for (const c of categories ?? []) {
    for (const part of c.split('/').map((p) => p.trim())) {
      if (!part || /^general$/i.test(part) || out.includes(part)) continue;
      out.push(part);
    }
  }
  return out.slice(0, 3);
}

// Google descriptions come with HTML (<p>, <br>, <i>, entities).
function stripHtml(s: string): string {
  return s
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>\s*<p[^>]*>/gi, '\n\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// OL work descriptions are a string or {value}, often with a trailing
// "----------" block of links/sources.
function cleanOlDescription(d: unknown): string | undefined {
  const text = typeof d === 'string' ? d : (d as { value?: string } | null)?.value;
  if (!text) return undefined;
  return text.split(/\n-{3,}/)[0].replace(/\r/g, '').trim() || undefined;
}

// Author names + OL ids in credit order, for link_book_to_work's author_list.
// Copy of scripts/lib/olAuthors.mjs (Deno can't import it); keep in step.
// OL's primary name is sometimes in the original script (村上春樹) or
// mangled; for single-author works pick the best Latin-script alternate.
const LOWERCASE_ON_PURPOSE = new Set(['bell hooks', 'e.e. cummings', 'e. e. cummings']);
const nameKey = (n: string) => n.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');

function isGoodName(n: string | undefined): n is string {
  if (!n || /[;()\d,]/.test(n)) return false;
  if (!/^[\p{Script=Latin}\s.'’-]+$/u.test(n)) return false;
  if (LOWERCASE_ON_PURPOSE.has(n.toLowerCase())) return true;
  return n !== n.toUpperCase() && n !== n.toLowerCase();
}

const capitalizedName = (n: string) =>
  n.split(/\s+/).every((w) => /^\p{Lu}\p{Ll}/u.test(w) || /^\p{Lu}\.?$/u.test(w));

function pickAuthorName(primary: string, alternates: string[] | undefined): string {
  if (isGoodName(primary)) return primary;
  const good = (alternates ?? []).filter((a) => isGoodName(a) && a.trim().split(/\s+/).length >= 2);
  if (good.length === 0) return primary;
  // "MURAKAMI Haruki" marks the surname; prefer spellings that put it last.
  const surnames = new Set<string>();
  for (const a of alternates ?? []) {
    const m = a.match(/^(\p{Lu}{2,}) \p{Lu}\p{Ll}+$/u);
    if (m) surnames.add(m[1].toLowerCase());
  }
  const uses = new Map<string, number>();
  for (const a of good) uses.set(nameKey(a), (uses.get(nameKey(a)) ?? 0) + 1);
  const score = (a: string) => [
    surnames.has(a.trim().split(/\s+/).pop()!.toLowerCase()) ? 1 : 0,
    uses.get(nameKey(a))!,
    capitalizedName(a) ? 1 : 0,
  ];
  return good
    .map((a, i) => ({ a, s: score(a), i }))
    .sort((x, y) => y.s[0] - x.s[0] || y.s[1] - x.s[1] || y.s[2] - x.s[2] || x.i - y.i)[0].a;
}

function olAuthorList(doc: OlDoc): { name: string; ol_author_id: string | null }[] | undefined {
  const names = doc.author_name ?? [];
  if (names.length === 0) return undefined;
  const keys = doc.author_key ?? [];
  const single = names.length === 1;
  return names.slice(0, 4).map((n, i) => ({
    name: single ? pickAuthorName(n, doc.author_alternative_name) : n,
    ol_author_id: /^OL\d+A$/.test(keys[i] ?? '') ? keys[i] : null,
  }));
}

function firstIsbn13(isbns: string[] | undefined): string | undefined {
  return isbns?.find((i) => /^97[89]\d{10}$/.test(i));
}

function fromOlDoc(doc: OlDoc): { work: WorkFields; edition: EditionFields } {
  const ed = doc.editions?.docs?.[0];
  const olId = doc.key?.match(/OL\d+W/)?.[0];
  return {
    work: {
      ol_work_id: olId,
      title: doc.title,
      subtitle: doc.subtitle,
      author_list: olAuthorList(doc),
      first_publish_year: doc.first_publish_year,
      categories: cleanSubjects(doc.subject),
      cover_url: olCover(doc.cover_i),
    },
    edition: {
      isbn: firstIsbn13(ed?.isbn),
      publisher: ed?.publisher?.[0],
      page_count: ed?.number_of_pages ?? doc.number_of_pages_median,
      language: ed?.language?.[0],
      cover_url: olCover(ed?.cover_i),
    },
  };
}

async function olByIsbn(isbn: string) {
  const res = await getJson<{ docs?: OlDoc[] }>(
    `https://openlibrary.org/search.json?isbn=${isbn}&fields=${OL_FIELDS}&limit=1`,
    OL_HEADERS
  );
  const doc = res?.docs?.[0];
  return doc ? fromOlDoc(doc) : null;
}

// For books with no ISBN: accept the top hit only if the title matches and
// an author's last name overlaps.
async function olByTitle(title: string, authors: string[]) {
  const params = new URLSearchParams({ title, fields: OL_FIELDS, limit: '5', lang: 'en' });
  if (authors[0]) params.set('author', authors[0]);
  const res = await getJson<{ docs?: OlDoc[] }>(`https://openlibrary.org/search.json?${params}`, OL_HEADERS);
  const want = titleKey(title);
  const names = lastNames(authors);
  const doc = (res?.docs ?? []).find(
    (d) =>
      d.title &&
      titleKey(d.title) === want &&
      (names.size === 0 || [...lastNames(d.author_name ?? [])].some((n) => names.has(n)))
  );
  return doc ? fromOlDoc(doc) : null;
}

async function olWorkDescription(olWorkId: string) {
  const res = await getJson<{ description?: unknown }>(
    `https://openlibrary.org/works/${olWorkId}.json`,
    OL_HEADERS
  );
  return cleanOlDescription(res?.description);
}

interface GoogleInfo {
  subtitle?: string;
  description?: string;
  categories?: string[];
  publisher?: string;
  pageCount?: number;
  language?: string;
}

async function google(isbn: string): Promise<GoogleInfo | null> {
  if (!GOOGLE_KEY) return null;
  const res = await getJson<{ items?: { volumeInfo?: GoogleInfo }[] }>(
    `https://www.googleapis.com/books/v1/volumes?q=isbn:${isbn}&key=${GOOGLE_KEY}`
  );
  return res?.items?.[0]?.volumeInfo ?? null;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  const url = Deno.env.get('SUPABASE_URL')!;
  const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

  // Trigger (shared secret) or a signed-in user.
  const secret = Deno.env.get('CATALOG_WEBHOOK_SECRET');
  const trusted = !!secret && req.headers.get('x-catalog-secret') === secret;
  if (!trusted) {
    const token = req.headers.get('Authorization')?.replace(/^Bearer /, '');
    const { data } = token ? await admin.auth.getUser(token) : { data: { user: null } };
    if (!data.user) return json(401, { error: 'unauthorized' });
  }

  let bookId: string | undefined;
  let adoptEdition = false;
  try {
    const body = await req.json();
    bookId = body.book_id;
    adoptEdition = trusted && body.adopt_edition === true;
  } catch {
    // fall through
  }
  if (!bookId) return json(400, { error: 'book_id required' });

  const { data: book, error } = await admin
    .from('books')
    .select('id, isbn, title, authors:author_names, enriched_at, work:works(id, ol_work_id, description, description_checked_at, categories)')
    .eq('id', bookId)
    .single();
  if (error || !book) return json(404, { error: 'book not found' });

  const work = book.work as unknown as {
    ol_work_id: string | null;
    description: string | null;
    description_checked_at: string | null;
    categories: string[];
  } | null;
  if (book.enriched_at && work?.description_checked_at) return json(200, { skipped: true });

  try {
    const workFields: WorkFields = { description_checked: true };
    const edition: EditionFields = {};

    // Open Library: the work link and edition details, unless we have them.
    if (!book.enriched_at || !work?.ol_work_id) {
      const ol = book.isbn ? await olByIsbn(book.isbn) : await olByTitle(book.title, book.authors ?? []);
      if (ol) {
        Object.assign(workFields, ol.work);
        Object.assign(edition, ol.edition);
        if (book.isbn || !adoptEdition) delete edition.isbn;
      }
    } else {
      workFields.ol_work_id = work.ol_work_id;
    }

    // Google: the better description and categories, by ISBN.
    const isbn = book.isbn ?? edition.isbn;
    const g = isbn ? await google(isbn) : null;
    if (g) {
      if (g.description) workFields.description = stripHtml(g.description);
      const cats = cleanCategories(g.categories);
      if (cats.length) workFields.categories = cats;
      workFields.subtitle ??= g.subtitle;
      edition.publisher ??= g.publisher;
      edition.page_count ??= g.pageCount;
      edition.language ??= g.language;
    }

    // Open Library work description as the fallback.
    if (!workFields.description && !work?.description && workFields.ol_work_id) {
      workFields.description = await olWorkDescription(workFields.ol_work_id);
    }

    const { error: linkError } = await admin.rpc('link_book_to_work', {
      p_book_id: book.id,
      p_work: workFields,
      p_edition: edition,
    });
    if (linkError) throw new Error(linkError.message);

    return json(200, { ok: true, ol_work_id: workFields.ol_work_id ?? null });
  } catch (e) {
    console.error('enrich-book failed', bookId, e);
    return json(500, { error: e instanceof Error ? e.message : String(e) });
  }
});
