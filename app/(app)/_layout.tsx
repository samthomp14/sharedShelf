import { Stack } from 'expo-router';
import { colors, fonts } from '../../lib/theme';

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
