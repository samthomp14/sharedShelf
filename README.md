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
2. Run `supabase/schema.sql` in the Supabase SQL editor to create the tables, enums,
   RLS policies, and the trigger that creates a `profiles` row on signup.
3. Install dependencies and start the dev server:

   ```sh
   npm install
   npm start
   ```

## Project layout

- `app/` — expo-router screens
  - `(auth)/sign-in.tsx` — email/password sign in and sign up
  - `(app)/` — tab navigator, gated behind an active session
    - `index.tsx` — My Shelf
    - `friends.tsx` — accepted friends list
    - `friend/[id].tsx` — a friend's shelf, with "ask to borrow"
- `contexts/AuthContext.tsx` — Supabase session state
- `lib/supabase.ts` — Supabase client
- `lib/database.types.ts` — hand-written types matching `supabase/schema.sql`; once the
  project is linked via the Supabase CLI, regenerate with:

  ```sh
  supabase gen types typescript --linked > lib/database.types.ts
  ```

- `supabase/schema.sql` — full schema: `profiles`, `books`, `shelf_items`,
  `friendships`, `loan_requests`, `loans`, plus RLS policies

## Data model

- **books** — canonical metadata cache (title, authors, cover, ISBN), meant to be
  populated from a lookup API (Open Library primary, Google Books fallback) once
  ISBN scanning is wired up.
- **shelf_items** — a physical copy a user owns, pointing at a `book`. Status is
  `available` / `requested` / `on_loan`.
- **friendships** — accepted connections; shelf visibility is scoped to friends only.
- **loan_requests** — a friend asking to borrow a shelf item.
- **loans** — the actual hand-off once a request is accepted; `returned_at` is set
  when the book comes back.

## Not yet built

- ISBN/barcode scanning + book metadata lookup (add-to-shelf flow)
- Friend requests (the friends screen currently only reads *accepted* friendships)
- Accepting/declining loan requests and marking a loan returned
- Push notifications for new requests
