import { Text, type TextStyle } from 'react-native';
import { Link } from 'expo-router';
import { colors, fonts } from '../lib/theme';

interface AuthorListProps {
  authors: string[];
  textStyle?: TextStyle;
}

export function AuthorList({ authors, textStyle }: AuthorListProps) {
  if (!authors.length) return null;
  return (
    <Text style={textStyle}>
      {authors.map((author, i) => (
        <Text key={author}>
          <Link href={`/author/${encodeURIComponent(author)}`} style={styles.link}>
            {author}
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
