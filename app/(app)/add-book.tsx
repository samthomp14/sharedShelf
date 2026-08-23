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
import { supabase } from '../../lib/supabase';
import { Button } from '../../components/Button';
import { colors, fonts, inputStyle } from '../../lib/theme';

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
  const coverRef = useRef<View>(null);
  const sourceRectRef = useRef<Rect | null>(null);
  const scaleAnim = useRef(new Animated.Value(1)).current;
  const translateXAnim = useRef(new Animated.Value(0)).current;
  const translateYAnim = useRef(new Animated.Value(0)).current;
  const backdropAnim = useRef(new Animated.Value(0)).current;

  // Compute the scale/translate needed so the (centered, full-size) zoomed
  // image visually lines up with the small cover's actual on-screen rect.
  function alignmentFor(rect: Rect) {
    const { width: winW, height: winH } = Dimensions.get('window');
    const sourceCenterX = rect.x + rect.width / 2;
    const sourceCenterY = rect.y + rect.height / 2;
    return {
      scale: rect.width / ZOOMED_COVER_WIDTH,
      translateX: sourceCenterX - winW / 2,
      translateY: sourceCenterY - winH / 2,
    };
  }

  function openCoverZoom() {
    coverRef.current?.measureInWindow((x, y, width, height) => {
      const rect = { x, y, width, height };
      sourceRectRef.current = rect;
      const { scale, translateX, translateY } = alignmentFor(rect);

      // Start exactly at the cover's current position/size — no reset.
      scaleAnim.setValue(scale);
      translateXAnim.setValue(translateX);
      translateYAnim.setValue(translateY);
      backdropAnim.setValue(0);
      setCoverZoomed(true);

      Animated.parallel([
        Animated.timing(scaleAnim, {
          toValue: 1,
          duration: 280,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.timing(translateXAnim, {
          toValue: 0,
          duration: 280,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.timing(translateYAnim, {
          toValue: 0,
          duration: 280,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.timing(backdropAnim, {
          toValue: 1,
          duration: 280,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
      ]).start();
    });
  }

  function closeCoverZoom() {
    const rect = sourceRectRef.current;
    const target = rect ? alignmentFor(rect) : { scale: 0.6, translateX: 0, translateY: 0 };

    Animated.parallel([
      Animated.timing(scaleAnim, {
        toValue: target.scale,
        duration: 220,
        easing: Easing.in(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.timing(translateXAnim, {
        toValue: target.translateX,
        duration: 220,
        easing: Easing.in(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.timing(translateYAnim, {
        toValue: target.translateY,
        duration: 220,
        easing: Easing.in(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.timing(backdropAnim, {
        toValue: 0,
        duration: 220,
        easing: Easing.in(Easing.cubic),
        useNativeDriver: true,
      }),
    ]).start(() => {
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

    const { data: userData } = await supabase.auth.getUser();
    const uid = userData.user?.id;
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
        <Pressable ref={coverRef} style={styles.coverWrap} onPress={openCoverZoom}>
          <Image source={{ uri: coverUrl }} style={styles.cover} resizeMode="contain" />
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
                {
                  transform: [
                    { translateX: translateXAnim },
                    { translateY: translateYAnim },
                    { scale: scaleAnim },
                  ],
                },
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
  },
  scannerCloseText: {
    fontFamily: fonts.semibold,
    fontSize: 14,
    color: colors.text,
  },
  zoomOverlay: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
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
    width: ZOOMED_COVER_WIDTH,
    height: ZOOMED_COVER_HEIGHT,
  },
});
