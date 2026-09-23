import { useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Button } from '../../../components/Button';
import { ToastProvider, useToast } from '../../../components/Toast';
import { ManualForm } from '../../../components/addBook/ManualForm';
import { ScannerModal } from '../../../components/addBook/ScannerModal';
import { SearchPanel, type ManualPrefill } from '../../../components/addBook/SearchPanel';
import { colors, fonts } from '../../../lib/theme';

// Add-book hub: scanning is the main path; search and manual entry are the
// fallbacks. Adding never navigates away — you stay here to add the next one.

export default function AddBook() {
  return (
    <ToastProvider>
      <AddBookHub />
    </ToastProvider>
  );
}

const EMPTY_PREFILL: ManualPrefill = { isbn: '', title: '', isbnNotFound: false };

function AddBookHub() {
  const toast = useToast();
  const scrollRef = useRef<ScrollView>(null);
  const [scanning, setScanning] = useState(false);
  const [manualOpen, setManualOpen] = useState(false);
  // Details handed over by the scanner or search — prefill the manual form.
  // `n` remounts the form (and re-scrolls to it) even when the same details
  // are handed over twice.
  const [manualPrefill, setManualPrefill] = useState({ ...EMPTY_PREFILL, n: 0 });
  // Set by a handover; the manual section scrolls itself into view once laid out.
  const scrollToManualRef = useRef(false);

  function handleScannerClose(addedCount: number) {
    setScanning(false);
    if (addedCount > 0) {
      toast.show({ message: `Added ${addedCount} ${addedCount === 1 ? 'book' : 'books'}` });
    }
  }

  function openManual(prefill: ManualPrefill) {
    scrollToManualRef.current = true;
    setManualPrefill((p) => ({ ...prefill, n: p.n + 1 }));
    setManualOpen(true);
  }

  // Opened by hand: start blank rather than with an older handover's details.
  function openManualBlank() {
    setManualPrefill((p) => ({ ...EMPTY_PREFILL, n: p.n }));
    setManualOpen(true);
  }

  return (
    <ScrollView
      ref={scrollRef}
      style={styles.scroll}
      contentContainerStyle={styles.container}
      keyboardShouldPersistTaps="handled"
    >
      <Button title="Scan barcode" onPress={() => setScanning(true)} style={styles.scanButton} />
      <Text style={styles.explainer}>
        Scan the barcode on the back of each book — you can add several in a row.
      </Text>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Or search</Text>
        <SearchPanel onManualEntry={openManual} />
      </View>

      {manualOpen ? (
        <View
          key={manualPrefill.n}
          style={styles.section}
          onLayout={(e) => {
            if (!scrollToManualRef.current) return;
            scrollToManualRef.current = false;
            scrollRef.current?.scrollTo({ y: Math.max(0, e.nativeEvent.layout.y - 16), animated: true });
          }}
        >
          <View style={styles.manualHeader}>
            <Text style={styles.sectionTitle}>Enter manually</Text>
            <Pressable onPress={() => setManualOpen(false)} hitSlop={8}>
              <Text style={styles.hideText}>Hide</Text>
            </Pressable>
          </View>
          <ManualForm
            initialIsbn={manualPrefill.isbn}
            isbnNotFound={manualPrefill.isbnNotFound}
            initialTitle={manualPrefill.title}
          />
        </View>
      ) : (
        <Pressable style={styles.manualLink} onPress={openManualBlank} hitSlop={6}>
          <Text style={styles.manualLinkText}>Enter manually</Text>
        </Pressable>
      )}

      <ScannerModal
        visible={scanning}
        onClose={handleScannerClose}
        onManualEntry={(isbn) => openManual({ isbn, title: '', isbnNotFound: true })}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: {
    flex: 1,
    backgroundColor: colors.background,
  },
  container: {
    padding: 16,
    paddingBottom: 96, // room for the toast over the last field
  },
  scanButton: {
    paddingVertical: 16,
  },
  explainer: {
    fontFamily: fonts.regular,
    fontSize: 14,
    color: colors.textMuted,
    textAlign: 'center',
    marginTop: 10,
  },
  section: {
    marginTop: 32,
  },
  sectionTitle: {
    fontFamily: fonts.semibold,
    fontSize: 13,
    color: colors.textMuted,
    textTransform: 'uppercase',
    marginBottom: 12,
  },
  manualHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  hideText: {
    fontFamily: fonts.medium,
    fontSize: 13,
    color: colors.textMuted,
    textDecorationLine: 'underline',
  },
  manualLink: {
    alignSelf: 'center',
    marginTop: 28,
    paddingVertical: 4,
  },
  manualLinkText: {
    fontFamily: fonts.semibold,
    fontSize: 14,
    color: colors.textMuted,
    textDecorationLine: 'underline',
  },
});
