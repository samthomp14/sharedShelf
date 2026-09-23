// Pure ISBN helpers — no I/O. Everything is normalized to ISBN-13, which is
// what we store in books.isbn and what the add_book_to_shelf RPC expects.

function clean(raw: string): string {
  return raw.replace(/[\s-]/g, '').toUpperCase();
}

// ISBN-10: digits weighted 10..1 (X = 10, last position only); the weighted
// sum must be divisible by 11.
function isValidIsbn10(s: string): boolean {
  if (!/^\d{9}[\dX]$/.test(s)) return false;
  let sum = 0;
  for (let i = 0; i < 10; i++) {
    sum += (s[i] === 'X' ? 10 : Number(s[i])) * (10 - i);
  }
  return sum % 11 === 0;
}

// EAN-13: first 12 digits weighted alternately 1,3,1,3…; the check digit is
// whatever brings the total up to the next multiple of 10.
function ean13CheckDigit(first12: string): number {
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += Number(first12[i]) * (i % 2 === 0 ? 1 : 3);
  return (10 - (sum % 10)) % 10;
}

function isValidEan13(s: string): boolean {
  return /^\d{13}$/.test(s) && ean13CheckDigit(s.slice(0, 12)) === Number(s[12]);
}

export function normalizeIsbn(raw: string): string | null {
  const s = clean(raw);
  if (s.length === 10) {
    if (!isValidIsbn10(s)) return null;
    // ISBN-10 → 13: prefix 978, drop the old check digit, recompute.
    const first12 = `978${s.slice(0, 9)}`;
    return `${first12}${ean13CheckDigit(first12)}`;
  }
  if (s.length === 13 && /^97[89]/.test(s) && isValidEan13(s)) return s;
  return null;
}

export function looksLikeIsbn(input: string): boolean {
  return normalizeIsbn(input) !== null;
}

export type BarcodeClassification =
  | { kind: 'isbn'; isbn: string }
  | { kind: 'not_isbn'; reason: 'upc' | 'invalid' };

// For scanned barcodes: tells a book barcode apart from a product barcode
// (UPC-A, or an EAN-13 outside the 978/979 "Bookland" range).
export function classifyBarcode(data: string): BarcodeClassification {
  const isbn = normalizeIsbn(data);
  if (isbn) return { kind: 'isbn', isbn };
  const s = clean(data);
  if (/^\d{12}$/.test(s) || (/^\d{13}$/.test(s) && !/^97[89]/.test(s))) {
    return { kind: 'not_isbn', reason: 'upc' };
  }
  return { kind: 'not_isbn', reason: 'invalid' };
}
