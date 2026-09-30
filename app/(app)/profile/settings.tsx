import { useEffect, useState } from 'react';
import { useLocalSearchParams } from 'expo-router';
import { ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { supabase } from '../../../lib/supabase';
import { log } from '../../../lib/log';
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
  // Delete account: a second step where you type your username to confirm.
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleteText, setDeleteText] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  // The saved username, which is what you type to confirm (not the field above).
  const [savedUsername, setSavedUsername] = useState(params.username ?? '');
  // Public profile: saves as soon as it's flipped, like the notification switches.
  const [isPublic, setIsPublic] = useState<boolean | null>(null);
  const [privacyError, setPrivacyError] = useState<string | null>(null);

  useEffect(() => {
    load();
  }, [uid]);

  async function load() {
    setEmail(session?.user?.email ?? '');
    if (!uid) return;

    const { data } = await supabase
      .from('profiles')
      .select('username, display_name, bio, is_public')
      .eq('id', uid)
      .single();

    if (data) {
      setSavedUsername(data.username);
      setIsPublic(data.is_public);
    }
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
    setSavedUsername(username);
  }

  async function setProfilePublic(next: boolean) {
    if (!uid) return;
    setPrivacyError(null);
    setIsPublic(next);
    const { error: updateError } = await supabase.from('profiles').update({ is_public: next }).eq('id', uid);
    if (updateError) {
      log.error('profile.privacy_failed', { error: updateError.message });
      setIsPublic(!next);
      setPrivacyError(updateError.message);
    }
  }

  async function deleteAccount() {
    setDeleteError(null);
    setDeleting(true);
    const { error: deleteFailed } = await supabase.rpc('delete_account');
    if (deleteFailed) {
      log.error('account.delete_failed', { error: deleteFailed.message });
      setDeleting(false);
      setDeleteError(deleteFailed.message);
      return;
    }
    // The account is gone, so there's no server session left to end.
    await supabase.auth.signOut({ scope: 'local' });
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

        <Text style={styles.sectionHeading}>Privacy</Text>
        <View style={styles.switchRow}>
          <View style={styles.flex}>
            <Text style={styles.switchLabel}>Public profile</Text>
            <Text style={styles.switchHint}>
              {isPublic
                ? 'Anyone on sharedShelf can see your shelf and friends. Only friends can borrow.'
                : 'Only friends can see your shelf and friends.'}
            </Text>
          </View>
          <Switch
            value={!!isPublic}
            disabled={isPublic === null}
            onValueChange={setProfilePublic}
            trackColor={{ false: colors.chipBackground, true: colors.text }}
            thumbColor={colors.background}
            accessibilityLabel="Public profile"
          />
        </View>
        {privacyError && <Text style={styles.errorText}>{privacyError}</Text>}

        <NotificationSettings uid={uid} />
      </View>

      <View style={styles.signOutSection}>
        <Button title="Sign out" variant="secondary" onPress={signOut} />

        {confirmingDelete ? (
          <View style={styles.deleteBox}>
            <Text style={styles.deleteTitle}>Delete your account?</Text>
            <Text style={styles.deleteBody}>
              This removes your profile, your shelf, your friends and your lending history, and
              can't be undone. Books you're borrowing drop off your friends' records, so give them
              back first.
            </Text>
            <Text style={styles.label}>Type {savedUsername} to confirm</Text>
            <TextInput
              style={inputStyle}
              value={deleteText}
              onChangeText={setDeleteText}
              autoCapitalize="none"
              autoCorrect={false}
              placeholder={savedUsername}
              placeholderTextColor={colors.textFaint}
            />
            {deleteError && <Text style={styles.errorText}>{deleteError}</Text>}
            <Button
              title="Delete my account"
              onPress={deleteAccount}
              loading={deleting}
              disabled={!savedUsername || deleteText.trim() !== savedUsername}
              style={[styles.deleteButton, deleteText.trim() !== savedUsername && styles.dimmed]}
            />
            <Button
              title="Cancel"
              variant="ghost"
              onPress={() => {
                setConfirmingDelete(false);
                setDeleteText('');
                setDeleteError(null);
              }}
              disabled={deleting}
            />
          </View>
        ) : (
          <Button title="Delete account" variant="ghost" onPress={() => setConfirmingDelete(true)} />
        )}
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
  // Matches NotificationSettings' heading and rows.
  sectionHeading: {
    fontFamily: fonts.semibold,
    fontSize: 13,
    color: colors.textMuted,
    marginBottom: 6,
    marginTop: 24,
  },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 8,
  },
  flex: { flex: 1 },
  switchLabel: {
    fontFamily: fonts.medium,
    fontSize: 15,
    color: colors.text,
  },
  switchHint: {
    fontFamily: fonts.regular,
    fontSize: 13,
    color: colors.textMuted,
    marginTop: 2,
  },
  deleteBox: {
    marginTop: 8,
    padding: 14,
    gap: 8,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.danger,
  },
  deleteTitle: {
    fontFamily: fonts.semibold,
    fontSize: 16,
    color: colors.danger,
  },
  deleteBody: {
    fontFamily: fonts.regular,
    fontSize: 14,
    lineHeight: 20,
    color: colors.text,
  },
  deleteButton: {
    marginTop: 4,
    backgroundColor: colors.danger,
  },
  dimmed: {
    opacity: 0.5,
  },
  signOutSection: {
    gap: 8,
    marginTop: 24,
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
});
