// send-push: turns one push_outbox row into a web push on each of the
// recipient's devices. Called by the dispatch_push trigger (pg_net) with
// {"id": "<outbox id>"} and the x-push-secret header.
//
// Secrets (Edge Functions -> Secrets): VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY,
// VAPID_SUBJECT (mailto: or https: URL), PUSH_WEBHOOK_SECRET (same value as
// the push_webhook_secret Vault secret). SUPABASE_URL and
// SUPABASE_SERVICE_ROLE_KEY are provided by the platform.
//
// The push's `url` is a path; the service worker resolves it against its own
// origin, so a staging subscription opens staging and prod opens prod.
import { createClient } from 'jsr:@supabase/supabase-js@2';
import webpush from 'npm:web-push@3.6.7';

type Kind =
  | 'borrow_request'
  | 'request_accepted'
  | 'request_declined'
  | 'lent_to_you'
  | 'hand_off_called_off'
  | 'friend_request'
  | 'friend_accepted'
  | 'invite_joined'
  | 'return_claimed'
  | 'return_denied';

// Which notification_prefs switch covers each kind.
const PREF: Record<Kind, 'borrow_requests' | 'your_requests' | 'loans' | 'friends'> = {
  borrow_request: 'borrow_requests',
  request_accepted: 'your_requests',
  request_declined: 'your_requests',
  lent_to_you: 'loans',
  hand_off_called_off: 'loans',
  friend_request: 'friends',
  friend_accepted: 'friends',
  invite_joined: 'friends',
  return_claimed: 'loans',
  return_denied: 'loans',
};

interface Person {
  username: string;
  display_name: string | null;
}
interface Book {
  id: string;
  title: string;
  cover_url: string | null;
}

// Same as firstName in lib/loans.ts.
function firstName(p: Person | null): string {
  return (p?.display_name ?? p?.username ?? 'Someone').split(' ')[0];
}

function bookPath(book: Book): string {
  const q = new URLSearchParams({ title: book.title, coverUrl: book.cover_url ?? '' });
  return `/book/${book.id}?${q}`;
}

function profilePath(p: Person | null): string {
  return p ? `/profile/${encodeURIComponent(p.username)}` : '/notifications';
}

function compose(
  kind: Kind,
  actor: Person | null,
  book: Book | null,
  data: Record<string, string>
): { title: string; body: string; url: string; tag: string } {
  const who = firstName(actor);
  const title = book?.title ?? 'a book';
  const onBook = book ? bookPath(book) : '/notifications';
  switch (kind) {
    case 'borrow_request':
      return { title: `${who} wants to borrow ${title}`, body: 'Tap to answer.', url: '/notifications', tag: `request-${data.request_id}` };
    case 'request_accepted':
      return { title: `${who} said yes to ${title}`, body: 'Arrange the hand-off.', url: onBook, tag: `request-${data.request_id}` };
    case 'request_declined':
      return { title: `${who} can't lend ${title} right now`, body: '', url: onBook, tag: `request-${data.request_id}` };
    case 'lent_to_you':
      return { title: `${who} lent you ${title}`, body: 'Enjoy it.', url: onBook, tag: `loan-${data.loan_id}` };
    case 'hand_off_called_off':
      return { title: `${who} called off the ${title} hand-off`, body: '', url: onBook, tag: `loan-${data.loan_id}` };
    case 'return_claimed':
      return { title: `${who} says they returned ${title}`, body: 'Tap to confirm.', url: '/notifications', tag: `loan-${data.loan_id}` };
    case 'return_denied':
      return { title: `${who} says ${title} hasn't come back yet`, body: '', url: onBook, tag: `loan-${data.loan_id}` };
    case 'friend_request':
      return { title: `${who} wants to be friends`, body: 'Tap to answer.', url: '/notifications', tag: `friend-${actor?.username}` };
    case 'friend_accepted':
      return { title: `You and ${who} are now friends`, body: '', url: profilePath(actor), tag: `friend-${actor?.username}` };
    case 'invite_joined':
      return { title: `${who} joined from your invite`, body: "You're now friends.", url: profilePath(actor), tag: `friend-${actor?.username}` };
  }
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  const secret = Deno.env.get('PUSH_WEBHOOK_SECRET');
  if (!secret || req.headers.get('x-push-secret') !== secret) {
    return json(401, { error: 'unauthorized' });
  }

  let id: string | undefined;
  try {
    ({ id } = await req.json());
  } catch {
    // fall through
  }
  if (!id) return json(400, { error: 'missing id' });

  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false },
  });

  const finish = async (fields: { sent_at?: string; error?: string }) => {
    await db.from('push_outbox').update(fields).eq('id', id);
  };

  const { data: row, error: rowError } = await db
    .from('push_outbox')
    .select('id, recipient_id, kind, data, sent_at, actor:profiles!push_outbox_actor_id_fkey(username, display_name), book:books(id, title, cover_url)')
    .eq('id', id)
    .maybeSingle();
  if (rowError || !row) return json(404, { error: rowError?.message ?? 'not found' });
  if (row.sent_at) return json(200, { skipped: 'already sent' });

  const kind = row.kind as Kind;

  const { data: prefs } = await db
    .from('notification_prefs')
    .select(PREF[kind])
    .eq('user_id', row.recipient_id)
    .maybeSingle();
  if (prefs && (prefs as Record<string, boolean>)[PREF[kind]] === false) {
    await finish({ sent_at: new Date().toISOString(), error: 'turned off' });
    return json(200, { skipped: 'turned off' });
  }

  const { data: subs } = await db
    .from('push_subscriptions')
    .select('id, endpoint, p256dh, auth')
    .eq('user_id', row.recipient_id);
  if (!subs?.length) {
    await finish({ sent_at: new Date().toISOString(), error: 'no devices' });
    return json(200, { skipped: 'no devices' });
  }

  const { data: badge } = await db.rpc('needs_you_count', { p_user: row.recipient_id });
  const message = compose(
    kind,
    row.actor as unknown as Person | null,
    row.book as unknown as Book | null,
    (row.data ?? {}) as Record<string, string>
  );
  const payload = JSON.stringify({ ...message, badge: badge ?? 0 });

  webpush.setVapidDetails(
    Deno.env.get('VAPID_SUBJECT')!,
    Deno.env.get('VAPID_PUBLIC_KEY')!,
    Deno.env.get('VAPID_PRIVATE_KEY')!
  );

  const failures: string[] = [];
  let delivered = 0;
  await Promise.all(
    subs.map(async (sub) => {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          payload,
          { TTL: 60 * 60 * 24, urgency: 'high', topic: message.tag.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 32) }
        );
        delivered++;
      } catch (e) {
        const status = (e as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) {
          // The device unsubscribed or the subscription expired.
          await db.from('push_subscriptions').delete().eq('id', sub.id);
          failures.push(`gone ${status}`);
        } else {
          failures.push(`${status ?? ''} ${(e as Error).message}`.trim());
        }
      }
    })
  );

  await finish({
    sent_at: new Date().toISOString(),
    error: failures.length ? `${delivered}/${subs.length} sent; ${failures.join('; ')}` : undefined,
  });
  return json(200, { delivered, failed: failures.length });
});
