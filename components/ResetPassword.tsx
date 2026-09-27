import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { Button } from './Button';
import { colors, fonts, inputStyle } from '../lib/theme';

// Shown instead of the app after opening a password-reset link: that link
// already signed you in, so this just sets the new password.
export function ResetPassword() {
  const { finishRecovery } = useAuth();
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setError(null);
    if (password.length < 6) {
      setError('Use at least 6 characters.');
      return;
    }
    if (password !== confirmPassword) {
      setError("Passwords don't match.");
      return;
    }
    setSaving(true);
    const { error: updateError } = await supabase.auth.updateUser({ password });
    setSaving(false);
    if (updateError) {
      setError(updateError.message);
      return;
    }
    finishRecovery();
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>New password</Text>
      <Text style={styles.subtitle}>Pick a new password for sharedShelf.</Text>
      <TextInput
        style={[inputStyle, styles.input]}
        placeholder="New password"
        placeholderTextColor={colors.textFaint}
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        autoComplete="new-password"
      />
      <TextInput
        style={[inputStyle, styles.input]}
        placeholder="Confirm new password"
        placeholderTextColor={colors.textFaint}
        value={confirmPassword}
        onChangeText={setConfirmPassword}
        secureTextEntry
        autoComplete="new-password"
      />
      {error && <Text style={styles.errorText}>{error}</Text>}
      <Button title="Save password" onPress={save} loading={saving} style={styles.submit} />
      <Pressable onPress={finishRecovery} disabled={saving}>
        <Text style={styles.skip}>Skip for now</Text>
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
    fontSize: 30,
    color: colors.text,
    textAlign: 'center',
  },
  subtitle: {
    fontFamily: fonts.regular,
    fontSize: 15,
    color: colors.textMuted,
    textAlign: 'center',
    marginTop: 8,
    marginBottom: 28,
  },
  input: { marginBottom: 12 },
  errorText: {
    fontFamily: fonts.medium,
    color: colors.danger,
    fontSize: 14,
    marginBottom: 12,
  },
  submit: { marginTop: 8 },
  skip: {
    fontFamily: fonts.regular,
    textAlign: 'center',
    marginTop: 16,
    color: colors.textMuted,
    fontSize: 14,
  },
});
