#!/usr/bin/env node
// Seeds the shared catalog with well-known books from Open Library, so adding
// "I have a copy" is usually one tap. One-off and re-runnable: works and ISBNs
// already in the catalog are skipped.
//
// Uses Open Library's search.json, 100 works per request (their guidelines
// ask for batched search over single-book calls), one request every ~1.2s.
// Each work comes with one English edition (ISBN, publisher, cover) and is
// written through the seed_catalog RPC. Descriptions are not fetched here:
// the book page asks enrich-book for them the first time someone opens it.
//
// Usage:
//   SUPABASE_SERVICE_ROLE_KEY=... node scripts/seed-catalog.mjs [--pages 3] [--subjects fantasy,poetry] [--dry-run]
//
//   --pages N     pages of 100 per subject (default 3, so up to ~300 per subject)
//   --subjects    comma-separated subject keys from SUBJECTS below (default: all)
//   --dry-run     fetch and print counts, write nothing
//
// EXPO_PUBLIC_SUPABASE_URL is read from .env.

import { readFileSync } from 'node:fs';

// Open Library subject key -> the category label shown on the book page.
const SUBJECTS = {
  fiction: 'Fiction',
  classic_literature: 'Classics',
  fantasy: 'Fantasy',
  science_fiction: 'Science fiction',
  mystery_and_detective_stories: 'Mystery',
  thrillers: 'Thriller',
  romance: 'Romance',
  horror: 'Horror',
  historical_fiction: 'Historical fiction',
  young_adult_fiction: 'Young adult',
  graphic_novels: 'Graphic novels',
  poetry: 'Poetry',
  short_stories: 'Short stories',
  biography: 'Biography',
  autobiography: 'Memoir',
  history: 'History',
  philosophy: 'Philosophy',
  psychology: 'Psychology',
  science: 'Science',
  self_help: 'Self-help',
  business: 'Business',
  economics: 'Economics',
  politics: 'Politics',
  cooking: 'Cooking',
  art: 'Art',
  travel: 'Travel',
  nature: 'Nature',
  religion: 'Religion',
};

const UA = 'sharedShelf (samuelthomp14@gmail.com)';
const DELAY_MS = 1200;
const FIELDS = [
  'key', 'title', 'subtitle', 'author_name', 'first_publish_year', 'cover_i', 'isbn',
  'number_of_pages_median', 'editions', 'editions.title', 'editions.isbn',
  'editions.publisher', 'editions.language', 'editions.cover_i', 'editions.number_of_pages',
].join(',');

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return fallback;
  const next = process.argv[i + 1];
  return next && !next.startsWith('--') ? next : true;
}

function envFromDotenv(key) {
  if (process.env[key]) return process.env[key];
  try {
    const line = readFileSync(new URL('../.env', import.meta.url), 'utf8')
      .split('\n')
      .find((l) => l.startsWith(`${key}=`));
    return line?.slice(key.length + 1).trim();
  } catch {
    return undefined;
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const cover = (id) => (id ? `https://covers.openlibrary.org/b/id/${id}-M.jpg` : null);

// Prefer an ISBN-13 from an English-language registration group (978-0,
// 978-1), then any ISBN-13.
function pickIsbn(list) {
  const isbns = (list ?? []).filter((i) => /^97[89]\d{10}$/.test(i));
  return isbns.find((i) => /^97[89][01]/.test(i)) ?? isbns[0] ?? null;
}

function toSeed(doc, category) {
  // A best edition tagged with another language (El Principito, a German
  // Douglas Adams) isn't one; use the work's English-publisher ISBN instead.
  const best = doc.editions?.docs?.[0];
  const ed = best?.language?.length && !best.language.includes('eng') ? undefined : best;
  const olWorkId = doc.key?.match(/OL\d+W/)?.[0];
  const edIsbn = pickIsbn(ed?.isbn);
  // The best edition sometimes has no ISBN; fall back to one of the work's,
  // without that edition's details (enrich-book fills them later).
  const isbn = edIsbn ?? pickIsbn(doc.isbn);
  // The work title can be the original-language one ("Het Achterhuis"); the
  // English edition's title is what people know it by.
  const title = ed?.title || doc.title;
  if (!olWorkId || !isbn || !title || !doc.author_name?.length) return null;
  if (!doc.cover_i && !ed?.cover_i) return null; // a coverless tile looks broken
  return {
    ol_work_id: olWorkId,
    title,
    subtitle: doc.subtitle ?? null,
    authors: doc.author_name.slice(0, 4),
    first_publish_year: doc.first_publish_year ?? null,
    categories: [category],
    cover_url: cover(doc.cover_i),
    edition: edIsbn
      ? {
          isbn,
          publisher: ed.publisher?.[0] ?? null,
          page_count: ed.number_of_pages ?? doc.number_of_pages_median ?? null,
          language: ed.language?.[0] ?? null,
          cover_url: cover(ed.cover_i),
        }
      : { isbn, page_count: doc.number_of_pages_median ?? null },
  };
}

async function searchSubject(key, page) {
  const params = new URLSearchParams({
    q: `subject_key:${key} language:eng`,
    sort: 'readinglog',
    lang: 'en',
    limit: '100',
    page: String(page),
    fields: FIELDS,
  });
  const res = await fetch(`https://openlibrary.org/search.json?${params}`, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`Open Library ${res.status} for ${key} page ${page}`);
  return (await res.json()).docs ?? [];
}

async function seed(url, serviceKey, works) {
  const res = await fetch(`${url}/rest/v1/rpc/seed_catalog`, {
    method: 'POST',
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ p_works: works }),
  });
  if (!res.ok) throw new Error(`seed_catalog ${res.status}: ${await res.text()}`);
  return res.json();
}

async function main() {
  const dryRun = arg('dry-run', false) === true;
  const pages = Number(arg('pages', 3));
  const subjectArg = arg('subjects', null);
  const subjects = subjectArg ? String(subjectArg).split(',') : Object.keys(SUBJECTS);
  for (const s of subjects) {
    if (!SUBJECTS[s]) throw new Error(`Unknown subject "${s}". Known: ${Object.keys(SUBJECTS).join(', ')}`);
  }

  const url = envFromDotenv('EXPO_PUBLIC_SUPABASE_URL');
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!dryRun && (!url || !serviceKey)) {
    throw new Error('Needs EXPO_PUBLIC_SUPABASE_URL (.env) and SUPABASE_SERVICE_ROLE_KEY (env).');
  }

  const seen = new Set();
  let fetched = 0;
  let usable = 0;
  let added = 0;

  for (const subject of subjects) {
    for (let page = 1; page <= pages; page++) {
      const docs = await searchSubject(subject, page);
      fetched += docs.length;
      const works = [];
      for (const doc of docs) {
        const w = toSeed(doc, SUBJECTS[subject]);
        if (!w || seen.has(w.ol_work_id)) continue;
        seen.add(w.ol_work_id);
        works.push(w);
      }
      usable += works.length;
      const n = works.length && !dryRun ? await seed(url, serviceKey, works) : 0;
      added += n;
      console.log(`${subject} p${page}: ${docs.length} results, ${works.length} usable, ${dryRun ? 'dry run' : `${n} added`}`);
      if (dryRun) {
        for (const w of works.slice(0, 5)) console.log(`    ${w.title} — ${w.authors[0]} (${w.edition.isbn}, ${w.edition.publisher ?? 'no publisher'})`);
      }
      if (docs.length < 100) break;
      await sleep(DELAY_MS);
    }
    await sleep(DELAY_MS);
  }

  console.log(`\nDone. ${fetched} results, ${usable} usable works, ${dryRun ? 'nothing written (dry run)' : `${added} books added`}.`);
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
