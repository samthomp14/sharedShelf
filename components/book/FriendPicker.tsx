import { useEffect, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { fetchFriends, personName } from '../../lib/bookDetail';
import type { Person } from '../../lib/loans';
import { Avatar } from '../Avatar';
import { Button } from '../Button';
import { Skeleton } from '../Skeleton';
import { colors, fonts, organicCorners, radius, shadow } from '../../lib/theme';

interface FriendPickerProps {
  visible: boolean;
  uid: string;
  onPick: (friend: Person) => void;
  onClose: () => void;
}

// "Lend to a friend": a small sheet listing your friends. Picking one hands
// the choice back and closes; the caller runs the step and shows any error.
export function FriendPicker({ visible, uid, onPick, onClose }: FriendPickerProps) {
  const [friends, setFriends] = useState<Person[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    setError(null);
    fetchFriends(uid)
      .then((rows) => !cancelled && setFriends(rows))
      .catch((e: Error) => !cancelled && setError(e.message));
    return () => {
      cancelled = true;
    };
  }, [visible, uid]);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        {/* Swallow taps on the sheet itself so they don't close it. */}
        <Pressable style={styles.sheet} onPress={() => {}}>
          <Text style={styles.title}>Lend to a friend</Text>
          <ScrollView style={styles.list}>
            {error ? (
              <Text style={styles.empty}>{error}</Text>
            ) : !friends ? (
              [0, 1, 2].map((i) => (
                <View key={i} style={styles.row}>
                  <Skeleton width={36} height={36} style={organicCorners} />
                  <Skeleton width="50%" height={16} />
                </View>
              ))
            ) : friends.length === 0 ? (
              <Text style={styles.empty}>Add some friends first, then you can lend to them.</Text>
            ) : (
              friends.map((friend) => (
                <Pressable
                  key={friend.id}
                  style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
                  onPress={() => onPick(friend)}
                >
                  <Avatar avatarUrl={friend.avatar_url} label={personName(friend)} size={36} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.name}>{personName(friend)}</Text>
                    <Text style={styles.username}>@{friend.username}</Text>
                  </View>
                </Pressable>
              ))
            )}
          </ScrollView>
          <Button title="Cancel" variant="secondary" onPress={onClose} />
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(14, 17, 22, 0.4)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
  },
  sheet: {
    width: '100%',
    maxWidth: 420,
    maxHeight: '80%',
    backgroundColor: colors.background,
    borderRadius: radius.md,
    padding: 16,
    gap: 12,
    ...shadow,
  },
  title: { fontFamily: fonts.displaySemibold, fontSize: 18, color: colors.text },
  list: { flexGrow: 0 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  rowPressed: { opacity: 0.6 },
  name: { fontFamily: fonts.semibold, fontSize: 16, color: colors.text },
  username: { fontFamily: fonts.regular, fontSize: 13, color: colors.textMuted },
  empty: { fontFamily: fonts.regular, fontSize: 14, color: colors.textMuted, paddingVertical: 8 },
});
