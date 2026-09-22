import { useEffect, useRef, useState } from 'react';
import {
  Animated,
  type LayoutChangeEvent,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { BottomTabBarProps } from 'expo-router/js-tabs';
import { colors, fonts } from '../lib/theme';

interface Measurement {
  x: number;
  width: number;
}

export function TabBar({ state, descriptors, navigation }: BottomTabBarProps) {
  const insets = useSafeAreaInsets();
  const [measurements, setMeasurements] = useState<Record<string, Measurement>>({});
  const indicatorX = useRef(new Animated.Value(0)).current;
  const indicatorWidth = useRef(new Animated.Value(0)).current;
  const hasMeasuredOnce = useRef(false);

  const activeRoute = state.routes[state.index];
  const activeMeasurement = measurements[activeRoute.key];

  useEffect(() => {
    if (!activeMeasurement) return;

    if (!hasMeasuredOnce.current) {
      // Snap to position on first measurement instead of animating in from 0.
      indicatorX.setValue(activeMeasurement.x);
      indicatorWidth.setValue(activeMeasurement.width);
      hasMeasuredOnce.current = true;
      return;
    }

    Animated.parallel([
      Animated.timing(indicatorX, {
        toValue: activeMeasurement.x,
        duration: 200,
        useNativeDriver: false,
      }),
      Animated.timing(indicatorWidth, {
        toValue: activeMeasurement.width,
        duration: 200,
        useNativeDriver: false,
      }),
    ]).start();
  }, [activeMeasurement?.x, activeMeasurement?.width, indicatorX, indicatorWidth]);

  return (
    <View style={[styles.container, { paddingBottom: insets.bottom }]}>
      <View style={styles.indicatorTrack}>
        <Animated.View
          style={[
            styles.indicator,
            { transform: [{ translateX: indicatorX }], width: indicatorWidth },
          ]}
        />
      </View>
      <View style={styles.row}>
        {state.routes.map((route) => {
          const { options } = descriptors[route.key];
          const label = typeof options.title === 'string' ? options.title : route.name;
          const isActive = route.key === activeRoute.key;

          return (
            <Pressable
              key={route.key}
              onPress={() => {
                const event = navigation.emit({
                  type: 'tabPress',
                  target: route.key,
                  canPreventDefault: true,
                });
                if (!isActive && !event.defaultPrevented) {
                  navigation.navigate(route.name);
                }
              }}
              onLayout={(e: LayoutChangeEvent) => {
                const { x, width } = e.nativeEvent.layout;
                setMeasurements((prev) => ({ ...prev, [route.key]: { x, width } }));
              }}
              style={styles.tab}
            >
              <Text style={[styles.label, isActive && styles.labelActive]}>{label}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: colors.background,
  },
  indicatorTrack: {
    height: 2,
    backgroundColor: colors.border,
  },
  indicator: {
    height: 2,
    backgroundColor: colors.text,
  },
  row: {
    flexDirection: 'row',
  },
  tab: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 14,
  },
  label: {
    fontFamily: fonts.medium,
    fontSize: 13,
    color: colors.textFaint,
  },
  labelActive: {
    fontFamily: fonts.semibold,
    color: colors.text,
  },
});
