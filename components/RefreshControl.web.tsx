import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  ActivityIndicator,
  StyleSheet,
  View,
  type RefreshControlProps,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { colors, shadow } from '../lib/theme';

// react-native-web's RefreshControl is an inert wrapper: it renders the
// ScrollView it's given but never responds to a pull. That matters most in
// the installed home-screen app, which has no browser reload or
// pull-to-refresh of its own. This is a deliberately small touch-only stand-in:
// when the list is scrolled to the top and the user drags down far enough,
// call onRefresh. Mouse/trackpad users on desktop still have browser reload.
//
// Like react-native-web's version, ScrollView clones this element with the
// scroll view's style and passes the scroll view itself as `children`.

const THRESHOLD = 64;
const MAX_PULL = 96;

type Props = RefreshControlProps & {
  children?: ReactNode;
  style?: StyleProp<ViewStyle>;
};

export function RefreshControl({ refreshing, onRefresh, enabled = true, style, children }: Props) {
  const containerRef = useRef<View>(null);
  const [pull, setPull] = useState(0);
  const pullRef = useRef(0);
  const onRefreshRef = useRef(onRefresh);
  onRefreshRef.current = onRefresh;
  const blockedRef = useRef(refreshing || !enabled);
  blockedRef.current = refreshing || !enabled;

  useEffect(() => {
    const container = containerRef.current as unknown as HTMLElement | null;
    if (!container) return;
    // The scroll view is the first child; the indicator is rendered after it.
    const scroller = () => container.firstElementChild as HTMLElement | null;
    let startY: number | null = null;

    const setPullDistance = (value: number) => {
      pullRef.current = value;
      setPull(value);
    };

    function onTouchStart(e: TouchEvent) {
      const el = scroller();
      startY = !blockedRef.current && el && el.scrollTop <= 0 ? e.touches[0].clientY : null;
    }

    function onTouchMove(e: TouchEvent) {
      if (startY === null) return;
      const el = scroller();
      const dy = e.touches[0].clientY - startY;
      if (dy <= 0 || (el && el.scrollTop > 0)) {
        if (pullRef.current !== 0) setPullDistance(0);
        if (dy < 0) startY = null;
        return;
      }
      setPullDistance(Math.min(dy * 0.5, MAX_PULL));
    }

    function onTouchEnd() {
      if (startY !== null && pullRef.current >= THRESHOLD) {
        onRefreshRef.current?.();
      }
      startY = null;
      if (pullRef.current !== 0) setPullDistance(0);
    }

    container.addEventListener('touchstart', onTouchStart, { passive: true });
    container.addEventListener('touchmove', onTouchMove, { passive: true });
    container.addEventListener('touchend', onTouchEnd);
    container.addEventListener('touchcancel', onTouchEnd);
    return () => {
      container.removeEventListener('touchstart', onTouchStart);
      container.removeEventListener('touchmove', onTouchMove);
      container.removeEventListener('touchend', onTouchEnd);
      container.removeEventListener('touchcancel', onTouchEnd);
    };
  }, []);

  const showIndicator = refreshing || pull > 0;
  const offset = refreshing ? THRESHOLD / 2 : pull / 2;
  const opacity = refreshing ? 1 : Math.min(pull / THRESHOLD, 1);

  return (
    <View ref={containerRef} style={style}>
      {children}
      {showIndicator && (
        <View
          pointerEvents="none"
          style={[styles.indicator, { opacity, transform: [{ translateY: offset }] }]}
        >
          <ActivityIndicator color={colors.text} size="small" />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  indicator: {
    position: 'absolute',
    top: 0,
    left: '50%',
    marginLeft: -18,
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.border,
    ...shadow,
  },
});
