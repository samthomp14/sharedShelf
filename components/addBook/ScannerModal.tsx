import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Modal, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useCameraPermissions } from 'expo-camera';
import { classifyBarcode } from '../../lib/isbn';
import {
  addToShelf,
  lookupIsbn,
  removeFromShelf,
  type CatalogBook,
  type ExternalBook,
} from '../../lib/bookLookup';
import { Button } from '../Button';
import { ToastProvider, useToast } from '../Toast';
import { BarcodeCamera } from './BarcodeCamera';
import { BookResultCard, type BookResultStatus } from './BookResultCard';
import { colors, fonts, radius } from '../../lib/theme';

// Continuous scanning session: scan → look up (our catalog first) → one tap
// to add → the card clears itself and the camera is ready for the next book.
// The session stays open until "Done", which reports how many were added.

const NOT_ISBN_HINT =
  "That's not the ISBN barcode — look for the one starting 978, usually on the back or inside cover.";
const HINT_DURATION_MS = 3500;
// After adding, how long the "Added ✓" card lingers before clearing.
const ADDED_DISMISS_MS = 1000;
// After the user dismisses a card the same barcode is usually still in frame;
// give them a moment to move the book before it can be picked up again.
const REDISMISS_COOLDOWN_MS = 2500;

interface ScannerModalProps {
  visible: boolean;
  onClose: (addedCount: number) => void;
  onManualEntry: (isbn: string) => void;
}

export function ScannerModal({ visible, onClose, onManualEntry }: ScannerModalProps) {
  // Owned here (not in the session) so the hardware back button on Android,
  // which goes through the Modal, still reports the right count.
  const countRef = useRef(0);

  useEffect(() => {
    if (visible) countRef.current = 0;
  }, [visible]);

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={() => onClose(countRef.current)}>
      {/* A Modal covers the screen's own toast host, so the session gets its
          own provider. Top-positioned: the bottom is the result sheet. */}
      <ToastProvider position="top">
        {visible && (
          <ScannerSession countRef={countRef} onClose={onClose} onManualEntry={onManualEntry} />
        )}
      </ToastProvider>
    </Modal>
  );
}

type FoundBook =
  | { kind: 'catalog'; book: CatalogBook }
  | { kind: 'external'; book: ExternalBook };

type Sheet =
  | { kind: 'loading'; isbn: string }
  | {
      kind: 'result';
      isbn: string;
      found: FoundBook;
      status: BookResultStatus;
      error: string | null;
    }
  | { kind: 'not_found'; isbn: string }
  | { kind: 'error'; isbn: string };

const SOURCE_NOTES: Record<ExternalBook['source'], string> = {
  open_library: 'From Open Library',
  google_books: 'From Google Books',
};

interface ScannerSessionProps extends Omit<ScannerModalProps, 'visible'> {
  countRef: { current: number };
}

function ScannerSession({ countRef, onClose, onManualEntry }: ScannerSessionProps) {
  const insets = useSafeAreaInsets();
  const toast = useToast();
  const [permission, requestPermission] = useCameraPermissions();
  const [sheet, setSheet] = useState<Sheet | null>(null);
  // Latest rendered sheet, for async callbacks (Undo) that need to know
  // what's on screen now rather than when they were created.
  const sheetRef = useRef<Sheet | null>(null);
  sheetRef.current = sheet;
  const [hint, setHint] = useState<string | null>(null);
  const [addedCount, setAddedCount] = useState(0);

  // Scan gating lives in refs: onBarcodeScanned fires many times a second,
  // faster than state updates land.
  // busy = a sheet is showing or a lookup is in flight; new scans are ignored.
  const busyRef = useRef(false);
  // ISBNs already dealt with this session (looked up, added, or showing).
  const handledRef = useRef(new Set<string>());
  // The last dismissed ISBN, so it isn't re-opened while still in frame.
  const cooldownRef = useRef<{ isbn: string; until: number } | null>(null);
  // Bumped whenever the sheet changes hands, so a slow lookup can't land
  // on a sheet the user has already moved past.
  const lookupIdRef = useRef(0);
  const hintTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dismissTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Set when the camera fails to start (e.g. access blocked in Settings).
  const [mountError, setMountError] = useState(false);
  const [torchOn, setTorchOn] = useState(false);

  useEffect(
    () => () => {
      if (hintTimerRef.current) clearTimeout(hintTimerRef.current);
      if (dismissTimerRef.current) clearTimeout(dismissTimerRef.current);
    },
    []
  );

  function setCount(delta: number) {
    countRef.current = Math.max(0, countRef.current + delta);
    setAddedCount(countRef.current);
  }

  function showHint(text: string) {
    if (hintTimerRef.current) clearTimeout(hintTimerRef.current);
    setHint(text);
    hintTimerRef.current = setTimeout(() => setHint(null), HINT_DURATION_MS);
  }

  function clearSheet() {
    if (dismissTimerRef.current) {
      clearTimeout(dismissTimerRef.current);
      dismissTimerRef.current = null;
    }
    lookupIdRef.current++;
    setSheet(null);
    busyRef.current = false;
  }

  // User closed a card without adding (Skip / Keep scanning): forget the
  // ISBN so it can be scanned again, after a short cooldown.
  function dismissSheet(isbn: string) {
    handledRef.current.delete(isbn);
    cooldownRef.current = { isbn, until: Date.now() + REDISMISS_COOLDOWN_MS };
    clearSheet();
  }

  function handleBarcodeScanned(data: string) {
    if (busyRef.current) return;

    const result = classifyBarcode(data);
    if (result.kind === 'not_isbn') {
      showHint(NOT_ISBN_HINT);
      return;
    }

    const { isbn } = result;
    if (handledRef.current.has(isbn)) return;
    const cooldown = cooldownRef.current;
    if (cooldown && cooldown.isbn === isbn && Date.now() < cooldown.until) return;

    handledRef.current.add(isbn);
    runLookup(isbn);
  }

  async function runLookup(isbn: string) {
    busyRef.current = true;
    if (hintTimerRef.current) clearTimeout(hintTimerRef.current);
    setHint(null);
    const lookupId = ++lookupIdRef.current;
    setSheet({ kind: 'loading', isbn });

    try {
      const result = await lookupIsbn(isbn);
      if (lookupId !== lookupIdRef.current) return;
      if (result.kind === 'not_found') {
        setSheet({ kind: 'not_found', isbn });
      } else {
        const onShelf = result.kind === 'catalog' && result.book.onMyShelf;
        setSheet({
          kind: 'result',
          isbn,
          found: result,
          status: onShelf ? 'on_shelf' : 'addable',
          error: null,
        });
      }
    } catch {
      if (lookupId !== lookupIdRef.current) return;
      setSheet({ kind: 'error', isbn });
    }
  }

  // Update the result card only if it's still the one for this ISBN.
  function updateResult(isbn: string, patch: { status: BookResultStatus; error?: string | null }) {
    setSheet((current) =>
      current?.kind === 'result' && current.isbn === isbn
        ? { ...current, status: patch.status, error: patch.error ?? null }
        : current
    );
  }

  async function handleAdd(isbn: string, found: FoundBook) {
    updateResult(isbn, { status: 'adding' });
    try {
      const input =
        found.kind === 'catalog'
          ? { bookId: found.book.id }
          : {
              isbn: found.book.isbn,
              title: found.book.title,
              authors: found.book.authors,
              coverUrl: found.book.coverUrl,
              source: found.book.source,
            };
      const { shelfItemId, alreadyOnShelf } = await addToShelf(input);

      if (alreadyOnShelf) {
        updateResult(isbn, { status: 'on_shelf' });
        return;
      }

      updateResult(isbn, { status: 'added' });
      setCount(1);
      const title = found.book.title;
      toast.show({
        message: `Added ${title}`,
        actionLabel: 'Undo',
        onAction: () => undoAdd(isbn, shelfItemId, title),
      });

      dismissTimerRef.current = setTimeout(() => {
        dismissTimerRef.current = null;
        clearSheet();
      }, ADDED_DISMISS_MS);
    } catch (e) {
      updateResult(isbn, {
        status: 'addable',
        error: e instanceof Error ? e.message : 'Could not add this book.',
      });
    }
  }

  async function undoAdd(isbn: string, shelfItemId: string, title: string) {
    try {
      await removeFromShelf(shelfItemId);
    } catch {
      toast.show({ message: `Couldn't undo — ${title} is still on your shelf.` });
      return;
    }
    setCount(-1);
    // Still on screen (undo within the auto-dismiss window)? Put the card
    // back to addable and keep it open. Otherwise let the book be rescanned.
    const current = sheetRef.current;
    if (current?.kind === 'result' && current.isbn === isbn) {
      if (dismissTimerRef.current) {
        clearTimeout(dismissTimerRef.current);
        dismissTimerRef.current = null;
      }
      updateResult(isbn, { status: 'addable' });
    } else {
      handledRef.current.delete(isbn);
    }
  }

  function handleManualEntry(isbn: string) {
    onManualEntry(isbn);
    onClose(countRef.current);
  }

  function renderSheet() {
    if (!sheet) return null;

    switch (sheet.kind) {
      case 'loading':
        return (
          <View style={styles.sheetRow}>
            <ActivityIndicator color={colors.text} />
            <Text style={styles.sheetText}>Looking up ISBN {sheet.isbn}…</Text>
          </View>
        );
      case 'result': {
        const { found, isbn } = sheet;
        return (
          <BookResultCard
            book={found.book}
            status={sheet.status}
            error={sheet.error}
            note={found.kind === 'external' ? SOURCE_NOTES[found.book.source] : undefined}
            onAdd={() => handleAdd(isbn, found)}
            onSkip={sheet.status === 'added' ? undefined : () => dismissSheet(isbn)}
          />
        );
      }
      case 'not_found':
        return (
          <View style={styles.sheetBlock}>
            <Text style={styles.sheetTitle}>We couldn't find this book</Text>
            <Text style={styles.sheetText}>ISBN {sheet.isbn}</Text>
            <View style={styles.sheetActions}>
              <Button
                title="Enter it manually"
                onPress={() => handleManualEntry(sheet.isbn)}
                style={styles.sheetPrimary}
              />
              <Button title="Keep scanning" variant="secondary" onPress={() => dismissSheet(sheet.isbn)} />
            </View>
          </View>
        );
      case 'error':
        return (
          <View style={styles.sheetBlock}>
            <Text style={styles.sheetTitle}>Couldn't look that up</Text>
            <Text style={styles.sheetText}>
              The book lookup didn't respond. Try again, or enter it manually. (ISBN {sheet.isbn})
            </Text>
            <View style={styles.sheetActions}>
              <Button title="Retry" onPress={() => runLookup(sheet.isbn)} style={styles.sheetPrimary} />
              <Button
                title="Enter manually"
                variant="secondary"
                onPress={() => handleManualEntry(sheet.isbn)}
              />
            </View>
          </View>
        );
    }
  }

  const footer = (
    <View style={styles.footerRow}>
      <Text style={styles.countText}>{addedCount > 0 ? `${addedCount} added` : ''}</Text>
      <Pressable style={styles.doneButton} onPress={() => onClose(countRef.current)}>
        <Text style={styles.doneText}>Done</Text>
      </Pressable>
    </View>
  );

  // The hub asks for camera access in the Scan tap itself (iOS web apps only
  // honor the prompt inside a user gesture). Here we just show the camera
  // unless access is known to be off — the permission status can stay
  // unknown on iOS, and BarcodeCamera requests the stream itself on mount.
  if (permission?.status === 'denied' || mountError) {
    return (
      <View style={[styles.container, styles.deniedContainer, { paddingTop: insets.top + 24, paddingBottom: insets.bottom + 24 }]}>
        <Text style={styles.deniedText}>
          Camera access is off. Enable it in Settings, or search/enter the book instead.
        </Text>
        {permission?.canAskAgain && (
          <Button
            title="Allow camera"
            variant="secondary"
            onPress={async () => {
              const result = await requestPermission();
              if (result.granted) setMountError(false);
            }}
          />
        )}
        <Pressable style={styles.doneButton} onPress={() => onClose(countRef.current)}>
          <Text style={styles.doneText}>Close</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <BarcodeCamera
        onScanned={handleBarcodeScanned}
        onError={() => setMountError(true)}
        torch={torchOn}
      />
      <View style={styles.viewfinderWrap} pointerEvents="none">
        <View style={styles.viewfinder} />
      </View>
      {Platform.OS !== 'web' && (
        <Pressable
          style={[styles.torchButton, { top: insets.top + 12 }, torchOn && styles.torchButtonOn]}
          onPress={() => setTorchOn((on) => !on)}
          accessibilityRole="button"
          accessibilityLabel={torchOn ? 'Turn flash off' : 'Turn flash on'}
        >
          <Text style={[styles.torchText, torchOn && styles.torchTextOn]}>
            {torchOn ? 'Flash on' : 'Flash off'}
          </Text>
        </Pressable>
      )}
      <View style={[styles.overlay, { paddingBottom: 24 + insets.bottom }]}>
        {sheet ? (
          <View style={styles.sheet}>{renderSheet()}</View>
        ) : (
          <Text style={[styles.hint, hint !== null && styles.hintWarning]}>
            {hint ?? 'Line the barcode up in the box'}
          </Text>
        )}
        {footer}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
  },
  viewfinderWrap: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  viewfinder: {
    width: '75%',
    height: 140,
    borderWidth: 2,
    borderColor: '#fff',
  },
  torchButton: {
    position: 'absolute',
    right: 16,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: radius.md,
  },
  torchButtonOn: {
    backgroundColor: '#fff',
  },
  torchText: {
    fontFamily: fonts.semibold,
    fontSize: 14,
    color: '#fff',
  },
  torchTextOn: {
    color: colors.text,
  },
  overlay: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    padding: 16,
    gap: 16,
  },
  hint: {
    fontFamily: fonts.medium,
    fontSize: 15,
    color: '#fff',
    textAlign: 'center',
    paddingHorizontal: 8,
  },
  hintWarning: {
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    borderRadius: radius.md,
    paddingVertical: 10,
    paddingHorizontal: 14,
    overflow: 'hidden',
  },
  sheet: {
    backgroundColor: colors.background,
    borderRadius: radius.md,
    padding: 16,
  },
  sheetRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 8,
  },
  sheetBlock: {
    gap: 6,
  },
  sheetTitle: {
    fontFamily: fonts.display,
    fontSize: 18,
    color: colors.text,
  },
  sheetText: {
    fontFamily: fonts.regular,
    fontSize: 14,
    color: colors.textMuted,
  },
  sheetActions: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 10,
  },
  sheetPrimary: {
    flex: 1,
  },
  footerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  countText: {
    fontFamily: fonts.semibold,
    fontSize: 15,
    color: '#fff',
  },
  doneButton: {
    backgroundColor: '#fff',
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: radius.md,
  },
  doneText: {
    fontFamily: fonts.semibold,
    fontSize: 14,
    color: colors.text,
  },
  deniedContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
    gap: 20,
  },
  deniedText: {
    fontFamily: fonts.medium,
    fontSize: 16,
    lineHeight: 24,
    color: '#fff',
    textAlign: 'center',
  },
});
