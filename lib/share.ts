// "Invite friends": hand the app's link to the OS share sheet, or copy it
// when there's no share sheet (desktop Firefox, older browsers).

import { Platform, Share } from 'react-native';

export const APP_URL = 'https://shared-shelf-henna.vercel.app/';
const TITLE = 'sharedShelf';
const TEXT = "Your friends' shelves, one tap away.";

// - shared:    the share sheet completed (or, on native, was shown)
// - copied:    no share sheet, so the link went to the clipboard
// - cancelled: the user closed the share sheet — do nothing
// - failed:    couldn't share or copy; show the link so it can be copied by hand
export type ShareResult = 'shared' | 'copied' | 'cancelled' | 'failed';

function copyLink(): Promise<ShareResult> {
  const clipboard = typeof navigator !== 'undefined' ? navigator.clipboard : undefined;
  if (!clipboard?.writeText) return Promise.resolve('failed');
  return clipboard.writeText(APP_URL).then(
    () => 'copied' as const,
    () => 'failed' as const
  );
}

// Call straight from a tap handler. On web, navigator.share and
// clipboard.writeText both need the tap's user activation, so they're invoked
// synchronously here — nothing is awaited before them.
export function shareApp(): Promise<ShareResult> {
  if (Platform.OS !== 'web') {
    return Share.share(
      // iOS appends `url` to `message`; Android only reads `message`.
      Platform.OS === 'ios'
        ? { title: TITLE, message: TEXT, url: APP_URL }
        : { title: TITLE, message: `${TEXT} ${APP_URL}` }
    ).then(
      (result) => (result.action === Share.dismissedAction ? 'cancelled' : 'shared'),
      () => 'failed' as const
    );
  }

  const nav = typeof navigator !== 'undefined' ? navigator : undefined;
  if (nav?.share) {
    return nav.share({ title: TITLE, text: TEXT, url: APP_URL }).then(
      () => 'shared' as const,
      (error: unknown) => {
        if (error instanceof Error && error.name === 'AbortError') return 'cancelled' as const;
        // e.g. NotAllowedError — fall back to copying. The tap's activation may
        // be spent by now, in which case copyLink reports 'failed'.
        return copyLink();
      }
    );
  }
  return copyLink();
}
