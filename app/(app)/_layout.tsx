import { Tabs } from 'expo-router';
import { colors, fonts } from '../../lib/theme';

export default function AppLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: true,
        headerStyle: { backgroundColor: colors.background },
        headerShadowVisible: false,
        headerTitleStyle: { fontFamily: fonts.semibold, color: colors.text, fontSize: 17 },
        // Deliberately no explicit height/padding here — react-navigation
        // already computes a safe-area-aware tab bar height internally.
        // Setting our own competes with that and can push the bar (and its
        // labels) off-screen entirely depending on platform/inset timing.
        tabBarStyle: { backgroundColor: colors.background, borderTopColor: colors.border },
        tabBarLabelStyle: { fontFamily: fonts.medium, fontSize: 12 },
        tabBarActiveTintColor: colors.text,
        tabBarInactiveTintColor: colors.textFaint,
        tabBarIcon: () => null,
      }}
    >
      <Tabs.Screen name="index" options={{ title: 'My Shelf' }} />
      <Tabs.Screen name="friends" options={{ title: 'Friends' }} />
      <Tabs.Screen name="friend/[id]" options={{ href: null, title: 'Shelf' }} />
      <Tabs.Screen name="add-book" options={{ href: null, title: 'Add a Book' }} />
      <Tabs.Screen name="add-friend" options={{ href: null, title: 'Add a Friend' }} />
      <Tabs.Screen name="profile" options={{ href: null, title: 'Profile' }} />
    </Tabs>
  );
}
