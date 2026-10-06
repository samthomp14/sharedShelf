import { useCallback, useState } from 'react';
import { useFocusEffect, useRouter } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { supabase } from '../../../../lib/supabase';
import { useAuth } from '../../../../contexts/AuthContext';
import { Avatar } from '../../../../components/Avatar';
import { Button } from '../../../../components/Button';
import { ShareAppButton } from '../../../../components/ShareAppButton';
import { ShelfGrid, type ShelfGridBadge } from '../../../../components/ShelfGrid';
import { ProfileTabs } from '../../../../components/profile/ProfileTabs';
import { BorrowingList, LentOutList } from '../../../../components/profile/LoanList';
import { ToastProvider, useToast } from '../../../../components/Toast';
import { Skeleton } from '../../../../components/Skeleton';
import { RefreshControl } from '../../../../components/RefreshControl';
import { useRefetchOnVisible, useRefreshing } from '../../../../lib/refresh';
import {
  cancelRequest,
  fetchBorrowing,
  fetchMyCopies,
  fetchMyPendingRequests,
  firstName,
  markHandedOver,
  markReturned,
  denyReturn,
  claimReturned,
  type ActiveLoan,
  type MyCopy,
  type OutgoingRequest,
} from '../../../../lib/loans';
import { colors, fonts, organicCorners } from '../../../../lib/theme';

interface OwnProfile {
  username: string;
  display_name: string | null;
  avatar_url: string | null;
  bio: string | null;
}

type ShelfTab = 'library' | 'lent' | 'borrowing';

// Your own shelf says who has a copy; friends only ever see "Unavailable".
function copyBadge(copy: MyCopy): ShelfGridBadge | null {
  const borrower = firstName(copy.activeLoan?.borrower);
  const initial = borrower.charAt(0).toUpperCase();
  if (copy.lend_status === 'promised') return { kind: 'promised', label: `For ${borrower}`, initial };
  if (copy.lend_status === 'on_loan') return { kind: 'out', label: `With ${borrower}`, initial };
  if (copy.visibility === 'private') return { kind: 'off', label: 'Hidden' };
  if (copy.lend_status === 'unavailable') return { kind: 'off', label: 'Not lending' };
  return null;
}

export default function Profile() {
  return (
    <ToastProvider>
      <ProfileScreen />
    </ToastProvider>
  );
}

function ProfileScreen() {
  const router = useRouter();
  const toast = useToast();
  const { session } = useAuth();
  const uid = session?.user?.id ?? null;
  const [profile, setProfile] = useState<OwnProfile | null>(null);
  const [friendCount, setFriendCount] = useState(0);
  const [copies, setCopies] = useState<MyCopy[]>([]);
  const [borrowing, setBorrowing] = useState<ActiveLoan[]>([]);
  const [requests, setRequests] = useState<OutgoingRequest[]>([]);
  const [actingId, setActingId] = useState<string | null>(null);
  const [tab, setTab] = useState<ShelfTab>('library');
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!uid) {
      setLoading(false);
      return;
    }
    setLoading(true);

    // The loan reads throw (and log) on failure; keep whatever we had.
    const [profileResult, countResult, copiesResult, borrowingResult, requestsResult] = await Promise.all([
      supabase.from('profiles').select('username, display_name, avatar_url, bio').eq('id', uid).single(),
      supabase.rpc('friend_count', { target: uid }),
      fetchMyCopies(uid).catch(() => null),
      fetchBorrowing(uid).catch(() => null),
      fetchMyPendingRequests(uid).catch(() => null),
    ]);

    if (!profileResult.error && profileResult.data) {
      setProfile(profileResult.data);
    }
    if (!countResult.error && typeof countResult.data === 'number') {
      setFriendCount(countResult.data);
    }
    if (copiesResult) setCopies(copiesResult);
    if (borrowingResult) setBorrowing(borrowingResult);
    if (requestsResult) setRequests(requestsResult);
    setLoading(false);
  }, [uid]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );
  const { refreshing, onRefresh } = useRefreshing(load);
  useRefetchOnVisible(load);

  // Runs one lending step, shows its refusal (if any) as a toast, then
  // reloads — the state may have moved on either way.
  async function runLoanStep(id: string, run: () => Promise<unknown>) {
    setActingId(id);
    try {
      await run();
    } catch (e) {
      toast.show({ message: e instanceof Error ? e.message : 'Something went wrong' });
    }
    setActingId(null);
    load();
  }

  // Nothing to instant-paint from here (it's a tab, not tapped into from a
  // list) — skeleton the whole layout until the first load lands. Once we
  // have a profile, keep showing it on later refocuses instead of blanking
  // out while a background refresh is in flight.
  if (!profile) {
    return (
      <ScrollView style={styles.container} contentContainerStyle={styles.content}>
        <View style={styles.topRow}>
          <Skeleton width={80} height={80} style={organicCorners} />
          <View style={styles.stats}>
            <View style={styles.stat}>
              <Skeleton width={28} height={18} style={styles.statSkeleton} />
              <Skeleton width={40} height={12} style={styles.statSkeleton} />
            </View>
            <View style={styles.stat}>
              <Skeleton width={28} height={18} style={styles.statSkeleton} />
              <Skeleton width={40} height={12} style={styles.statSkeleton} />
            </View>
          </View>
        </View>
        <Skeleton width="50%" height={19} />
        <Skeleton width="30%" height={14} style={styles.usernameSkeleton} />
        <View style={styles.actions}>
          <Skeleton height={44} borderRadius={999} style={styles.action} />
          <Skeleton height={44} borderRadius={999} style={styles.action} />
        </View>
        <View style={styles.grid}>
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} width="31%" style={styles.gridTile} />
          ))}
        </View>
      </ScrollView>
    );
  }

  const name = profile.display_name ?? profile.username;
  // Lent out comes from the copies' active loans (no extra fetch).
  const lentOut = copies.flatMap((copy) => (copy.activeLoan ? [copy.activeLoan] : []));

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
    >
      <View style={styles.topRow}>
        <Avatar avatarUrl={profile.avatar_url} label={name} size={80} />
        <View style={styles.stats}>
          <View style={styles.stat}>
            <Text style={styles.statNumber}>{copies.length}</Text>
            <Text style={styles.statLabel}>{copies.length === 1 ? 'book' : 'books'}</Text>
          </View>
          <Pressable style={styles.stat} onPress={() => router.push('/profile/friends')}>
            <Text style={styles.statNumber}>{friendCount}</Text>
            <Text style={styles.statLabel}>{friendCount === 1 ? 'friend' : 'friends'}</Text>
          </Pressable>
        </View>
      </View>

      <Text style={styles.name}>{name}</Text>
      <Text style={styles.username}>@{profile.username}</Text>
      {profile.bio && <Text style={styles.bio}>{profile.bio}</Text>}

      <View style={styles.actions}>
        <Button
          title="Edit profile"
          variant="secondary"
          onPress={() =>
            router.push({
              pathname: '/profile/settings',
              params: {
                username: profile.username,
                displayName: profile.display_name ?? '',
                bio: profile.bio ?? '',
              },
            })
          }
          style={styles.action}
        />
        <ShareAppButton style={styles.action} />
      </View>

      <ProfileTabs
        tabs={[
          { key: 'library', label: 'Library', count: copies.length },
          { key: 'lent', label: 'Lent out', count: lentOut.length },
          // Requests you've sent show on the tab but don't count: only books
          // you have or are picking up.
          { key: 'borrowing', label: 'Borrowing', count: borrowing.length },
        ]}
        active={tab}
        onChange={setTab}
      />

      {tab === 'library' && (
        <ShelfGrid
          items={copies.map((copy) => ({ id: copy.id, book: copy.book, badge: copyBadge(copy) }))}
          emptyText="Your shelf is empty. Add a book to get started."
        />
      )}
      {tab === 'lent' && (
        <LentOutList
          loans={lentOut}
          actingId={actingId}
          onHandedOver={(loan) => runLoanStep(loan.id, () => markHandedOver(loan.id))}
          onReturned={(loan) => runLoanStep(loan.id, () => markReturned(loan.id))}
          onNotYet={(loan) => runLoanStep(loan.id, () => denyReturn(loan.id))}
          emptyText="Nothing lent out right now. When you say yes to a friend, the book shows up here."
        />
      )}
      {tab === 'borrowing' && (
        <BorrowingList
          loans={borrowing}
          requests={requests}
          actingId={actingId}
          onGotIt={(loan) => runLoanStep(loan.id, () => markHandedOver(loan.id))}
          onReturned={(loan) => runLoanStep(loan.id, () => claimReturned(loan.id))}
          onCancelRequest={(request) => runLoanStep(request.id, () => cancelRequest(request.id))}
          emptyText="You're not borrowing anything. Spot something on a friend's shelf and ask to borrow it."
        />
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: 16, flexGrow: 1 },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 24,
    marginBottom: 16,
  },
  stats: {
    flex: 1,
    flexDirection: 'row',
  },
  stat: {
    flex: 1,
    alignItems: 'center',
  },
  statSkeleton: {
    marginTop: 4,
  },
  statNumber: {
    fontFamily: fonts.semibold,
    fontSize: 18,
    color: colors.text,
  },
  statLabel: {
    fontFamily: fonts.regular,
    fontSize: 13,
    color: colors.textMuted,
    marginTop: 2,
  },
  name: {
    fontFamily: fonts.displayItalic,
    fontSize: 19,
    color: colors.text,
  },
  username: {
    fontFamily: fonts.regular,
    fontSize: 14,
    color: colors.textMuted,
    marginTop: 2,
  },
  usernameSkeleton: {
    marginTop: 6,
  },
  bio: {
    fontFamily: fonts.regular,
    fontSize: 14,
    color: colors.text,
    marginTop: 8,
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    marginTop: 16,
    marginBottom: 24,
  },
  action: {
    flex: 1,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'flex-start',
    gap: 12,
  },
  gridTile: {
    aspectRatio: 2 / 3,
    ...organicCorners,
  },
});
