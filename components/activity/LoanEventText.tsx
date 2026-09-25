import type { LoanFeedEvent } from '../../lib/loans';
import { BookLink, PersonLink } from './links';

// One loan step in the Recent feed, worded from the viewer's side. Goes
// inside the row's <Text>. Only the owner and borrower ever see these.
export function LoanEventText({ event }: { event: LoanFeedEvent }) {
  const who = <PersonLink person={event.counterpart} />;
  const book = <BookLink book={event.book} />;
  const owner = event.role === 'owner';

  switch (event.kind) {
    case 'requested':
      return owner ? (
        <>{who} asked to borrow {book}</>
      ) : (
        <>You asked to borrow {book} from {who}</>
      );
    case 'declined':
      return <>{who} declined your request for {book}</>;
    case 'promised':
      return owner ? (
        <>You promised {book} to {who}</>
      ) : (
        <>{who} promised you {book}</>
      );
    case 'handed_over':
      // byMe on the owner's side means a direct lend.
      if (owner) return event.byMe ? <>You lent {book} to {who}</> : <>{who} picked up {book}</>;
      return event.byMe ? <>You picked up {book} from {who}</> : <>{who} lent you {book}</>;
    case 'called_off':
      if (event.byMe) {
        return owner ? (
          <>You called off lending {book} to {who}</>
        ) : (
          <>You called off borrowing {book} from {who}</>
        );
      }
      return owner ? (
        <>{who} called off borrowing {book}</>
      ) : (
        <>{who} called off lending you {book}</>
      );
    case 'returned':
      return owner ? <>{book} is back on your shelf</> : <>You returned {book} to {who}</>;
    case 'removed':
      return owner ? (
        <>You removed {book} from your shelf. The loan's closed.</>
      ) : (
        <>{who} removed {book} from their shelf. The loan's closed.</>
      );
  }
}
