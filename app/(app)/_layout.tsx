import { Stack } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, fonts, headerHeight } from '../../lib/theme';

// Keep the tabs underneath every pushed screen, even on a deep link or a
// fresh page load straight to e.g. /book/123. Without this the stack starts
// at that screen, so there's no header back button — and in the installed
// home-screen app there's no browser back button either.
export const unstable_settings = {
  anchor: '(tabs)',
};

export default function AppLayout() {
  const insets = useSafeAreaInsets();

  return (
    <Stack
      screenOptions={{
        // On web the native stack renders React Navigation's JS header, which
        // honors `height` (status-bar inset included) even though the
        // native-stack types only declare backgroundColor — hence the spread.
        headerStyle: { backgroundColor: colors.background, ...{ height: insets.top + headerHeight } },
        headerShadowVisible: false,
        headerTitleStyle: { fontFamily: fonts.semibold, color: colors.text, fontSize: 17 },
        // Pushed screens have no tab bar under them, so keep their content
        // (e.g. Settings' "Sign out") clear of the home indicator.
        contentStyle: { backgroundColor: colors.background, paddingBottom: insets.bottom },
      }}
    >
      {/* The tab bar already pads itself for the home indicator. */}
      <Stack.Screen
        name="(tabs)"
        options={{ headerShown: false, contentStyle: { backgroundColor: colors.background } }}
      />
      <Stack.Screen name="book/[id]" options={{ title: 'Book' }} />
      <Stack.Screen name="author/[name]" options={{ title: 'Author' }} />
      <Stack.Screen name="profile/[username]" options={{ title: 'Profile' }} />
      <Stack.Screen name="profile/settings" options={{ title: 'Edit Profile' }} />
      <Stack.Screen name="profile/friends" options={{ title: 'Friends' }} />
    </Stack>
  );
}
