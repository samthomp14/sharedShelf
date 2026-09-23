import { Tabs } from 'expo-router/js-tabs';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { TabBar } from '../../../components/TabBar';
import { colors, fonts, headerHeight } from '../../../lib/theme';

export default function TabsLayout() {
  const insets = useSafeAreaInsets();

  return (
    <Tabs
      tabBar={(props) => <TabBar {...props} />}
      screenOptions={{
        headerShown: true,
        headerTitle: 'sharedShelf',
        // `height` includes the status-bar inset the header pads itself with.
        headerStyle: { backgroundColor: colors.background, height: insets.top + headerHeight },
        headerShadowVisible: false,
        headerTitleStyle: { fontFamily: fonts.displayItalic, color: colors.text, fontSize: 19 },
        sceneStyle: { backgroundColor: colors.background },
      }}
    >
      <Tabs.Screen name="index" options={{ title: 'Activity' }} />
      <Tabs.Screen name="add-book" options={{ title: 'Add Book' }} />
      <Tabs.Screen name="search" options={{ title: 'Search' }} />
      <Tabs.Screen name="profile" options={{ title: 'Profile' }} />
    </Tabs>
  );
}
