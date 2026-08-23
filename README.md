# sharedShelf

A social app for readers: catalog the physical books you own, see what your friends
have on their shelves, and ask to borrow — hand to hand, no shipping, no strangers.

## Stack

- [Expo](https://expo.dev) (React Native) + [expo-router](https://docs.expo.dev/router/introduction/) for the app and file-based navigation
- [Supabase](https://supabase.com) for auth, Postgres, and row-level security

## Getting started

1. Copy `.env.example` to `.env` and fill in:
   - `EXPO_PUBLIC_SUPABASE_URL` ← your Supabase project's **URL** (from the dashboard)
   - `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY` ← your Supabase project's **Publishable key** (from the dashboard)
   
   Both are in Project Settings → API.
2. Run `supabase/schema.sql` in the Supabase SQL editor. It creates the tables, enums,
   RLS policies, the trigger that creates a `profiles` row on signup (using the
   `username` passed at sign-up), and the triggers that keep a shelf item's status in
   sync as a loan request moves through pending → accepted/declined → returned.
   Optionally, run `supabase/seed.sql` afterward to add a handful of fake users
   (with a few books each) you can search for and friend while testing locally.
3. Install dependencies and start the dev server:

   ```sh
   npm install
   npm start
   ```

## Deploying the web build (Vercel)

The app also runs as a web SPA (`react-native-web`), which can be hosted anywhere
that serves static files. `vercel.json` is already set up for this — it builds
with `expo export -p web` and rewrites all paths to `index.html` (needed since
this is a single-page app: there's no real `/friends/index.html` file, expo-router
handles that routing client-side).

1. Install the Vercel CLI if you don't have it, and log in (opens your browser):

   ```sh
   npx vercel login
   ```

2. In the Vercel dashboard, add these two Environment Variables to the project
   (Settings → Environment Variables) with the same values as your `.env` —
   they get baked into the JS bundle at **build** time, so they must be set in
   Vercel's build environment, not just your local machine:
   - `EXPO_PUBLIC_SUPABASE_URL`
   - `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY`

3. Deploy from the repo root:

   ```sh
   npx vercel --prod
   ```

   Or connect the GitHub repo in the Vercel dashboard instead, for automatic
   deploys on every push.

Bonus: Vercel gives you HTTPS automatically, which the barcode scanner needs to
access the camera on a phone browser (camera access is blocked on plain HTTP
except on `localhost`).

## Project layout

- `app/` — expo-router screens
  - `(auth)/sign-in.tsx` — sign in, and sign up with username + confirm-password
  - `(app)/` — tab navigator, gated behind an active session
    - `index.tsx` — My Shelf: your books, incoming loan requests (accept/decline),
      "mark returned" for anything currently on loan
    - `friends.tsx` — accepted friends, incoming friend requests (accept/decline)
    - `friend/[id].tsx` — a friend's shelf, with "ask to borrow"
    - `add-book.tsx` — add-to-shelf form: scan a barcode or type an ISBN
      (looks up title/authors/cover via Open Library) with manual entry as a fallback
    - `add-friend.tsx` — search by username, send a friend request
    - `profile.tsx` — view/edit your username, display name, and email; sign out
- `contexts/AuthContext.tsx` — Supabase session state
- `lib/supabase.ts` — Supabase client
- `lib/theme.ts` — shared design tokens (colors, Funnel Sans, sharp-corner/shadow style)
- `components/Button.tsx`, `components/Chip.tsx` — shared UI pieces
- `lib/database.types.ts` — hand-written types matching `supabase/schema.sql`; once the
  project is linked via the Supabase CLI, regenerate with:

  ```sh
  supabase gen types typescript --linked > lib/database.types.ts
  ```

- `supabase/schema.sql` — full schema: `profiles`, `books`, `shelf_items`,
  `friendships`, `loan_requests`, `loans`, RLS policies, and lifecycle triggers
- `supabase/seed.sql` — optional fake users + books for local testing (dev only)

## Data model

- **books** — canonical metadata cache (title, authors, cover, ISBN), deduped by
  ISBN. Populated via Open Library lookup (scan or type an ISBN) or manual entry.
- **shelf_items** — a physical copy a user owns, pointing at a `book`. Status is
  `available` / `requested` / `on_loan`, kept in sync automatically by triggers as
  loan requests are made, accepted/declined, or returned — the client never sets
  this directly.
- **friendships** — `pending`/`accepted` connection between two users; shelf
  visibility is scoped to accepted friends only.
- **loan_requests** — a friend asking to borrow a shelf item. Inserting one flips
  the shelf item to `requested`; accepting creates a `loans` row and flips it to
  `on_loan`; declining/cancelling flips it back to `available`.
- **loans** — the actual hand-off once a request is accepted; setting
  `returned_at` flips the shelf item back to `available`.

## Not yet built

- Push notifications for new requests
- Cancelling a friend request you sent, or a loan request you sent, from the UI
- Searching your shelf / a friend's shelf
- Cover-grid view of a shelf (currently a text list only)
- Custom sort order / grouping for shelf items
- A `publisher` field isn't in the schema — search will initially cover
  title/author only
