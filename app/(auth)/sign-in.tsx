import { useEffect, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import { log } from '../../lib/log';
import { Button } from '../../components/Button';
import { colors, fonts, radius } from '../../lib/theme';

type Mode = 'sign-in' | 'sign-up' | 'forgot';
type Message = { type: 'error' | 'success'; text: string };

const USERNAME_PATTERN = /^[a-zA-Z0-9_]{3,20}$/;
const INVITE_CODE_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

// From an invite link: who sent it, or 'expired' for an unknown/expired code.
type Invite = { status: 'loading' } | { status: 'valid'; name: string } | { status: 'expired' };

export default function SignIn() {
  // Set when arriving from an invite link (/invite/<code>).
  const params = useLocalSearchParams<{ invite?: string }>();
  const inviteCode = params.invite && INVITE_CODE_PATTERN.test(params.invite) ? params.invite : null;
  const [invite, setInvite] = useState<Invite | null>(inviteCode ? { status: 'loading' } : null);

  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [mode, setMode] = useState<Mode>(inviteCode ? 'sign-up' : 'sign-in');
  const [loading, setLoading] = useState(false);
  const { recoveryError } = useAuth();
  const [message, setMessage] = useState<Message | null>(
    recoveryError ? { type: 'error', text: recoveryError } : null
  );

  useEffect(() => {
    if (!inviteCode) return;
    let active = true;
    supabase.rpc('invite_preview', { p_code: inviteCode }).then(({ data, error }) => {
      if (!active) return;
      if (error) log.warn('invite.preview_failed', { error: error.message });
      const inviter = data?.[0];
      setInvite(
        inviter ? { status: 'valid', name: inviter.display_name ?? `@${inviter.username}` } : { status: 'expired' }
      );
    });
    return () => {
      active = false;
    };
  }, [inviteCode]);

  // Only a code that checked out goes along; an expired one would be
  // ignored by the server anyway.
  const validInviteCode = invite?.status === 'valid' ? inviteCode : null;

  function switchMode(next: Mode) {
    setMode(next);
    setMessage(null);
    setPassword('');
    setConfirmPassword('');
    setUsername('');
  }

  function friendlyError(message: string): string {
    if (message.includes('profiles_username_key')) {
      return 'That username is already taken.';
    }
    return message;
  }

  async function handleSubmit() {
    setMessage(null);

    if (mode === 'forgot') {
      if (!email.trim()) {
        setMessage({ type: 'error', text: 'Enter the email you signed up with.' });
        return;
      }
      setLoading(true);
      // The link comes back to this site's root; AuthProvider picks it up.
      const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
        redirectTo: Platform.OS === 'web' && typeof window !== 'undefined' ? window.location.origin : undefined,
      });
      setLoading(false);
      if (error) {
        log.warn('auth.reset_request_failed', { error: error.message });
        setMessage({ type: 'error', text: error.message });
      } else {
        setMessage({
          type: 'success',
          text: `If there's an account for ${email.trim()}, we sent it a link to reset the password.`,
        });
      }
      return;
    }

    if (mode === 'sign-up') {
      if (!USERNAME_PATTERN.test(username)) {
        setMessage({
          type: 'error',
          text: 'Username must be 3-20 characters: letters, numbers, underscores only.',
        });
        return;
      }
      if (password !== confirmPassword) {
        setMessage({ type: 'error', text: "Passwords don't match." });
        return;
      }
    }

    setLoading(true);

    if (mode === 'sign-in') {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) {
        setMessage({ type: 'error', text: error.message });
      } else if (validInviteCode) {
        // Already had an account: become friends with the inviter now.
        const { error: redeemError } = await supabase.rpc('redeem_invite', { p_code: validInviteCode });
        if (redeemError) log.error('invite.redeem_failed', { error: redeemError.message });
      }
    } else {
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: { data: validInviteCode ? { username, invite_code: validInviteCode } : { username } },
      });
      if (error) {
        setMessage({ type: 'error', text: friendlyError(error.message) });
      } else if (!data.session) {
        // Email confirmation is required — signUp succeeded but there's no
        // session yet. Tell the user to go check their inbox.
        setMessage({
          type: 'success',
          text: `We sent a confirmation link to ${email}. Click it, then sign in below.`,
        });
        switchMode('sign-in');
      }
      // If data.session is set, confirmation is disabled on this project and
      // the AuthProvider's onAuthStateChange listener will pick up the new
      // session and navigate the user in automatically.
    }

    setLoading(false);
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>sharedShelf</Text>
      <Text style={styles.subtitle}>Your friends' shelves, one tap away.</Text>

      {invite?.status === 'valid' && (
        <Text style={styles.invite}>
          {invite.name} invited you. {mode === 'sign-up' ? 'Sign up' : 'Sign in'} and you'll be friends.
        </Text>
      )}
      {invite?.status === 'expired' && (
        <Text style={styles.invite}>That invite link has expired, but you can still sign up.</Text>
      )}

      {mode === 'sign-up' && (
        <TextInput
          style={styles.input}
          placeholder="Username"
          placeholderTextColor={colors.textFaint}
          value={username}
          onChangeText={setUsername}
          autoCapitalize="none"
          autoComplete="username"
        />
      )}
      <TextInput
        style={styles.input}
        placeholder="Email"
        placeholderTextColor={colors.textFaint}
        value={email}
        onChangeText={setEmail}
        autoCapitalize="none"
        keyboardType="email-address"
        autoComplete="email"
      />
      {mode !== 'forgot' && (
        <TextInput
          style={styles.input}
          placeholder="Password"
          placeholderTextColor={colors.textFaint}
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          autoComplete={mode === 'sign-in' ? 'password' : 'new-password'}
        />
      )}
      {mode === 'sign-in' && (
        <Pressable onPress={() => switchMode('forgot')} style={styles.forgot} hitSlop={8}>
          <Text style={styles.forgotText}>Forgot password?</Text>
        </Pressable>
      )}
      {mode === 'sign-up' && (
        <TextInput
          style={styles.input}
          placeholder="Confirm password"
          placeholderTextColor={colors.textFaint}
          value={confirmPassword}
          onChangeText={setConfirmPassword}
          secureTextEntry
          autoComplete="new-password"
        />
      )}

      {message && (
        <Text style={message.type === 'error' ? styles.errorText : styles.successText}>
          {message.text}
        </Text>
      )}

      <Button
        title={mode === 'sign-in' ? 'Sign in' : mode === 'sign-up' ? 'Sign up' : 'Send reset link'}
        onPress={handleSubmit}
        loading={loading}
        style={styles.submitButton}
      />

      <Pressable onPress={() => switchMode(mode === 'sign-in' ? 'sign-up' : 'sign-in')}>
        <Text style={styles.toggle}>
          {mode === 'sign-in'
            ? "Don't have an account? Sign up"
            : mode === 'sign-up'
              ? 'Already have an account? Sign in'
              : 'Back to sign in'}
        </Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 24,
    backgroundColor: colors.background,
  },
  title: {
    fontFamily: fonts.displayItalic,
    fontSize: 34,
    color: colors.text,
    textAlign: 'center',
  },
  subtitle: {
    fontFamily: fonts.regular,
    fontSize: 15,
    color: colors.textMuted,
    textAlign: 'center',
    marginTop: 8,
    marginBottom: 32,
  },
  invite: {
    fontFamily: fonts.medium,
    fontSize: 14,
    color: colors.text,
    textAlign: 'center',
    marginBottom: 16,
  },
  input: {
    fontFamily: fonts.regular,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 12,
    fontSize: 16,
    color: colors.text,
    backgroundColor: colors.background,
  },
  errorText: {
    fontFamily: fonts.medium,
    color: colors.danger,
    fontSize: 14,
    marginBottom: 12,
  },
  successText: {
    fontFamily: fonts.medium,
    color: colors.success,
    fontSize: 14,
    marginBottom: 12,
  },
  submitButton: {
    marginTop: 8,
  },
  forgot: {
    alignSelf: 'flex-end',
    marginTop: -4,
    marginBottom: 12,
  },
  forgotText: {
    fontFamily: fonts.regular,
    fontSize: 13,
    color: colors.textMuted,
  },
  toggle: {
    fontFamily: fonts.regular,
    textAlign: 'center',
    marginTop: 16,
    color: colors.textMuted,
    fontSize: 14,
  },
});
