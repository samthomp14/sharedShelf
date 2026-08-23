import { Tabs } from 'expo-router';
import { View } from 'react-native';
import { colors, fonts } from '../../lib/theme';

function TabDot({ focused }: { focused: boolean }) {
  return (
    <View
      style={{
        width: 6,
        height: 6,
        backgroundColor: focused ? colors.text : colors.textFaint,
      }}
    />
  );
}

export default function AppLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: true,
        headerStyle: { backgroundColor: colors.background },
        headerShadowVisible: false,
        headerTitleStyle: { fontFamily: fonts.semibold, color: colors.text, fontSize: 17 },
        // Each tab item reserves a fixed 28px icon slot regardless of what
        // tabBarIcon renders (hardcoded in the library's TabBarIcon wrapper
        // style) — so the per-tab content height needs to be at least
        // ~28px + a real label line-height, or the label collapses. Content
        // height here is 72 - 6 - 10 = 56px: 28 for the icon slot, 28 for
        // the label. Rather than leave that 28px slot empty (which reads as
        // a stray gap above the label), it holds a small square dot.
        tabBarStyle: {
          backgroundColor: colors.background,
          borderTopColor: colors.border,
          height: 72,
          paddingTop: 6,
          paddingBottom: 10,
        },
        tabBarLabelStyle: { fontFamily: fonts.medium, fontSize: 12 },
        tabBarActiveTintColor: colors.text,
        tabBarInactiveTintColor: colors.textFaint,
        tabBarIcon: ({ focused }) => <TabDot focused={focused} />,
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
