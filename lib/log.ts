import { supabase } from './supabase';
import type { Json } from './database.types';

// Client logging. Everything goes to the console; warnings and errors are
// also sent to the client_logs table, since the app mostly runs as an iPhone
// home-screen web app where there's no console to read. Sending is
// fire-and-forget and never throws — logging must not break the app.

type Level = 'info' | 'warn' | 'error';
type Detail = Record<string, unknown>;

const MAX_DETAIL_CHARS = 3500;

function toDetail(detail?: Detail): Json | null {
  if (!detail) return null;
  // Errors don't serialize on their own; keep their name + message.
  const plain = Object.fromEntries(
    Object.entries(detail).map(([key, value]) => [
      key,
      value instanceof Error ? { name: value.name, message: value.message } : value,
    ])
  );
  const json = JSON.stringify(plain);
  // Round-trip so what we store is exactly what's JSON-serializable.
  return json.length <= MAX_DETAIL_CHARS
    ? (JSON.parse(json) as Json)
    : { truncated: json.slice(0, MAX_DETAIL_CHARS) };
}

function send(level: Level, event: string, detail?: Detail) {
  const payload = toDetail(detail);
  const consoleFn = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
  consoleFn(`[${event}]`, payload ?? '');

  if (level === 'info') return;
  const userAgent = typeof navigator !== 'undefined' ? navigator.userAgent?.slice(0, 500) : null;
  supabase
    .from('client_logs')
    .insert({ level, event: event.slice(0, 100), detail: payload, user_agent: userAgent })
    .then(({ error }) => {
      if (error) console.warn('[log] failed to send', error.message);
    });
}

export const log = {
  info: (event: string, detail?: Detail) => send('info', event, detail),
  warn: (event: string, detail?: Detail) => send('warn', event, detail),
  error: (event: string, detail?: Detail) => send('error', event, detail),
};
