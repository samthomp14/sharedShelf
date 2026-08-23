import { Tabs } from 'expo-router';

export default function AppLayout() {
  return (
    <Tabs screenOptions={{ headerShown: true }}>
      <Tabs.Screen name="index" options={{ title: 'My Shelf' }} />
      <Tabs.Screen name="friends" options={{ title: 'Friends' }} />
      <Tabs.Screen name="friend/[id]" options={{ href: null, title: 'Shelf' }} />
    </Tabs>
  );
}
