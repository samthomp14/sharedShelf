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
    </Tabs>
  );
}
