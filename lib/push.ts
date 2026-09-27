// Web push: the service worker (public/sw.js), this device's subscription
// (push_subscriptions), and the account's per-kind switches
// (notification_prefs). The server side is the push_outbox triggers plus the
// send-push edge function.
//
// Everything here is web-only and safe to call on native or during static
// rendering: it reports 'unsupported' and does nothing.

import { useCallback, useEffect, useState } from 'react';
import { Platform } from 'react-native';
import { router } from 'expo-router';
import { supabase } from './supabase';
import { log } from './log';
import { isIOSSafari, isStandalone } from './pwa';

// Public half of the VAPID pair; the private half is an edge function secret.
const VAPID_PUBLIC_KEY =
  'BBtOOuSuACjAwHOXJxuTZk_x8QyFploZTwivB4Py3gta9u7TqhEeM1LbY3bD-Cs9BL98WEySHQc1-RQB9EHOAUI';

// 'needs-install': iPhone Safari in a tab — push only works from the home screen.
// 'off': could be turned on (not asked yet, or allowed but this device isn't subscribed).
export type PushState = 'loading' | 'unsupported' | 'needs-install' | 'off' | 'on' | 'denied';

function hasWindow(): boolean {
  return Platform.OS === 'web' && typeof window !== 'undefined';
}

function pushCapable(): boolean {
  return (
    hasWindow() &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  );
}

function site(): 'prod' | 'staging' {
  return hasWindow() && window.location.hostname.includes('staging') ? 'staging' : 'prod';
}

function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padded = (base64 + '='.repeat((4 - (base64.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(padded);
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

let registration: Promise<ServiceWorkerRegistration | null> | null = null;

function registerWorker(): Promise<ServiceWorkerRegistration | null> {
  if (!pushCapable()) return Promise.resolve(null);
  if (!registration) {
    registration = navigator.serviceWorker.register('/sw.js').catch((e) => {
      log.warn('push.register_failed', { error: String(e) });
      registration = null;
      return null;
    });
  }
  return registration;
}

async function saveSubscription(sub: PushSubscription): Promise<void> {
  const { data: auth } = await supabase.auth.getUser();
  const uid = auth.user?.id;
  const json = sub.toJSON();
  if (!uid || !json.endpoint || !json.keys?.p256dh || !json.keys?.auth) return;
  const { error } = await supabase.from('push_subscriptions').upsert(
    {
      user_id: uid,
      endpoint: json.endpoint,
      p256dh: json.keys.p256dh,
      auth: json.keys.auth,
      site: site(),
      user_agent: navigator.userAgent.slice(0, 300),
      last_seen_at: new Date().toISOString(),
    },
    { onConflict: 'endpoint' }
  );
  if (error) log.warn('push.save_failed', { error: error.message });
}

export async function getPushState(): Promise<PushState> {
  if (!hasWindow()) return 'unsupported';
  if (isIOSSafari() && !isStandalone()) return 'needs-install';
  if (!pushCapable()) return 'unsupported';
  if (Notification.permission === 'denied') return 'denied';
  if (Notification.permission !== 'granted') return 'off';
  const reg = await registerWorker();
  const sub = await reg?.pushManager.getSubscription();
  return sub ? 'on' : 'off';
}

// Call straight from a tap: iOS only shows the permission prompt for a user
// gesture, so the request comes before anything else is awaited.
export async function enablePush(): Promise<PushState> {
  if (!pushCapable()) return getPushState();
  let permission: NotificationPermission;
  try {
    permission = await Notification.requestPermission();
  } catch (e) {
    log.warn('push.permission_failed', { error: String(e) });
    return getPushState();
  }
  if (permission !== 'granted') return permission === 'denied' ? 'denied' : 'off';

  try {
    const reg = await registerWorker();
    if (!reg) return 'unsupported';
    await navigator.serviceWorker.ready;
    const sub =
      (await reg.pushManager.getSubscription()) ??
      (await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
      }));
    await saveSubscription(sub);
    return 'on';
  } catch (e) {
    log.error('push.subscribe_failed', { error: String(e) });
    return 'off';
  }
}

// Turns push off on this device only (the account's switches stay as they are).
export async function disablePush(): Promise<PushState> {
  const reg = await registerWorker();
  const sub = await reg?.pushManager.getSubscription();
  if (sub) {
    const { error } = await supabase.from('push_subscriptions').delete().eq('endpoint', sub.endpoint);
    if (error) log.warn('push.delete_failed', { error: error.message });
    await sub.unsubscribe().catch(() => {});
  }
  return getPushState();
}

// --- State hook, shared by every prompt and the settings section ----------

let current: PushState = 'loading';
const stateListeners = new Set<(state: PushState) => void>();

function setShared(state: PushState) {
  current = state;
  stateListeners.forEach((listener) => listener(state));
}

export function usePushState(): {
  state: PushState;
  busy: boolean;
  enable: () => Promise<PushState>;
  disable: () => Promise<PushState>;
} {
  const [state, setState] = useState<PushState>(current);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    stateListeners.add(setState);
    getPushState().then(setShared);
    return () => {
      stateListeners.delete(setState);
    };
  }, []);

  const enable = useCallback(async () => {
    setBusy(true);
    const next = await enablePush();
    setShared(next);
    setBusy(false);
    return next;
  }, []);

  const disable = useCallback(async () => {
    setBusy(true);
    const next = await disablePush();
    setShared(next);
    setBusy(false);
    return next;
  }, []);

  return { state, busy, enable, disable };
}

// --- App-level setup -----------------------------------------------------

const pushListeners = new Set<() => void>();

// Called when a push arrives while the app is open (the bell and the
// Notifications screen reload).
export function onPushReceived(listener: () => void): () => void {
  pushListeners.add(listener);
  return () => {
    pushListeners.delete(listener);
  };
}

// Mount once inside the signed-in app: registers the worker, refreshes this
// device's subscription row, and handles messages from the worker.
export function usePushSetup(uid: string | null) {
  useEffect(() => {
    if (!uid || !pushCapable()) return;
    let cancelled = false;

    registerWorker().then(async (reg) => {
      if (cancelled || !reg || Notification.permission !== 'granted') return;
      const sub = await reg.pushManager.getSubscription();
      if (sub) await saveSubscription(sub);
    });

    function onMessage(event: MessageEvent) {
      const data = event.data as { type?: string; url?: string } | null;
      if (data?.type === 'push') {
        pushListeners.forEach((listener) => listener());
      } else if (data?.type === 'open' && data.url) {
        const url = new URL(data.url, window.location.origin);
        if (url.origin === window.location.origin) {
          router.push((url.pathname + url.search) as never);
        }
      }
    }
    navigator.serviceWorker.addEventListener('message', onMessage);
    return () => {
      cancelled = true;
      navigator.serviceWorker.removeEventListener('message', onMessage);
    };
  }, [uid]);
}

// The home-screen icon's count (installed app only; ignored elsewhere).
export function setAppBadge(count: number) {
  if (!hasWindow()) return;
  const nav = navigator as Navigator & {
    setAppBadge?: (n: number) => Promise<void>;
    clearAppBadge?: () => Promise<void>;
  };
  try {
    if (count > 0) nav.setAppBadge?.(count)?.catch(() => {});
    else nav.clearAppBadge?.()?.catch(() => {});
  } catch {
    // Not supported.
  }
}

// --- Per-kind switches (account-wide) --------------------------------------

export type PrefKey = 'borrow_requests' | 'your_requests' | 'loans' | 'friends';
export type Prefs = Record<PrefKey, boolean>;

const DEFAULT_PREFS: Prefs = { borrow_requests: true, your_requests: true, loans: true, friends: true };

export function useNotificationPrefs(uid: string | null): {
  prefs: Prefs;
  setPref: (key: PrefKey, value: boolean) => void;
} {
  const [prefs, setPrefs] = useState<Prefs>(DEFAULT_PREFS);

  useEffect(() => {
    if (!uid) return;
    supabase
      .from('notification_prefs')
      .select('borrow_requests, your_requests, loans, friends')
      .eq('user_id', uid)
      .maybeSingle()
      .then(({ data, error }) => {
        if (error) log.warn('push.prefs_load_failed', { error: error.message });
        if (data) setPrefs(data);
      });
  }, [uid]);

  const setPref = useCallback(
    (key: PrefKey, value: boolean) => {
      if (!uid) return;
      setPrefs((prev) => {
        const next = { ...prev, [key]: value };
        supabase
          .from('notification_prefs')
          .upsert({ user_id: uid, ...next, updated_at: new Date().toISOString() })
          .then(({ error }) => {
            if (error) {
              log.warn('push.prefs_save_failed', { error: error.message });
              setPrefs(prev);
            }
          });
        return next;
      });
    },
    [uid]
  );

  return { prefs, setPref };
}

// --- Prompt dismissals (per device) ------------------------------------------

const CARD_KEY = 'sharedshelf.push-card-dismissed-at';
const AFTER_REQUEST_KEY = 'sharedshelf.push-after-request-dismissed';
const CARD_SNOOZE_MS = 30 * 24 * 60 * 60 * 1000;

function readStorage(key: string): string | null {
  try {
    return hasWindow() ? window.localStorage.getItem(key) : null;
  } catch {
    return null;
  }
}

function writeStorage(key: string, value: string) {
  try {
    if (hasWindow()) window.localStorage.setItem(key, value);
  } catch {
    // Private mode etc. — the prompt just comes back.
  }
}

export function cardDismissed(): boolean {
  const at = Number(readStorage(CARD_KEY));
  return Number.isFinite(at) && at > 0 && Date.now() - at < CARD_SNOOZE_MS;
}

export function dismissCard() {
  writeStorage(CARD_KEY, String(Date.now()));
}

export function afterRequestDismissed(): boolean {
  return readStorage(AFTER_REQUEST_KEY) !== null;
}

export function dismissAfterRequest() {
  writeStorage(AFTER_REQUEST_KEY, '1');
}
