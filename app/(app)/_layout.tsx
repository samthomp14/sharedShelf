import { Stack } from 'expo-router';
import { colors, fonts } from '../../lib/theme';

// Keep the tabs underneath every pushed screen, even on a deep link or a
// fresh page load straight to e.g. /book/123. Without this the stack starts
// at that screen, so there's no header back button — and in the installed
// home-screen app there's no browser back button either.
export const unstable_settings = {
  anchor: '(tabs)',
};

export default function AppLayout() {
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: colors.background },
        headerShadowVisible: false,
        headerTitleStyle: { fontFamily: fonts.semibold, color: colors.text, fontSize: 17 },
      }}
    >
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen name="book/[id]" options={{ title: 'Book' }} />
      <Stack.Screen name="author/[name]" options={{ title: 'Author' }} />
      <Stack.Screen name="profile/[username]" options={{ title: 'Profile' }} />
      <Stack.Screen name="profile/settings" options={{ title: 'Edit Profile' }} />
      <Stack.Screen name="profile/friends" options={{ title: 'Friends' }} />
    </Stack>
  );
}
