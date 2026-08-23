import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { supabase } from '../../lib/supabase';
import { Button } from '../../components/Button';
import { colors, fonts, radius } from '../../lib/theme';

type Mode = 'sign-in' | 'sign-up';
type Message = { type: 'error' | 'success'; text: string };

export default function SignIn() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [mode, setMode] = useState<Mode>('sign-in');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<Message | null>(null);

  function switchMode(next: Mode) {
    setMode(next);
    setMessage(null);
    setPassword('');
    setConfirmPassword('');
  }

  async function handleSubmit() {
    setMessage(null);

    if (mode === 'sign-up' && password !== confirmPassword) {
      setMessage({ type: 'error', text: "Passwords don't match." });
      return;
    }

    setLoading(true);

    if (mode === 'sign-in') {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) {
        setMessage({ type: 'error', text: error.message });
      }
    } else {
      const { data, error } = await supabase.auth.signUp({ email, password });
      if (error) {
        setMessage({ type: 'error', text: error.message });
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
      <TextInput
        style={styles.input}
        placeholder="Password"
        placeholderTextColor={colors.textFaint}
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        autoComplete={mode === 'sign-in' ? 'password' : 'new-password'}
      />
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
        title={mode === 'sign-in' ? 'Sign in' : 'Sign up'}
        onPress={handleSubmit}
        loading={loading}
        style={styles.submitButton}
      />

      <Pressable onPress={() => switchMode(mode === 'sign-in' ? 'sign-up' : 'sign-in')}>
        <Text style={styles.toggle}>
          {mode === 'sign-in' ? "Don't have an account? Sign up" : 'Already have an account? Sign in'}
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
    fontFamily: fonts.bold,
    fontSize: 32,
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
  input: {
    fontFamily: fonts.regular,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius,
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
  toggle: {
    fontFamily: fonts.regular,
    textAlign: 'center',
    marginTop: 16,
    color: colors.textMuted,
    fontSize: 14,
  },
});
