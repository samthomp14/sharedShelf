import { useEffect, useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import { supabase } from '../../lib/supabase';
import { Button } from '../../components/Button';
import { colors, fonts, inputStyle } from '../../lib/theme';

const USERNAME_PATTERN = /^[a-zA-Z0-9_]{3,20}$/;

function friendlyError(message: string): string {
  if (message.includes('profiles_username_key')) {
    return 'That username is already taken.';
  }
  return message;
}

export default function Profile() {
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    load();
  }, []);

  async function load() {
    setLoading(true);
    const { data: userData } = await supabase.auth.getUser();
    const uid = userData.user?.id;
    setEmail(userData.user?.email ?? '');
    if (!uid) {
      setLoading(false);
      return;
    }

    const { data } = await supabase
      .from('profiles')
      .select('username, display_name')
      .eq('id', uid)
      .single();

    if (data) {
      setUsername(data.username);
      setDisplayName(data.display_name ?? '');
    }
    setLoading(false);
  }

  async function save() {
    setError(null);
    setSaved(false);

    if (!USERNAME_PATTERN.test(username)) {
      setError('Username must be 3-20 characters: letters, numbers, underscores only.');
      return;
    }

    setSaving(true);

    const { data: userData } = await supabase.auth.getUser();
    const uid = userData.user?.id;
    if (!uid) {
      setSaving(false);
      return;
    }

    const { error: updateError } = await supabase
      .from('profiles')
      .update({ username, display_name: displayName.trim() || null })
      .eq('id', uid);

    setSaving(false);

    if (updateError) {
      setError(friendlyError(updateError.message));
      return;
    }

    setSaved(true);
  }

  async function signOut() {
    await supabase.auth.signOut();
  }

  if (loading) {
    return <View style={styles.container} />;
  }

  return (
    <View style={styles.container}>
      <View>
        <Text style={styles.label}>Username</Text>
        <TextInput
          style={inputStyle}
          placeholder="username"
          placeholderTextColor={colors.textFaint}
          value={username}
          onChangeText={(text) => {
            setUsername(text);
            setSaved(false);
          }}
          autoCapitalize="none"
        />

        <Text style={styles.label}>Display name</Text>
        <TextInput
          style={inputStyle}
          placeholder="What friends see instead of your username"
          placeholderTextColor={colors.textFaint}
          value={displayName}
          onChangeText={(text) => {
            setDisplayName(text);
            setSaved(false);
          }}
        />

        <Text style={styles.label}>Email</Text>
        <Text style={styles.readOnlyValue}>{email}</Text>

        {error && <Text style={styles.errorText}>{error}</Text>}
        {saved && <Text style={styles.savedText}>Saved.</Text>}

        <Button title="Save" onPress={save} loading={saving} style={styles.submit} />
      </View>

      <View style={styles.signOutSection}>
        <Button title="Sign out" variant="secondary" onPress={signOut} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'space-between',
    backgroundColor: colors.background,
    padding: 16,
  },
  label: {
    fontFamily: fonts.semibold,
    fontSize: 13,
    color: colors.textMuted,
    marginBottom: 6,
    marginTop: 12,
  },
  readOnlyValue: {
    fontFamily: fonts.regular,
    fontSize: 16,
    color: colors.text,
    paddingVertical: 8,
  },
  errorText: {
    fontFamily: fonts.medium,
    color: colors.danger,
    fontSize: 14,
    marginTop: 12,
  },
  savedText: {
    fontFamily: fonts.medium,
    color: colors.success,
    fontSize: 14,
    marginTop: 12,
  },
  submit: {
    marginTop: 20,
  },
  signOutSection: {
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
});
