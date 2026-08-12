export function parseDelimited(
  text: string,
  delimiter: ',' | '\t',
): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;

  const pushField = () => {
    row.push(field);
    field = '';
  };
  const pushRow = () => {
    pushField();
    rows.push(row);
    row = [];
  };

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
      continue;
    }
    if (char === '"') {
      inQuotes = true;
      continue;
    }
    if (char === delimiter) {
      pushField();
      continue;
    }
    if (char === '\n' || char === '\r') {
      if (char === '\r' && text[i + 1] === '\n') i++;
      pushRow();
      continue;
    }
    field += char;
  }
  if (field.length > 0 || row.length > 0) pushRow();

  const cleaned = rows
    .map((r) => r.map((cell) => cell.trim()))
    .filter((r) => r.some((cell) => cell.length > 0));
  return cleaned;
}

export function parseCsv(text: string): string[][] {
  return parseDelimited(text, ',');
}

/**
 * Paste from a spreadsheet (Excel/Google Sheets copies a selection as
 * tab-separated text). Sniff the delimiter from the first non-empty line:
 * tabs win, comma is the fallback — both end up as the same string[][]
 * shape, so pasted and uploaded data hit the exact same analysis pipeline.
 */
export function parsePasted(text: string): string[][] {
  const firstLine = text.split(/\r?\n/).find((l) => l.trim().length > 0) ?? '';
  const delimiter = firstLine.includes('\t') ? '\t' : ',';
  return parseDelimited(text, delimiter);
}

export function isEmailLike(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

export function isPhoneLike(value: string): boolean {
  return /^\+?[\d\s\-()]{7,}$/.test(value) && /\d{4,}/.test(value);
}
