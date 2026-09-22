import { Link, type Href } from 'expo-router';
import { colors, fonts } from '../lib/theme';

interface InlineLinkProps {
  href: Href;
  children: string;
  onPressIn?: () => void;
}

// A Link meant to sit inline inside a parent <Text>, styled like the rest
// of the sentence but tappable and underlined — e.g. a name or book title
// embedded in an activity feed line.
export function InlineLink({ href, children, onPressIn }: InlineLinkProps) {
  return (
    <Link href={href} onPressIn={onPressIn} style={styles.link}>
      {children}
    </Link>
  );
}

const styles = {
  link: {
    fontFamily: fonts.semibold,
    color: colors.text,
    textDecorationLine: 'underline' as const,
  },
};
