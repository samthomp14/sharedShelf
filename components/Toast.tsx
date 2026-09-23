import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Animated, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, fonts, radius, shadow } from '../lib/theme';

// Small toast: one at a time (a new one replaces whatever's showing),
// auto-hides, optional single action like "Undo".
//
// Wrap a screen's content in <ToastProvider>; the toast is drawn inside the
// provider's own box, so it sits above whatever that screen renders. A Modal
// covers everything outside it (on web it's a portal on <body>), so screens
// that open a Modal and want toasts in it nest a second provider inside the
// Modal's content — see ScannerModal.

export interface ToastOptions {
  message: string;
  actionLabel?: string;
  onAction?: () => void;
  durationMs?: number;
}

interface ToastContextValue {
  show: (options: ToastOptions) => void;
}

const DEFAULT_DURATION_MS = 4000;
const SLIDE_DISTANCE = 16;

const ToastContext = createContext<ToastContextValue | null>(null);

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used inside a ToastProvider');
  return ctx;
}

interface ToastProviderProps {
  children: ReactNode;
  // 'bottom' (default) is for tab screens: the tab bar lives below the
  // screen and already pads for the home indicator, so no inset is needed.
  // 'top' is for full-screen Modals whose bottom is taken by their own UI;
  // it clears the status bar/notch via the safe-area inset.
  position?: 'top' | 'bottom';
}

interface ActiveToast extends ToastOptions {
  id: number;
}

export function ToastProvider({ children, position = 'bottom' }: ToastProviderProps) {
  const insets = useSafeAreaInsets();
  const [toast, setToast] = useState<ActiveToast | null>(null);
  const anim = useRef(new Animated.Value(0)).current;
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const idRef = useRef(0);

  const clearTimer = useCallback(() => {
    if (hideTimerRef.current) {
      clearTimeout(hideTimerRef.current);
      hideTimerRef.current = null;
    }
  }, []);

  const hide = useCallback(
    (id: number) => {
      clearTimer();
      Animated.timing(anim, { toValue: 0, duration: 180, useNativeDriver: false }).start(() => {
        // Only clear if nothing newer replaced this toast mid-fade.
        setToast((current) => (current?.id === id ? null : current));
      });
    },
    [anim, clearTimer]
  );

  const show = useCallback(
    (options: ToastOptions) => {
      clearTimer();
      const id = ++idRef.current;
      setToast({ ...options, id });
      anim.stopAnimation();
      Animated.timing(anim, { toValue: 1, duration: 200, useNativeDriver: false }).start();
      hideTimerRef.current = setTimeout(() => hide(id), options.durationMs ?? DEFAULT_DURATION_MS);
    },
    [anim, clearTimer, hide]
  );

  useEffect(() => clearTimer, [clearTimer]);

  const value = useMemo(() => ({ show }), [show]);

  const isTop = position === 'top';
  const translateY = anim.interpolate({
    inputRange: [0, 1],
    outputRange: [isTop ? -SLIDE_DISTANCE : SLIDE_DISTANCE, 0],
  });

  return (
    <ToastContext.Provider value={value}>
      <View style={styles.container}>
        {children}
        {toast && (
          <Animated.View
            pointerEvents="box-none"
            style={[
              styles.host,
              isTop ? { top: insets.top + 12 } : { bottom: 16 },
              { opacity: anim, transform: [{ translateY }] },
            ]}
          >
            <View style={styles.toast}>
              <Text style={styles.message} numberOfLines={2}>
                {toast.message}
              </Text>
              {toast.actionLabel && toast.onAction && (
                <Pressable
                  hitSlop={8}
                  onPress={() => {
                    const action = toast.onAction;
                    hide(toast.id);
                    action?.();
                  }}
                >
                  <Text style={styles.action}>{toast.actionLabel}</Text>
                </Pressable>
              )}
            </View>
          </Animated.View>
        )}
      </View>
    </ToastContext.Provider>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  host: {
    position: 'absolute',
    left: 16,
    right: 16,
    alignItems: 'center',
  },
  toast: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    maxWidth: 480,
    backgroundColor: colors.text,
    borderRadius: radius.md,
    paddingVertical: 12,
    paddingHorizontal: 16,
    ...shadow,
  },
  message: {
    flexShrink: 1,
    fontFamily: fonts.medium,
    fontSize: 14,
    color: colors.background,
  },
  action: {
    fontFamily: fonts.semibold,
    fontSize: 14,
    color: colors.background,
    textDecorationLine: 'underline',
  },
});
