import { Tabs } from 'expo-router/js-tabs';
import { TabBar } from '../../components/TabBar';
import { colors, fonts } from '../../lib/theme';

export default function AppLayout() {
  return (
    <Tabs
      tabBar={(props) => <TabBar {...props} />}
      screenOptions={{
        headerShown: true,
        headerTitle: 'sharedShelf',
        headerStyle: { backgroundColor: colors.background },
        headerShadowVisible: false,
        headerTitleStyle: { fontFamily: fonts.semibold, color: colors.text, fontSize: 17 },
      }}
    >
      <Tabs.Screen name="index" options={{ title: 'My Shelf' }} />
      <Tabs.Screen name="add-book" options={{ title: 'Add Book' }} />
      <Tabs.Screen name="friends" options={{ title: 'Friends' }} />
      <Tabs.Screen name="profile" options={{ title: 'Profile' }} />
      <Tabs.Screen name="add-friend" options={{ href: null, title: 'Add a Friend' }} />
      <Tabs.Screen name="book/[id]" options={{ href: null, title: 'Book' }} />
      <Tabs.Screen name="author/[name]" options={{ href: null, title: 'Author' }} />
      <Tabs.Screen name="profile/settings" options={{ href: null, title: 'Edit Profile' }} />
      <Tabs.Screen name="profile/[id]" options={{ href: null, title: 'Profile' }} />
    </Tabs>
  );
}
