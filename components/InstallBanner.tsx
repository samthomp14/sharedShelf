import { useEffect, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { useAuth } from '../contexts/AuthContext';
import { isIOSSafari, isStandalone, useInstallPrompt } from '../lib/pwa';
import { colors, fonts, radius } from '../lib/theme';
import { Button } from './Button';
import { ShareGlyph } from './ShareGlyph';

const DISMISS_KEY = 'sharedShelf.installBanner.dismissedAt';
const DISMISS_FOR_MS = 30 * 24 * 60 * 60 * 1000;

function dismissedRecently(): boolean {
  try {
    const at = Number(window.localStorage.getItem(DISMISS_KEY));
    return Number.isFinite(at) && at > 0 && Date.now() - at < DISMISS_FOR_MS;
  } catch {
    return false;
  }
}

function rememberDismissal() {
  try {
    window.localStorage.setItem(DISMISS_KEY, String(Date.now()));
  } catch {
    // Storage blocked (private mode etc.) — dismissal just won't persist.
  }
}

// Nudges signed-in web users to add the app to their home screen. Web only,
// hidden once installed (standalone), and snoozed for 30 days on dismiss.
// iOS Safari gets instructions; Chromium gets an Install button once it has
// offered a `beforeinstallprompt`; every other browser gets nothing.
export function InstallBanner() {
  const { session } = useAuth();
  const { canPrompt, promptInstall } = useInstallPrompt();
  // Decided after mount, not during render, so the statically rendered HTML
  // (no window) and the first client render agree.
  const [eligible, setEligible] = useState(false);
  const [ios, setIos] = useState(false);

  useEffect(() => {
    if (Platform.OS !== 'web') return;
    setEligible(!isStandalone() && !dismissedRecently());
    setIos(isIOSSafari());
  }, []);

  if (Platform.OS !== 'web' || !session || !eligible) return null;
  if (!ios && !canPrompt) return null;

  function dismiss() {
    rememberDismissal();
    setEligible(false);
  }

  async function install() {
    const accepted = await promptInstall();
    if (accepted) setEligible(false);
  }

  return (
    <View style={styles.banner}>
      <View style={styles.body}>
        <Text style={styles.title}>Keep sharedShelf on your home screen</Text>
        {ios ? (
          <View style={styles.instructions}>
            <Text style={styles.text}>Tap </Text>
            <ShareGlyph />
            <Text style={styles.text}> Share, then </Text>
            <Text style={[styles.text, styles.strong]}>Add to Home Screen</Text>
          </View>
        ) : (
          <>
            <Text style={styles.text}>Opens like an app, straight to your shelf.</Text>
            <Button title="Install" onPress={install} style={styles.installButton} />
          </>
        )}
      </View>
      <Pressable
        onPress={dismiss}
        hitSlop={10}
        accessibilityRole="button"
        accessibilityLabel="Dismiss"
        style={styles.close}
      >
        <Text style={styles.closeText}>×</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    padding: 14,
    marginBottom: 16,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.chipBackground,
  },
  body: {
    flex: 1,
  },
  title: {
    fontFamily: fonts.displayItalic,
    fontSize: 15,
    color: colors.text,
    marginBottom: 6,
  },
  instructions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
  },
  text: {
    fontFamily: fonts.regular,
    fontSize: 14,
    color: colors.textMuted,
  },
  strong: {
    fontFamily: fonts.semibold,
    color: colors.text,
  },
  installButton: {
    alignSelf: 'flex-start',
    marginTop: 10,
  },
  close: {
    paddingHorizontal: 4,
  },
  closeText: {
    fontFamily: fonts.regular,
    fontSize: 20,
    lineHeight: 20,
    color: colors.textMuted,
  },
});
