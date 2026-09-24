import { useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';
import { inviteUrl, shareApp } from '../lib/share';
import { colors, fonts } from '../lib/theme';
import { Button } from './Button';
import { ShareGlyph } from './ShareGlyph';

const COPIED_FOR_MS = 2000;

// Your own username, fetched once per signed-in user and shared by every
// button. Looked up rather than read from the session because it can be
// changed in Edit Profile.
let cachedUsername: { userId: string; username: string } | null = null;

function useMyUsername(): string | null {
  const { session } = useAuth();
  const userId = session?.user.id;
  const [username, setUsername] = useState(
    cachedUsername && cachedUsername.userId === userId ? cachedUsername.username : null
  );

  useEffect(() => {
    if (!userId) return;
    let active = true;
    supabase
      .from('profiles')
      .select('username')
      .eq('id', userId)
      .single()
      .then(({ data }) => {
        if (!data) return;
        cachedUsername = { userId, username: data.username };
        if (active) setUsername(data.username);
      });
    return () => {
      active = false;
    };
  }, [userId]);

  return username;
}

interface ShareAppButtonProps {
  title?: string;
  variant?: 'primary' | 'secondary';
  style?: StyleProp<ViewStyle>;
}

// Opens the share sheet with your invite link. Where there's no share sheet the
// link is copied instead, and the button briefly reads "Link copied". If even
// that fails, the link is shown underneath so it can be copied by hand.
export function ShareAppButton({ title = 'Invite friends', variant = 'primary', style }: ShareAppButtonProps) {
  const [copied, setCopied] = useState(false);
  const [failed, setFailed] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const url = inviteUrl(useMyUsername());

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  function onPress() {
    // No awaits before shareApp(): the web share sheet needs this tap's
    // user activation.
    shareApp(url).then((result) => {
      if (result === 'copied') {
        setFailed(false);
        setCopied(true);
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => setCopied(false), COPIED_FOR_MS);
      } else if (result === 'failed') {
        setFailed(true);
      }
    });
  }

  const isPrimary = variant === 'primary';
  return (
    <View style={style}>
      <Button
        title={copied ? 'Link copied' : title}
        variant={variant}
        onPress={onPress}
        icon={copied ? null : <ShareGlyph color={isPrimary ? colors.background : colors.text} />}
        accessibilityLabel={copied ? 'Link copied' : title}
      />
      {failed && (
        <Text style={styles.fallback} selectable>
          Share this link: {url}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  fallback: {
    fontFamily: fonts.regular,
    fontSize: 13,
    color: colors.textMuted,
    textAlign: 'center',
    marginTop: 8,
  },
});
