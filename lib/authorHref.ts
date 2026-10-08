import type { Href } from 'expo-router';

// Author pages are keyed by authors.id; the name rides along as a route param
// so the page can paint the heading immediately. Without an id (only a name
// is known), the name goes in the id slot and the author page looks it up.
export function authorHref(author: { id?: string | null; name: string }): Href {
  return {
    pathname: '/author/[id]',
    params: { id: author.id || author.name, name: author.name },
  };
}
