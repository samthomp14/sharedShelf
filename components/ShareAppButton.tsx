import { useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { APP_URL, shareApp } from '../lib/share';
import { colors, fonts } from '../lib/theme';
import { Button } from './Button';
import { ShareGlyph } from './ShareGlyph';

const COPIED_FOR_MS = 2000;

interface ShareAppButtonProps {
  title?: string;
  variant?: 'primary' | 'secondary';
  style?: StyleProp<ViewStyle>;
}

// Opens the share sheet with the app's link. Where there's no share sheet the
// link is copied instead, and the button briefly reads "Link copied". If even
// that fails, the link is shown underneath so it can be copied by hand.
export function ShareAppButton({ title = 'Invite friends', variant = 'primary', style }: ShareAppButtonProps) {
  const [copied, setCopied] = useState(false);
  const [failed, setFailed] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  function onPress() {
    // No awaits before shareApp(): the web share sheet needs this tap's
    // user activation.
    shareApp().then((result) => {
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
          Share this link: {APP_URL}
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
