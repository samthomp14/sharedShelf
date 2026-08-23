import { useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { supabase } from '../../lib/supabase';

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
        value={email}
        onChangeText={setEmail}
        autoCapitalize="none"
        keyboardType="email-address"
        autoComplete="email"
      />
      <TextInput
        style={styles.input}
        placeholder="Password"
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        autoComplete={mode === 'sign-in' ? 'password' : 'new-password'}
      />
      {mode === 'sign-up' && (
        <TextInput
          style={styles.input}
          placeholder="Confirm password"
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

      <Pressable style={styles.button} onPress={handleSubmit} disabled={loading}>
        {loading ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={styles.buttonText}>{mode === 'sign-in' ? 'Sign in' : 'Sign up'}</Text>
        )}
      </Pressable>

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
    backgroundColor: '#fff',
  },
  title: {
    fontSize: 32,
    fontWeight: '700',
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 15,
    color: '#666',
    textAlign: 'center',
    marginTop: 8,
    marginBottom: 32,
  },
  input: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 12,
    fontSize: 16,
  },
  errorText: {
    color: '#c00',
    fontSize: 14,
    marginBottom: 12,
  },
  successText: {
    color: '#0a7d2c',
    fontSize: 14,
    marginBottom: 12,
  },
  button: {
    backgroundColor: '#111',
    borderRadius: 8,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 8,
  },
  buttonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  toggle: {
    textAlign: 'center',
    marginTop: 16,
    color: '#666',
  },
});
