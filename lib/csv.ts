// RFC 4180 CSV: parsing (quoted fields with delimiters, doubled quotes and line breaks; a byte order mark; CRLF, LF or
// CR line ends) and writing, with delimiter sniffing for the comma, semicolon and tab files that brokers and
// spreadsheets export. Parsing is lenient where real files are sloppy: spaces around a quoted field, text after a
// closing quote and a missing closing quote are read instead of failing the whole file.

export type CsvDelimiter = "," | ";" | "\t";

/** In tie-break order: a file that splits equally well on several delimiters is read as comma-separated. */
export const CSV_DELIMITERS: readonly CsvDelimiter[] = [",", "\t", ";"];

export interface CsvTable {
  /** Records in file order. Empty lines are left out; a line of delimiters only is kept as empty fields. */
  rows: string[][];
  /** 1-based line on which each record starts, for messages such as "line 7". */
  lines: number[];
  delimiter: CsvDelimiter;
  /** True when the text ended inside a quoted field (the rest of the text was read as that field). */
  unterminated: boolean;
}

function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

function parse(text: string, delimiter: CsvDelimiter, maxRows = Infinity): CsvTable {
  const src = stripBom(text);
  const rows: string[][] = [];
  const lines: number[] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false; // the current field opened with a quote
  let inQuotes = false;
  let closed = false; // the current field's closing quote has been read
  let line = 1;
  let rowLine = 1;

  const endField = () => {
    row.push(field);
    field = "";
    quoted = false;
    closed = false;
  };
  const endRow = () => {
    endField();
    if (!(row.length === 1 && row[0] === "")) {
      rows.push(row);
      lines.push(rowLine);
    }
    row = [];
  };

  for (let i = 0; i < src.length && rows.length < maxRows; i++) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
          closed = true;
        }
      } else if (ch === "\r" || ch === "\n") {
        // A line break inside quotes belongs to the value; it is stored as \n whatever the file used.
        if (ch === "\r" && src[i + 1] === "\n") i++;
        field += "\n";
        line++;
      } else {
        field += ch;
      }
    } else if (ch === delimiter) {
      endField();
    } else if (ch === "\r" || ch === "\n") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      endRow();
      line++;
      rowLine = line;
    } else if (ch === '"' && !quoted && field.trim() === "") {
      // An opening quote, possibly after spaces that are not part of the value.
      inQuotes = true;
      quoted = true;
      field = "";
    } else if (!(closed && (ch === " " || ch === "\t"))) {
      // Spaces between a closing quote and the next delimiter are dropped; any other text is kept.
      field += ch;
    }
  }

  const unterminated = inQuotes;
  if (rows.length < maxRows && (field !== "" || row.length > 0 || quoted)) endRow();
  return { rows, lines, delimiter, unterminated };
}

/**
 * Picks the delimiter that splits the first records most consistently into two or more fields: the share of records
 * with the most common field count, then the field count, then the order of CSV_DELIMITERS. Quoted delimiters do not
 * count. Text with no consistent split (a single column, or words separated by spaces) is treated as comma-separated.
 */
export function sniffDelimiter(text: string): CsvDelimiter {
  const sample = stripBom(text).slice(0, 64 * 1024);
  let best: { delimiter: CsvDelimiter; share: number; fields: number } = { delimiter: ",", share: 0, fields: 0 };
  for (const delimiter of CSV_DELIMITERS) {
    const { rows } = parse(sample, delimiter, 50);
    if (rows.length === 0) continue;
    const counts = new Map<number, number>();
    for (const row of rows) counts.set(row.length, (counts.get(row.length) ?? 0) + 1);
    const [fields, frequency] = [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0];
    if (fields < 2) continue;
    const share = frequency / rows.length;
    if (share > best.share || (share === best.share && fields > best.fields)) best = { delimiter, share, fields };
  }
  return best.delimiter;
}

/** Parses CSV text into records; the delimiter is sniffed unless given. */
export function parseCsv(text: string, delimiter: CsvDelimiter = sniffDelimiter(text)): CsvTable {
  return parse(text, delimiter);
}

export type CsvCell = string | number | boolean | null | undefined;

const PLAIN_NUMBER = /^[+-]?(?:\d+(?:[.,]\d+)*|\.\d+)(?:[eE][+-]?\d+)?%?$/;

/**
 * Text that a spreadsheet would run as a formula (starting with =, +, -, @, a tab or a carriage return) gets a leading
 * apostrophe, so an exported file cannot carry a formula into Excel or Sheets. Plain numbers such as -12.30 are left
 * alone.
 */
function guardFormula(text: string): string {
  return /^[=+\-@\t\r]/.test(text) && !PLAIN_NUMBER.test(text) ? `'${text}` : text;
}

function formatCell(cell: CsvCell, delimiter: CsvDelimiter): string {
  if (cell === null || cell === undefined) return "";
  let text: string;
  if (typeof cell === "number") text = Number.isFinite(cell) ? String(cell) : "";
  else if (typeof cell === "boolean") text = String(cell);
  else text = guardFormula(cell);
  const needsQuotes = text.includes(delimiter) || /["\r\n]/.test(text) || /^\s|\s$/.test(text);
  return needsQuotes ? `"${text.replace(/"/g, '""')}"` : text;
}

/**
 * Writes records as CSV with CRLF line ends and a final line break (RFC 4180). Fields with the delimiter, quotes, line
 * breaks or edge spaces are quoted; null and undefined become empty fields and non-finite numbers too.
 */
export function stringifyCsv(rows: ReadonlyArray<ReadonlyArray<CsvCell>>, delimiter: CsvDelimiter = ","): string {
  if (rows.length === 0) return "";
  return `${rows.map((row) => row.map((cell) => formatCell(cell, delimiter)).join(delimiter)).join("\r\n")}\r\n`;
}

export interface DecodedText {
  text: string;
  /** The encoding the bytes were read as. */
  encoding: "utf-8" | "utf-16le" | "utf-16be" | "gb18030";
}

/**
 * Decodes an uploaded file. UTF-8 (with or without a byte order mark) is the norm; UTF-16 is what Excel's "Unicode
 * text" export writes (with a byte order mark); bytes that are not valid UTF-8 are read as GB18030, the superset of GBK
 * that mainland Chinese brokers and Excel on a Chinese system still produce.
 */
export function decodeText(bytes: ArrayBuffer | Uint8Array): DecodedText {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (view[0] === 0xff && view[1] === 0xfe) return { text: new TextDecoder("utf-16le").decode(view.subarray(2)), encoding: "utf-16le" };
  if (view[0] === 0xfe && view[1] === 0xff) return { text: new TextDecoder("utf-16be").decode(view.subarray(2)), encoding: "utf-16be" };
  try {
    return { text: stripBom(new TextDecoder("utf-8", { fatal: true }).decode(view)), encoding: "utf-8" };
  } catch {
    return { text: new TextDecoder("gb18030").decode(view), encoding: "gb18030" };
  }
}
