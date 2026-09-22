import type { Href } from 'expo-router';

// Carries whatever the list/feed already had for this person (display name,
// avatar) as route params, so the profile screen can paint immediately
// instead of going blank until its own fetch resolves.
export function profileHref(
  username: string,
  displayName?: string | null,
  avatarUrl?: string | null
): Href {
  return {
    pathname: '/profile/[username]',
    params: {
      username,
      displayName: displayName ?? '',
      avatarUrl: avatarUrl ?? '',
    },
  };
}
