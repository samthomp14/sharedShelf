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
        // react-navigation normally sizes the tab bar as 49 + insets.bottom,
        // but that only helps when insets.bottom is real — in a browser
        // (including device-emulation views), there's no way for the page to
        // detect a simulated home-indicator overlay, so insets.bottom reports
        // 0 and labels end up sitting under it. A fixed, generous height that
        // doesn't depend on insets at all sidesteps that entirely.
        tabBarStyle: {
          backgroundColor: colors.background,
          borderTopColor: colors.border,
          height: 78,
          paddingTop: 10,
          paddingBottom: 28,
        },
        tabBarLabelStyle: { fontFamily: fonts.medium, fontSize: 12 },
        tabBarActiveTintColor: colors.text,
        tabBarInactiveTintColor: colors.textFaint,
        tabBarIcon: () => null,
      }}
    >
      <Tabs.Screen name="index" options={{ title: 'My Shelf' }} />
      <Tabs.Screen name="add-book" options={{ title: 'Add Book' }} />
      <Tabs.Screen name="friends" options={{ title: 'Friends' }} />
      <Tabs.Screen name="profile" options={{ title: 'Profile' }} />
      <Tabs.Screen name="friend/[id]" options={{ href: null, title: 'Shelf' }} />
      <Tabs.Screen name="add-friend" options={{ href: null, title: 'Add a Friend' }} />
    </Tabs>
  );
}
