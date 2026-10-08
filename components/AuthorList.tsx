import { Text, type TextStyle } from 'react-native';
import { Link } from 'expo-router';
import { authorHref } from '../lib/authorHref';
import { colors, fonts } from '../lib/theme';

interface AuthorListProps {
  // Linked by id when known; a name-only author links by name (the author
  // page looks it up).
  authors: { id?: string | null; name: string }[];
  textStyle?: TextStyle;
}

export function AuthorList({ authors, textStyle }: AuthorListProps) {
  if (!authors.length) return null;
  return (
    <Text style={textStyle}>
      {authors.map((author, i) => (
        <Text key={author.id ?? author.name}>
          <Link href={authorHref(author)} style={styles.link}>
            {author.name}
          </Link>
          {i < authors.length - 1 ? ', ' : ''}
        </Text>
      ))}
    </Text>
  );
}

const styles = {
  link: {
    fontFamily: fonts.regular,
    color: colors.text,
    textDecorationLine: 'underline' as const,
  },
};
