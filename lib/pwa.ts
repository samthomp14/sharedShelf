// Web-only helpers for running as an installed home-screen app (PWA).
// Every function here is safe to call on native and during static rendering:
// they bail out unless we're on web *and* have a real `window`.

import { useEffect, useState } from 'react';
import { Platform } from 'react-native';

function hasWindow(): boolean {
  return Platform.OS === 'web' && typeof window !== 'undefined';
}

// True when launched from the home screen rather than a browser tab.
// `display-mode: standalone` covers Chromium/Android and modern iOS;
// `navigator.standalone` is the older iOS Safari-only flag.
export function isStandalone(): boolean {
  if (!hasWindow()) return false;
  try {
    if (window.matchMedia?.('(display-mode: standalone)').matches) return true;
  } catch {
    // matchMedia unavailable — fall through to the iOS flag.
  }
  return (window.navigator as Navigator & { standalone?: boolean }).standalone === true;
}

// True for Safari proper on iPhone/iPad — the only iOS browser where we show
// "Tap Share, then Add to Home Screen" instructions.
//
// - iPadOS reports itself as desktop Mac ("Macintosh") by default, so a Mac
//   UA with multi-touch is treated as iPad.
// - Chrome/Firefox/Edge/Opera on iOS (CriOS/FxiOS/EdgiOS/OPiOS) are excluded:
//   they can add to home screen on newer iOS, but from a different menu, so
//   the Safari copy would be wrong.
// - In-app browsers (Facebook, Instagram, Google app, LINE…) are excluded:
//   they generally can't add to home screen at all.
export function isIOSSafari(): boolean {
  if (!hasWindow()) return false;
  const nav = window.navigator;
  const ua = nav.userAgent || '';
  const isIOS =
    /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && (nav.maxTouchPoints ?? 0) > 1);
  if (!isIOS) return false;
  if (/CriOS|FxiOS|EdgiOS|OPiOS|GSA\/|FBAN|FBAV|Instagram|Line\//.test(ua)) return false;
  return /Safari\//.test(ua);
}

// --- Android/Chromium install prompt -------------------------------------
// Chromium fires `beforeinstallprompt` once, possibly before any component
// that cares has mounted, so capture it at module load and hand it out later.

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

let deferredPrompt: BeforeInstallPromptEvent | null = null;
const listeners = new Set<() => void>();

function notify() {
  listeners.forEach((listener) => listener());
}

if (hasWindow()) {
  window.addEventListener('beforeinstallprompt', (event) => {
    // Suppress Chrome's own mini-infobar; we show our own banner instead.
    event.preventDefault();
    deferredPrompt = event as BeforeInstallPromptEvent;
    notify();
  });
  window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    notify();
  });
}

// Shows the browser's install dialog. The captured event can only be used
// once, so it's cleared either way. Resolves true if the user accepted.
export async function promptInstall(): Promise<boolean> {
  const event = deferredPrompt;
  if (!event) return false;
  deferredPrompt = null;
  notify();
  try {
    await event.prompt();
    const { outcome } = await event.userChoice;
    return outcome === 'accepted';
  } catch {
    return false;
  }
}

// Whether a captured install prompt is available right now.
export function useInstallPrompt(): { canPrompt: boolean; promptInstall: () => Promise<boolean> } {
  const [canPrompt, setCanPrompt] = useState(() => deferredPrompt !== null);

  useEffect(() => {
    const update = () => setCanPrompt(deferredPrompt !== null);
    listeners.add(update);
    update();
    return () => {
      listeners.delete(update);
    };
  }, []);

  return { canPrompt, promptInstall };
}
