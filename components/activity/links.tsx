import type { Href } from 'expo-router';
import { InlineLink } from '../InlineLink';
import { prefetchBook } from '../../lib/bookDetail';
import { profileHref } from '../../lib/profileHref';

// Inline name / book-title links for Activity feed lines.

export function personName(p: { username: string; display_name: string | null } | null | undefined) {
  return p?.display_name ?? p?.username ?? 'Someone';
}

export function bookHref(id: string, title: string, coverUrl: string | null): Href {
  return { pathname: '/book/[id]', params: { id, title, coverUrl: coverUrl ?? '' } };
}

export function PersonLink({
  person,
}: {
  person: { username: string; display_name: string | null; avatar_url: string | null };
}) {
  const name = personName(person);
  return <InlineLink href={profileHref(person.username, name, person.avatar_url)}>{name}</InlineLink>;
}

// The title in quotes, like the rest of the feed.
export function BookLink({ book }: { book: { id: string; title: string; cover_url: string | null } }) {
  return (
    <>
      "
      <InlineLink href={bookHref(book.id, book.title, book.cover_url)} onPressIn={() => prefetchBook(book.id)}>
        {book.title}
      </InlineLink>
      "
    </>
  );
}
