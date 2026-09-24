import { useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';
import { log } from '../lib/log';
import { inviteUrl, shareApp } from '../lib/share';
import { colors, fonts } from '../lib/theme';
import { Button } from './Button';
import { ShareGlyph } from './ShareGlyph';

const COPIED_FOR_MS = 2000;

// Your invite code, fetched once per signed-in user and shared by every
// button. It has to be in hand before the tap: the web share sheet needs the
// tap's user activation, so nothing can be awaited in the handler. The server
// hands out codes with at least a day left, so refetch after a few hours.
const CODE_FRESH_FOR_MS = 6 * 60 * 60 * 1000;
let cachedCode: { userId: string; code: string; fetchedAt: number } | null = null;

function useInviteCode(): string | null {
  const { session } = useAuth();
  const userId = session?.user.id;
  const cached =
    cachedCode && cachedCode.userId === userId && Date.now() - cachedCode.fetchedAt < CODE_FRESH_FOR_MS
      ? cachedCode.code
      : null;
  const [code, setCode] = useState(cached);

  useEffect(() => {
    if (!userId || cached) return;
    let active = true;
    supabase.rpc('get_invite_code').then(({ data, error }) => {
      if (error) {
        log.error('invite.get_code_failed', { error: error.message });
        return;
      }
      cachedCode = { userId, code: data, fetchedAt: Date.now() };
      if (active) setCode(data);
    });
    return () => {
      active = false;
    };
  }, [userId, cached]);

  return code;
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
  const url = inviteUrl(useInviteCode());

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
