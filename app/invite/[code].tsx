import { useEffect } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { Redirect, useLocalSearchParams, useRouter } from 'expo-router';
import { useAuth } from '../../contexts/AuthContext';
import { supabase } from '../../lib/supabase';
import { log } from '../../lib/log';
import { colors } from '../../lib/theme';

// Invite links: /invite/<code>. Lives outside both protected groups so it
// resolves whether or not you're signed in.
// - signed out: go to sign-up carrying the code; the new account is friended
//   with the inviter on creation (handle_new_user in schema.sql)
// - signed in: redeem the code (friends straight away) and open the
//   inviter's profile. An expired code, or your own, just goes home.
export default function Invite() {
  const { code } = useLocalSearchParams<{ code: string }>();
  const { session } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!session) return;
    let active = true;
    supabase.rpc('redeem_invite', { p_code: code }).then(({ data, error }) => {
      if (!active) return;
      if (error) log.error('invite.redeem_failed', { error: error.message });
      router.replace(
        data ? { pathname: '/profile/[username]', params: { username: data } } : '/'
      );
    });
    return () => {
      active = false;
    };
  }, [session, code, router]);

  if (!session) {
    return <Redirect href={{ pathname: '/sign-in', params: { invite: code } }} />;
  }
  return (
    <View style={styles.centered}>
      <ActivityIndicator color={colors.text} />
    </View>
  );
}

const styles = StyleSheet.create({
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.background,
  },
});
