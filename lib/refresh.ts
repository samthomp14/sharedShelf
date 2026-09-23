import { useCallback, useRef, useState } from 'react';
import { Platform } from 'react-native';
import { useFocusEffect } from 'expo-router';

// Pull-to-refresh state, kept separate from a screen's own `loading` flag so
// the spinner only shows when the user actually pulled — not on every
// background refetch when the screen regains focus.
export function useRefreshing(refetch: () => Promise<unknown>) {
  const [refreshing, setRefreshing] = useState(false);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await refetch();
    } finally {
      setRefreshing(false);
    }
  }, [refetch]);

  return { refreshing, onRefresh };
}

// On web, refetch when the page comes back after being hidden for a while —
// e.g. reopening the home-screen app, where there's no reload button. Only
// the focused screen listens, so background tabs don't all refetch at once.
export function useRefetchOnVisible(refetch: () => unknown, minHiddenMs = 60_000) {
  const refetchRef = useRef(refetch);
  refetchRef.current = refetch;

  useFocusEffect(
    useCallback(() => {
      if (Platform.OS !== 'web' || typeof document === 'undefined') return;

      let hiddenAt: number | null = document.visibilityState === 'hidden' ? Date.now() : null;

      function onVisibilityChange() {
        if (document.visibilityState === 'hidden') {
          hiddenAt = Date.now();
        } else if (hiddenAt !== null) {
          const hiddenFor = Date.now() - hiddenAt;
          hiddenAt = null;
          if (hiddenFor >= minHiddenMs) refetchRef.current();
        }
      }

      document.addEventListener('visibilitychange', onVisibilityChange);
      return () => document.removeEventListener('visibilitychange', onVisibilityChange);
    }, [minHiddenMs])
  );
}
