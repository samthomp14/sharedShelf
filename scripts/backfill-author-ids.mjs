#!/usr/bin/env node
// Attaches Open Library author ids to works whose authors don't have one
// yet, which merges spellings a name match can't (村上春樹 / Haruki Murakami).
// One-off and re-runnable: works are picked by works_missing_author_ids, and
// set_work_authors only ever merges authors (see the author_ids migration).
//
// Batched like the seed: one Open Library search per 100 works
// (q=key:(/works/A OR /works/B ...)), ~1.2s apart.
//
// Usage:
//   SUPABASE_SERVICE_ROLE_KEY=... node scripts/backfill-author-ids.mjs [--dry-run] [--max-batches N]
//
// EXPO_PUBLIC_SUPABASE_URL is read from .env.

import { readFileSync } from 'node:fs';
import { olAuthorList } from './lib/olAuthors.mjs';

const UA = 'sharedShelf (samuelthomp14@gmail.com)';
const DELAY_MS = 1200;
const BATCH = 100;

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return fallback;
  const next = process.argv[i + 1];
  return next && !next.startsWith('--') ? next : true;
}

function envFromDotenv(k) {
  if (process.env[k]) return process.env[k];
  try {
    const line = readFileSync(new URL('../.env', import.meta.url), 'utf8')
      .split('\n')
      .find((l) => l.startsWith(`${k}=`));
    return line?.slice(k.length + 1).trim();
  } catch {
    return undefined;
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function rpc(url, serviceKey, fn, body) {
  const res = await fetch(`${url}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${fn} ${res.status}: ${await res.text()}`);
  return res.json();
}

async function olWorks(olIds) {
  const q = `key:(${olIds.map((id) => `/works/${id}`).join(' OR ')})`;
  const params = new URLSearchParams({
    q,
    limit: String(BATCH),
    fields: 'key,author_key,author_name,author_alternative_name',
  });
  const res = await fetch(`https://openlibrary.org/search.json?${params}`, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`Open Library ${res.status}`);
  return (await res.json()).docs ?? [];
}

async function main() {
  const dryRun = arg('dry-run', false) === true;
  const maxBatches = Number(arg('max-batches', Infinity));
  const url = envFromDotenv('EXPO_PUBLIC_SUPABASE_URL');
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) throw new Error('Needs EXPO_PUBLIC_SUPABASE_URL (.env) and SUPABASE_SERVICE_ROLE_KEY (env).');

  let after = null;
  let batches = 0;
  let linked = 0;
  let missing = 0;

  while (batches < maxBatches) {
    const works = await rpc(url, serviceKey, 'works_missing_author_ids', { p_after: after, p_limit: BATCH });
    if (works.length === 0) break;
    after = works[works.length - 1].id;
    batches++;

    const byOl = new Map(works.map((w) => [w.ol_work_id, w.id]));
    const docs = await olWorks([...byOl.keys()]);
    const items = [];
    for (const doc of docs) {
      const workId = byOl.get(doc.key?.replace('/works/', ''));
      const authors = olAuthorList(doc);
      if (!workId || authors.length === 0 || authors.every((a) => !a.ol_author_id)) continue;
      items.push({ work_id: workId, authors });
    }
    missing += works.length - items.length;

    if (dryRun) {
      for (const it of items.slice(0, 5)) console.log('   ', it.authors.map((a) => `${a.name} (${a.ol_author_id})`).join(', '));
    } else if (items.length) {
      linked += await rpc(url, serviceKey, 'set_work_authors_batch', { p_items: items });
    }
    console.log(`batch ${batches}: ${works.length} works, ${items.length} with OL authors${dryRun ? ' (dry run)' : ''}`);
    await sleep(DELAY_MS);
  }

  console.log(`\nDone. ${batches} batches, ${dryRun ? 'nothing written' : `${linked} works linked`}, ${missing} without OL author data.`);
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
