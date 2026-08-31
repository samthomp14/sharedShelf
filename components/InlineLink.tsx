import { Link } from 'expo-router';
import { colors, fonts } from '../lib/theme';

interface InlineLinkProps {
  href: string;
  children: string;
}

// A Link meant to sit inline inside a parent <Text>, styled like the rest
// of the sentence but tappable and underlined — e.g. a name or book title
// embedded in an activity feed line.
export function InlineLink({ href, children }: InlineLinkProps) {
  return (
    <Link href={href} style={styles.link}>
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
