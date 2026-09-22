import { Tabs } from 'expo-router/js-tabs';
import { TabBar } from '../../../components/TabBar';
import { colors, fonts } from '../../../lib/theme';

export default function TabsLayout() {
  return (
    <Tabs
      tabBar={(props) => <TabBar {...props} />}
      screenOptions={{
        headerShown: true,
        headerTitle: 'sharedShelf',
        headerStyle: { backgroundColor: colors.background },
        headerShadowVisible: false,
        headerTitleStyle: { fontFamily: fonts.displayItalic, color: colors.text, fontSize: 19 },
      }}
    >
      <Tabs.Screen name="index" options={{ title: 'Activity' }} />
      <Tabs.Screen name="add-book" options={{ title: 'Add Book' }} />
      <Tabs.Screen name="search" options={{ title: 'Search' }} />
      <Tabs.Screen name="profile" options={{ title: 'Profile' }} />
    </Tabs>
  );
}
