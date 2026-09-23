import { useRef, useState } from 'react';
import {
  Animated,
  Dimensions,
  Easing,
  Image,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Button } from '../Button';
import { Chip } from '../Chip';
import { colors, fonts, organicCorners } from '../../lib/theme';

// Read-only result for the add-book flow: cover, title, authors and a single
// "Add to shelf" action. Deliberately no editable fields — a book found by
// scan or search is added exactly as the catalog/source describes it.

export type BookResultStatus = 'addable' | 'adding' | 'added' | 'on_shelf';

export interface BookResultCardBook {
  title: string;
  authors: string[];
  coverUrl: string | null;
}

interface BookResultCardProps {
  book: BookResultCardBook;
  status: BookResultStatus;
  onAdd: () => void;
  onSkip?: () => void;
  // Small provenance line, e.g. "From Open Library".
  note?: string;
  error?: string | null;
}

const ZOOMED_COVER_WIDTH = 240;
const ZOOMED_COVER_HEIGHT = 360;

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function BookResultCard({ book, status, onAdd, onSkip, note, error }: BookResultCardProps) {
  const [coverZoomed, setCoverZoomed] = useState(false);
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
    // Measure the Image itself, not the Pressable wrapping it — a wrapper
    // can stretch wider than its child, so measuring it instead of the
    // image gave a rect way wider than what's actually visible on screen.
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

  return (
    <View style={styles.card}>
      <View style={styles.body}>
        {book.coverUrl ? (
          <Pressable onPress={openCoverZoom} accessibilityLabel="Enlarge cover">
            <Image
              ref={coverImageRef}
              source={{ uri: book.coverUrl }}
              style={styles.cover}
              resizeMode="cover"
            />
          </Pressable>
        ) : (
          <View style={[styles.cover, styles.coverPlaceholder]}>
            <Text style={styles.coverPlaceholderText} numberOfLines={4}>
              {book.title}
            </Text>
          </View>
        )}

        <View style={styles.details}>
          <Text style={styles.title} numberOfLines={3}>
            {book.title}
          </Text>
          {book.authors.length > 0 && (
            <Text style={styles.authors} numberOfLines={2}>
              {book.authors.join(', ')}
            </Text>
          )}
          {note && <Text style={styles.note}>{note}</Text>}
        </View>
      </View>

      {error && <Text style={styles.errorText}>{error}</Text>}

      <View style={styles.actions}>
        {status === 'on_shelf' ? (
          <View style={styles.onShelf}>
            <Chip label="On your shelf" />
          </View>
        ) : (
          <Button
            title={status === 'added' ? 'Added ✓' : 'Add to shelf'}
            onPress={onAdd}
            loading={status === 'adding'}
            disabled={status === 'added'}
            style={[styles.primaryAction, status === 'added' && styles.addedAction]}
          />
        )}
        {onSkip && <Button title="Skip" variant="secondary" onPress={onSkip} />}
      </View>

      <Modal visible={coverZoomed} transparent onRequestClose={closeCoverZoom}>
        <Pressable style={styles.zoomOverlay} onPress={closeCoverZoom}>
          <Animated.View style={[styles.zoomBackdrop, { opacity: backdropAnim }]} />
          {book.coverUrl && (
            <Animated.Image
              source={{ uri: book.coverUrl }}
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
  card: {
    gap: 14,
  },
  body: {
    flexDirection: 'row',
    gap: 14,
  },
  cover: {
    width: 80,
    height: 120,
    backgroundColor: colors.chipBackground,
    overflow: 'hidden',
    ...organicCorners,
  },
  coverPlaceholder: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: 6,
  },
  coverPlaceholderText: {
    fontFamily: fonts.display,
    fontSize: 10,
    color: colors.text,
    textAlign: 'center',
  },
  details: {
    flex: 1,
    justifyContent: 'center',
  },
  title: {
    fontFamily: fonts.display,
    fontSize: 18,
    lineHeight: 26,
    color: colors.text,
  },
  authors: {
    fontFamily: fonts.regular,
    fontSize: 14,
    color: colors.textMuted,
    marginTop: 4,
  },
  note: {
    fontFamily: fonts.regular,
    fontSize: 12,
    color: colors.textFaint,
    marginTop: 8,
  },
  errorText: {
    fontFamily: fonts.medium,
    color: colors.danger,
    fontSize: 14,
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  primaryAction: {
    flex: 1,
  },
  addedAction: {
    backgroundColor: colors.success,
  },
  onShelf: {
    flex: 1,
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
