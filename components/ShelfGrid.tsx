import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { MiniAvatar } from './profile/MiniAvatar';
import { prefetchBook } from '../lib/bookDetail';
import { colors, fonts, organicCorners } from '../lib/theme';

// A status pill laid over the bottom of a cover. Dashed means agreed but not
// handed over yet, solid ink means it's out of the owner's hands.
//   out         — your copy is with a friend: "With Jonah" (ink)
//   promised    — your copy is promised: "For Maya" (dashed)
//   off         — you've marked your copy not lending (lock, faded cover)
//   unavailable — a friend's copy you can't borrow right now; never says who
//                 has it (faded cover)
export interface ShelfGridBadge {
  kind: 'out' | 'promised' | 'off' | 'unavailable';
  label: string;
  // Borrower's initial for the tiny avatar on out/promised.
  initial?: string;
}

export interface ShelfGridItem {
  id: string;
  book: { id: string; title: string; cover_url: string | null } | null;
  badge?: ShelfGridBadge | null;
}

interface ShelfGridProps {
  items: ShelfGridItem[];
  emptyText: string;
}

export function ShelfGrid({ items, emptyText }: ShelfGridProps) {
  const router = useRouter();

  if (items.length === 0) {
    return <Text style={styles.emptyText}>{emptyText}</Text>;
  }

  return (
    <View style={styles.grid}>
      {items.map((item) => {
        const faded = item.badge?.kind === 'off' || item.badge?.kind === 'unavailable';
        return (
          <Pressable
            key={item.id}
            style={styles.card}
            onPressIn={() => item.book && prefetchBook(item.book.id)}
            onPress={() =>
              item.book &&
              router.push({
                pathname: '/book/[id]',
                params: { id: item.book.id, title: item.book.title, coverUrl: item.book.cover_url ?? '' },
              })
            }
          >
            <View style={faded && styles.faded}>
              {item.book?.cover_url ? (
                <Image source={{ uri: item.book.cover_url }} style={styles.cover} resizeMode="cover" />
              ) : (
                <View style={styles.spinePlaceholder}>
                  <Text style={styles.spineTitle} numberOfLines={5}>
                    {item.book?.title ?? 'Unknown title'}
                  </Text>
                </View>
              )}
            </View>
            {item.badge && <CoverBadge badge={item.badge} />}
          </Pressable>
        );
      })}
    </View>
  );
}

function CoverBadge({ badge }: { badge: ShelfGridBadge }) {
  const dark = badge.kind === 'out';
  return (
    <View style={[styles.badge, styles[badge.kind]]}>
      {badge.kind === 'off' && <LockGlyph />}
      {(badge.kind === 'out' || badge.kind === 'promised') && badge.initial && (
        <MiniAvatar label={badge.initial} size={16} />
      )}
      <Text
        style={[styles.badgeText, dark ? styles.badgeTextDark : badge.kind === 'promised' ? styles.badgeTextInk : null]}
        numberOfLines={1}
      >
        {badge.label}
      </Text>
    </View>
  );
}

// A small padlock drawn with Views (no icon library): shackle over a body.
function LockGlyph() {
  return (
    <View style={styles.lock}>
      <View style={styles.lockShackle} />
      <View style={styles.lockBody} />
    </View>
  );
}

const styles = StyleSheet.create({
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'flex-start',
    gap: 12,
  },
  card: {
    width: '31%',
  },
  faded: {
    opacity: 0.5,
  },
  cover: {
    width: '100%',
    aspectRatio: 2 / 3,
    backgroundColor: colors.chipBackground,
    overflow: 'hidden',
    ...organicCorners,
  },
  spinePlaceholder: {
    width: '100%',
    aspectRatio: 2 / 3,
    backgroundColor: colors.chipBackground,
    padding: 8,
    justifyContent: 'center',
    overflow: 'hidden',
    ...organicCorners,
  },
  spineTitle: {
    fontFamily: fonts.display,
    fontSize: 12,
    color: colors.text,
    textAlign: 'center',
  },
  badge: {
    position: 'absolute',
    left: 6,
    right: 6,
    bottom: 6,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    minHeight: 26,
    borderRadius: 8,
    paddingVertical: 5,
    paddingHorizontal: 7,
    overflow: 'hidden',
  },
  out: {
    backgroundColor: 'rgba(14, 17, 22, 0.86)',
  },
  promised: {
    backgroundColor: colors.background,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: colors.text,
    // Keep the same height as the borderless pills.
    paddingVertical: 4,
    paddingHorizontal: 6,
  },
  off: {
    backgroundColor: 'rgba(245, 247, 250, 0.92)',
  },
  unavailable: {
    backgroundColor: 'rgba(245, 247, 250, 0.92)',
  },
  badgeText: {
    flexShrink: 1,
    fontFamily: fonts.semibold,
    fontSize: 11,
    color: colors.textMuted,
  },
  badgeTextDark: {
    color: colors.background,
  },
  badgeTextInk: {
    color: colors.text,
  },
  lock: {
    width: 10,
    height: 12,
    alignItems: 'center',
  },
  lockShackle: {
    width: 7,
    height: 6,
    borderWidth: 1.5,
    borderBottomWidth: 0,
    borderColor: colors.textMuted,
    borderTopLeftRadius: 3.5,
    borderTopRightRadius: 3.5,
  },
  lockBody: {
    width: 10,
    height: 6,
    borderRadius: 1.5,
    backgroundColor: colors.textMuted,
  },
  emptyText: {
    fontFamily: fonts.regular,
    fontSize: 14,
    color: colors.textMuted,
    textAlign: 'center',
    paddingTop: 8,
  },
});
