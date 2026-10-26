// Reads a product sheet (CSV or Excel .xlsx) into rows of strings — the first row is the header.
// Dependency-free: CSV is parsed per RFC 4180; .xlsx is unzipped with the browser's built-in
// DecompressionStream and its XML read with DOMParser.

export async function readSpreadsheet(file: File): Promise<string[][]> {
  const name = file.name.toLowerCase();
  if (name.endsWith('.xlsx')) return parseXlsx(await file.arrayBuffer());
  if (name.endsWith('.xls')) {
    throw new Error('Old .xls files are not supported. Please save the sheet as .xlsx or .csv and upload again.');
  }
  return parseCsv(await file.text());
}

export function parseCsv(input: string): string[][] {
  const text = input.replace(/^\uFEFF/, '');
  const firstLine = text.slice(0, text.search(/\r?\n|$/));
  const delimiter = [',', ';', '\t'].reduce((best, d) =>
    firstLine.split(d).length > firstLine.split(best).length ? d : best, ',');

  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;

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
    } else if (char === '"' && field.trim() === '') {
      field = '';
      inQuotes = true;
    } else if (char === delimiter) {
      row.push(field.trim());
      field = '';
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && text[i + 1] === '\n') i++;
      row.push(field.trim());
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += char;
    }
  }
  if (field !== '' || row.length > 0) {
    row.push(field.trim());
    rows.push(row);
  }
  return rows.filter((r) => r.some((cell) => cell !== ''));
}

// ── .xlsx ──────────────────────────────────────────────────────────────────

type ZipEntry = { method: number; compressedSize: number; localOffset: number };

function readZipDirectory(bytes: Uint8Array): Map<string, ZipEntry> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65_557); i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('This file is not a valid .xlsx workbook.');

  const entryCount = view.getUint16(eocd + 10, true);
  let offset = view.getUint32(eocd + 16, true);
  const entries = new Map<string, ZipEntry>();
  const decoder = new TextDecoder();
  for (let n = 0; n < entryCount; n++) {
    if (view.getUint32(offset, true) !== 0x02014b50) break;
    const method = view.getUint16(offset + 10, true);
    const compressedSize = view.getUint32(offset + 20, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const localOffset = view.getUint32(offset + 42, true);
    const name = decoder.decode(bytes.subarray(offset + 46, offset + 46 + nameLength));
    entries.set(name, { method, compressedSize, localOffset });
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

async function readZipFile(bytes: Uint8Array, entries: Map<string, ZipEntry>, path: string): Promise<string | null> {
  const entry = entries.get(path);
  if (!entry) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const start = entry.localOffset + 30 + view.getUint16(entry.localOffset + 26, true) + view.getUint16(entry.localOffset + 28, true);
  const data = bytes.subarray(start, start + entry.compressedSize);
  if (entry.method === 0) return new TextDecoder().decode(data);
  if (entry.method !== 8) throw new Error('Unsupported compression in .xlsx file.');
  const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Response(stream).text();
}

const byTag = (node: Document | Element, tag: string) => Array.from(node.getElementsByTagNameNS('*', tag));
const textOf = (node: Element) => byTag(node, 't').map((t) => t.textContent || '').join('');

function columnIndex(cellRef: string): number {
  const letters = cellRef.replace(/[^A-Z]/gi, '').toUpperCase();
  let index = 0;
  for (const letter of letters) index = index * 26 + (letter.charCodeAt(0) - 64);
  return index - 1;
}

export async function parseXlsx(buffer: ArrayBuffer): Promise<string[][]> {
  const bytes = new Uint8Array(buffer);
  const entries = readZipDirectory(bytes);
  const parser = new DOMParser();
  const xml = async (path: string) => {
    const text = await readZipFile(bytes, entries, path);
    return text ? parser.parseFromString(text, 'application/xml') : null;
  };

  // Locate the first worksheet via workbook.xml + its relationships
  let sheetPath = 'xl/worksheets/sheet1.xml';
  const [workbook, rels] = await Promise.all([xml('xl/workbook.xml'), xml('xl/_rels/workbook.xml.rels')]);
  const firstSheet = workbook ? byTag(workbook, 'sheet')[0] : undefined;
  const relId = firstSheet?.getAttribute('r:id') || firstSheet?.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id');
  const target = relId && rels ? byTag(rels, 'Relationship').find((r) => r.getAttribute('Id') === relId)?.getAttribute('Target') : undefined;
  if (target) sheetPath = target.startsWith('/') ? target.slice(1) : `xl/${target.replace(/^\.\//, '')}`;

  const [sharedDoc, sheet] = await Promise.all([xml('xl/sharedStrings.xml'), xml(sheetPath)]);
  if (!sheet) throw new Error('Could not find a worksheet in this .xlsx file.');
  const shared = sharedDoc ? byTag(sharedDoc, 'si').map(textOf) : [];

  const rows: string[][] = [];
  for (const rowEl of byTag(sheet, 'row')) {
    const row: string[] = [];
    byTag(rowEl, 'c').forEach((cell, position) => {
      const ref = cell.getAttribute('r');
      const index = ref ? columnIndex(ref) : position;
      const type = cell.getAttribute('t');
      const raw = byTag(cell, 'v')[0]?.textContent ?? '';
      let value: string;
      if (type === 's') value = shared[Number(raw)] ?? '';
      else if (type === 'inlineStr') value = textOf(cell);
      else if (type === 'b') value = raw === '1' ? 'TRUE' : 'FALSE';
      else value = raw;
      row[index] = value.trim();
    });
    const filled = Array.from(row, (v) => v ?? '');
    if (filled.some((v) => v !== '')) rows.push(filled);
  }
  return rows;
}
