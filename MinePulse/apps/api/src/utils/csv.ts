/** Minimal RFC-4180 CSV helpers (used by the export endpoints). */

export function csvEscape(value: unknown): string {
  if (value === null || value === undefined) return '';
  const str =
    typeof value === 'string'
      ? value
      : typeof value === 'object'
        ? JSON.stringify(value)
        : String(value);
  return /[",\r\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
}

export function toCsv(headers: string[], rows: Array<Array<unknown>>): string {
  const lines = [headers.map(csvEscape).join(',')];
  for (const row of rows) lines.push(row.map(csvEscape).join(','));
  // Trailing CRLF so the file ends cleanly in spreadsheets.
  return `${lines.join('\r\n')}\r\n`;
}
