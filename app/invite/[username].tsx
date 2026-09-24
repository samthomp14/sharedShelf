import { Redirect, useLocalSearchParams } from 'expo-router';
import { useAuth } from '../../contexts/AuthContext';

// Invite links: /invite/<username>. Lives outside both protected groups so it
// resolves whether or not you're signed in.
// - signed out: go to sign-up, carrying the inviter so the new account sends
//   them a friend request (see handle_new_user in schema.sql)
// - signed in: just show the inviter's profile, where "Add friend" is
export default function Invite() {
  const { username } = useLocalSearchParams<{ username: string }>();
  const { session } = useAuth();

  if (session) {
    return <Redirect href={{ pathname: '/profile/[username]', params: { username } }} />;
  }
  return <Redirect href={{ pathname: '/sign-in', params: { invite: username } }} />;
}
