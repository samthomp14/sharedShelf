import { useEffect, useState } from 'react';
import { useLocalSearchParams } from 'expo-router';
import { ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { supabase } from '../../../lib/supabase';
import { useAuth } from '../../../contexts/AuthContext';
import { Button } from '../../../components/Button';
import { NotificationSettings } from '../../../components/NotificationSettings';
import { colors, fonts, inputStyle } from '../../../lib/theme';

const USERNAME_PATTERN = /^[a-zA-Z0-9_]{3,20}$/;

function friendlyError(message: string): string {
  if (message.includes('profiles_username_key')) {
    return 'That username is already taken.';
  }
  return message;
}

export default function ProfileSettings() {
  const { session } = useAuth();
  const uid = session?.user?.id ?? null;
  // The profile tab we came from already had this — seed the form with it
  // instead of blanking out while we re-fetch to confirm it's current.
  const params = useLocalSearchParams<{ username?: string; displayName?: string; bio?: string }>();
  const [username, setUsername] = useState(params.username ?? '');
  const [email, setEmail] = useState(session?.user?.email ?? '');
  const [displayName, setDisplayName] = useState(params.displayName ?? '');
  const [bio, setBio] = useState(params.bio ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  // Once the user starts editing, stop letting the background refresh
  // overwrite what they've typed.
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    load();
  }, [uid]);

  async function load() {
    setEmail(session?.user?.email ?? '');
    if (!uid) return;

    const { data } = await supabase
      .from('profiles')
      .select('username, display_name, bio')
      .eq('id', uid)
      .single();

    if (data && !dirty) {
      setUsername(data.username);
      setDisplayName(data.display_name ?? '');
      setBio(data.bio ?? '');
    }
  }

  async function save() {
    setError(null);
    setSaved(false);

    if (!USERNAME_PATTERN.test(username)) {
      setError('Username must be 3-20 characters: letters, numbers, underscores only.');
      return;
    }

    if (!uid) return;
    setSaving(true);

    const { error: updateError } = await supabase
      .from('profiles')
      .update({ username, display_name: displayName.trim() || null, bio: bio.trim() || null })
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

  return (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.container}>
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
            setDirty(true);
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
            setDirty(true);
          }}
        />

        <Text style={styles.label}>Bio</Text>
        <TextInput
          style={[inputStyle, styles.bioInput]}
          placeholder="A line or two about your shelf"
          placeholderTextColor={colors.textFaint}
          value={bio}
          onChangeText={(text) => {
            setBio(text);
            setSaved(false);
            setDirty(true);
          }}
          multiline
        />

        <Text style={styles.label}>Email</Text>
        <Text style={styles.readOnlyValue}>{email}</Text>

        {error && <Text style={styles.errorText}>{error}</Text>}
        {saved && <Text style={styles.savedText}>Saved.</Text>}

        <Button title="Save" onPress={save} loading={saving} style={styles.submit} />

        <NotificationSettings uid={uid} />
      </View>

      <View style={styles.signOutSection}>
        <Button title="Sign out" variant="secondary" onPress={signOut} />
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: {
    flex: 1,
    backgroundColor: colors.background,
  },
  container: {
    flexGrow: 1,
    justifyContent: 'space-between',
    padding: 16,
  },
  label: {
    fontFamily: fonts.semibold,
    fontSize: 13,
    color: colors.textMuted,
    marginBottom: 6,
    marginTop: 12,
  },
  bioInput: {
    minHeight: 80,
    textAlignVertical: 'top',
    paddingTop: 12,
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
    marginTop: 24,
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
});
