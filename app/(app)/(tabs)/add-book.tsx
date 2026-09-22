import { useRef, useState } from 'react';
import { useRouter } from 'expo-router';
import { CameraView, useCameraPermissions } from 'expo-camera';
import {
  Alert,
  Animated,
  Dimensions,
  Easing,
  Image,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { supabase } from '../../../lib/supabase';
import { useAuth } from '../../../contexts/AuthContext';
import { Button } from '../../../components/Button';
import { colors, fonts, inputStyle, organicCorners, radius } from '../../../lib/theme';

interface OpenLibraryBook {
  title?: string;
  authors?: { name: string }[];
  cover?: { small?: string; medium?: string; large?: string };
}

const TITLE_CASE_MINOR_WORDS = new Set([
  'a', 'an', 'the', 'and', 'but', 'or', 'nor', 'for', 'so', 'yet',
  'at', 'by', 'in', 'of', 'on', 'to', 'up', 'as', 'from', 'into', 'over', 'with',
]);

const ZOOMED_COVER_WIDTH = 240;
const ZOOMED_COVER_HEIGHT = 360;

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

function toTitleCase(str: string): string {
  const words = str.split(' ');
  return words
    .map((word, i) => {
      if (!word) return word;
      const isMinor = TITLE_CASE_MINOR_WORDS.has(word.toLowerCase());
      const isEdge = i === 0 || i === words.length - 1;
      if (isMinor && !isEdge) {
        return word.toLowerCase();
      }
      return word.charAt(0).toUpperCase() + word.slice(1);
    })
    .join(' ');
}

export default function AddBook() {
  const router = useRouter();
  const { session } = useAuth();
  const [isbn, setIsbn] = useState('');
  const [title, setTitle] = useState('');
  const [authors, setAuthors] = useState('');
  const [coverUrl, setCoverUrl] = useState<string | null>(null);
  const [source, setSource] = useState<'manual' | 'open_library'>('manual');
  const [lookingUp, setLookingUp] = useState(false);
  const [lookupMessage, setLookupMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const [coverZoomed, setCoverZoomed] = useState(false);
  const [permission, requestPermission] = useCameraPermissions();
  const coverImageRef = useRef<Image>(null);
  const sourceRectRef = useRef<Rect | null>(null);
  // Animate the floating image's actual box (left/top/width/height) rather
  // than a transform — no transform-origin/scale-composition math to get
  // wrong, and every intermediate value is a real, directly-verifiable
  // on-screen rect.
  const animLeft = useRef(new Animated.Value(0)).current;
  const animTop = useRef(new Animated.Value(0)).current;
  const animWidth = useRef(new Animated.Value(0)).current;
  const animHeight = useRef(new Animated.Value(0)).current;
  const backdropAnim = useRef(new Animated.Value(0)).current;

  function centeredTargetRect(): Rect {
    const { width: winW, height: winH } = Dimensions.get('window');
    return {
      x: (winW - ZOOMED_COVER_WIDTH) / 2,
      y: (winH - ZOOMED_COVER_HEIGHT) / 2,
      width: ZOOMED_COVER_WIDTH,
      height: ZOOMED_COVER_HEIGHT,
    };
  }

  function animateRectTo(
    rect: Rect,
    backdropTo: number,
    duration: number,
    easing: (t: number) => number,
    onDone?: () => void
  ) {
    Animated.parallel([
      Animated.timing(animLeft, { toValue: rect.x, duration, easing, useNativeDriver: false }),
      Animated.timing(animTop, { toValue: rect.y, duration, easing, useNativeDriver: false }),
      Animated.timing(animWidth, { toValue: rect.width, duration, easing, useNativeDriver: false }),
      Animated.timing(animHeight, { toValue: rect.height, duration, easing, useNativeDriver: false }),
      Animated.timing(backdropAnim, { toValue: backdropTo, duration, easing, useNativeDriver: false }),
    ]).start(onDone);
  }

  function openCoverZoom() {
    // Measure the Image itself, not the Pressable wrapping it — the
    // wrapper stretches to the full row width (to center its child), so
    // measuring it instead of the image gave a rect way wider than what's
    // actually visible on screen.
    coverImageRef.current?.measureInWindow((x, y, width, height) => {
      const rect: Rect = { x, y, width, height };
      sourceRectRef.current = rect;

      // Start exactly at the cover's current position/size — no reset.
      animLeft.setValue(rect.x);
      animTop.setValue(rect.y);
      animWidth.setValue(rect.width);
      animHeight.setValue(rect.height);
      backdropAnim.setValue(0);
      setCoverZoomed(true);

      animateRectTo(centeredTargetRect(), 1, 280, Easing.out(Easing.cubic));
    });
  }

  function closeCoverZoom() {
    const rect = sourceRectRef.current ?? centeredTargetRect();
    animateRectTo(rect, 0, 220, Easing.in(Easing.cubic), () => {
      setCoverZoomed(false);
      sourceRectRef.current = null;
    });
  }

  async function lookupIsbn(overrideIsbn?: string) {
    const trimmed = (overrideIsbn ?? isbn).trim();
    if (!trimmed) return;

    setLookupMessage(null);
    setLookingUp(true);

    try {
      const res = await fetch(
        `https://openlibrary.org/api/books?bibkeys=ISBN:${encodeURIComponent(trimmed)}&jscmd=data&format=json`
      );
      const json: Record<string, OpenLibraryBook> = await res.json();
      const found = json[`ISBN:${trimmed}`];

      if (!found) {
        setLookupMessage("Couldn't find that ISBN — enter the details manually below.");
      } else {
        setTitle(found.title ? toTitleCase(found.title) : '');
        setAuthors((found.authors ?? []).map((a) => a.name).join(', '));
        setCoverUrl(found.cover?.medium ?? found.cover?.small ?? null);
        setSource('open_library');
        setLookupMessage(`Found: ${found.title}`);
      }
    } catch {
      setLookupMessage('Lookup failed — check your connection, or enter details manually.');
    } finally {
      setLookingUp(false);
    }
  }

  async function openScanner() {
    if (!permission?.granted) {
      const result = await requestPermission();
      if (!result.granted) {
        Alert.alert(
          'Camera access needed',
          'Enable camera access for sharedShelf in your device settings to scan a barcode, or enter the ISBN manually.'
        );
        return;
      }
    }
    setScanning(true);
  }

  function handleBarcodeScanned(scannedIsbn: string) {
    setScanning(false);
    setIsbn(scannedIsbn);
    lookupIsbn(scannedIsbn);
  }

  async function handleAdd() {
    setError(null);

    if (!title.trim()) {
      setError('Title is required.');
      return;
    }

    setLoading(true);

    const uid = session?.user?.id;
    if (!uid) {
      setError('You need to be signed in.');
      setLoading(false);
      return;
    }

    const authorsArray = authors
      .split(',')
      .map((a) => a.trim())
      .filter(Boolean);
    const trimmedIsbn = isbn.trim() || null;

    let bookId: string | null = null;

    if (trimmedIsbn) {
      const { data: existingBook } = await supabase
        .from('books')
        .select('id')
        .eq('isbn', trimmedIsbn)
        .maybeSingle();
      if (existingBook) {
        bookId = existingBook.id;
      }
    }

    if (!bookId) {
      const { data: newBook, error: bookError } = await supabase
        .from('books')
        .insert({
          title: title.trim(),
          authors: authorsArray,
          isbn: trimmedIsbn,
          cover_url: coverUrl,
          source,
        })
        .select('id')
        .single();

      if (bookError) {
        setError(bookError.message);
        setLoading(false);
        return;
      }
      bookId = newBook.id;
    }

    const { error: shelfError } = await supabase
      .from('shelf_items')
      .insert({ owner_id: uid, book_id: bookId });

    setLoading(false);

    if (shelfError) {
      setError(shelfError.message);
      return;
    }

    setIsbn('');
    setTitle('');
    setAuthors('');
    setCoverUrl(null);
    setSource('manual');
    setLookupMessage(null);
    router.push('/');
  }

  return (
    <View style={styles.container}>
      <Button title="Scan barcode" onPress={openScanner} style={styles.scanButton} />

      <Text style={styles.label}>ISBN</Text>
      <View style={styles.isbnRow}>
        <TextInput
          style={[inputStyle, styles.isbnInput]}
          placeholder="9780441478125"
          placeholderTextColor={colors.textFaint}
          value={isbn}
          onChangeText={(text) => {
            setIsbn(text);
            setLookupMessage(null);
          }}
          keyboardType="numbers-and-punctuation"
          onSubmitEditing={() => lookupIsbn()}
          returnKeyType="search"
        />
        <Button title="Look up" variant="secondary" onPress={() => lookupIsbn()} loading={lookingUp} />
      </View>
      {lookupMessage && <Text style={styles.lookupMessage}>{lookupMessage}</Text>}

      {coverUrl && (
        <Pressable style={styles.coverWrap} onPress={openCoverZoom}>
          <Image
            ref={coverImageRef}
            source={{ uri: coverUrl }}
            style={styles.cover}
            resizeMode="contain"
          />
        </Pressable>
      )}

      <Text style={styles.label}>Title</Text>
      <TextInput
        style={inputStyle}
        placeholder="The Left Hand of Darkness"
        placeholderTextColor={colors.textFaint}
        value={title}
        onChangeText={(text) => {
          setTitle(text);
          setSource('manual');
        }}
      />

      <Text style={styles.label}>Author(s)</Text>
      <TextInput
        style={inputStyle}
        placeholder="Ursula K. Le Guin"
        placeholderTextColor={colors.textFaint}
        value={authors}
        onChangeText={(text) => {
          setAuthors(text);
          setSource('manual');
        }}
      />

      {error && <Text style={styles.errorText}>{error}</Text>}

      <Button title="Add to shelf" onPress={handleAdd} loading={loading} style={styles.submit} />

      <Modal visible={scanning} animationType="slide" onRequestClose={() => setScanning(false)}>
        <View style={styles.scannerContainer}>
          <CameraView
            style={StyleSheet.absoluteFill}
            facing="back"
            barcodeScannerSettings={{ barcodeTypes: ['ean13', 'ean8', 'upc_a'] }}
            onBarcodeScanned={(result) => handleBarcodeScanned(result.data)}
          />
          <View style={styles.viewfinderWrap} pointerEvents="none">
            <View style={styles.viewfinder} />
          </View>
          <View style={styles.scannerOverlay}>
            <Text style={styles.scannerHint}>Line the barcode up in the box</Text>
            <Pressable style={styles.scannerClose} onPress={() => setScanning(false)}>
              <Text style={styles.scannerCloseText}>Cancel</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      <Modal visible={coverZoomed} transparent onRequestClose={closeCoverZoom}>
        <Pressable style={styles.zoomOverlay} onPress={closeCoverZoom}>
          <Animated.View style={[styles.zoomBackdrop, { opacity: backdropAnim }]} />
          {coverUrl && (
            <Animated.Image
              source={{ uri: coverUrl }}
              style={[
                styles.coverZoomed,
                { left: animLeft, top: animTop, width: animWidth, height: animHeight },
              ]}
              resizeMode="contain"
            />
          )}
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
    padding: 16,
  },
  scanButton: {
    marginBottom: 20,
  },
  label: {
    fontFamily: fonts.semibold,
    fontSize: 13,
    color: colors.textMuted,
    marginBottom: 6,
  },
  isbnRow: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'flex-start',
  },
  isbnInput: {
    flex: 1,
    marginBottom: 0,
  },
  lookupMessage: {
    fontFamily: fonts.regular,
    fontSize: 13,
    color: colors.textMuted,
    marginTop: 8,
  },
  coverWrap: {
    alignItems: 'center',
    marginTop: 12,
    marginBottom: 4,
  },
  cover: {
    width: 110,
    height: 165,
    backgroundColor: colors.chipBackground,
    overflow: 'hidden',
    ...organicCorners,
  },
  errorText: {
    fontFamily: fonts.medium,
    color: colors.danger,
    fontSize: 14,
    marginBottom: 12,
  },
  submit: {
    marginTop: 20,
  },
  scannerContainer: {
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
  scannerOverlay: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    padding: 24,
    alignItems: 'center',
    gap: 16,
  },
  scannerHint: {
    fontFamily: fonts.medium,
    fontSize: 15,
    color: '#fff',
    textAlign: 'center',
  },
  scannerClose: {
    backgroundColor: '#fff',
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: radius.md,
  },
  scannerCloseText: {
    fontFamily: fonts.semibold,
    fontSize: 14,
    color: colors.text,
  },
  zoomOverlay: {
    flex: 1,
  },
  zoomBackdrop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: '#000',
  },
  coverZoomed: {
    position: 'absolute',
    backgroundColor: colors.chipBackground,
  },
});
