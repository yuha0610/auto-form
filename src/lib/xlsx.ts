import { inflateRawSync } from "node:zlib";

const EOCD_SIGNATURE = 0x06054b50;
const EOCD_MIN_SIZE = 22;
const CENTRAL_HEADER_SIZE = 46;
const LOCAL_HEADER_SIZE = 30;
const STORED = 0;

/** 末尾からEnd of Central Directoryレコードを探す(コメント付きzipに備えて後ろから走る)。 */
function findEndOfCentralDirectory(buf: Buffer): number {
  for (let i = buf.length - EOCD_MIN_SIZE; i >= 0; i--) {
    if (buf.readUInt32LE(i) === EOCD_SIGNATURE) return i;
  }
  throw new Error("zipの終端レコードが見つかりません");
}

/**
 * zipから指定したファイルを取り出す。xlsxはzipなので、これで中のXMLを読める。
 * 格納方式はstoredとdeflateだけを扱う(Excelが出すxlsxはこの2つ)。
 */
function readZipEntry(buf: Buffer, entryName: string): Buffer {
  const eocd = findEndOfCentralDirectory(buf);
  const entryCount = buf.readUInt16LE(eocd + 10);
  let offset = buf.readUInt32LE(eocd + 16);

  for (let i = 0; i < entryCount; i++) {
    const method = buf.readUInt16LE(offset + 10);
    const compressedSize = buf.readUInt32LE(offset + 20);
    const nameLength = buf.readUInt16LE(offset + 28);
    const extraLength = buf.readUInt16LE(offset + 30);
    const commentLength = buf.readUInt16LE(offset + 32);
    const localOffset = buf.readUInt32LE(offset + 42);
    const name = buf.toString("utf8", offset + CENTRAL_HEADER_SIZE, offset + CENTRAL_HEADER_SIZE + nameLength);

    if (name === entryName) {
      // ローカルヘッダーの可変長部分は中央ディレクトリの値と一致しないことがあるので読み直す
      const localNameLength = buf.readUInt16LE(localOffset + 26);
      const localExtraLength = buf.readUInt16LE(localOffset + 28);
      const start = localOffset + LOCAL_HEADER_SIZE + localNameLength + localExtraLength;
      const data = buf.subarray(start, start + compressedSize);
      return method === STORED ? data : inflateRawSync(data);
    }

    offset += CENTRAL_HEADER_SIZE + nameLength + extraLength + commentLength;
  }

  throw new Error(`zipに${entryName}が入っていません`);
}

const NUMERIC_ENTITY_REGEX = /&#(x[0-9a-f]+|\d+);/gi;

function decodeXmlText(value: string): string {
  return value
    .replace(NUMERIC_ENTITY_REGEX, (_, code: string) =>
      String.fromCodePoint(code[0].toLowerCase() === "x" ? parseInt(code.slice(1), 16) : Number(code)),
    )
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    // &amp;を最後に戻さないと「&amp;lt;」のような二重エスケープを壊す
    .replace(/&amp;/g, "&");
}

const SHARED_STRING_REGEX = /<si>([\s\S]*?)<\/si>/g;
const TEXT_REGEX = /<t[^>]*>([\s\S]*?)<\/t>/g;
const ROW_REGEX = /<row[^>]*>([\s\S]*?)<\/row>/g;
const CELL_REGEX = /<c([^>]*)\/>|<c([^>]*)>([\s\S]*?)<\/c>/g;
const VALUE_REGEX = /<v[^>]*>([\s\S]*?)<\/v>/;
const CELL_REF_REGEX = /\br="([A-Z]+)\d+"/;
const SHARED_TYPE_REGEX = /\bt="s"/;

/** 「AB」のような列名を0始まりの列番号に変換する。 */
function columnIndex(letters: string): number {
  let index = 0;
  for (const letter of letters) index = index * 26 + (letter.charCodeAt(0) - 64);
  return index - 1;
}

function parseSharedStrings(xml: string): string[] {
  return [...xml.matchAll(SHARED_STRING_REGEX)].map((entry) =>
    // リッチテキストは<t>が複数に割れているので連結して1つの文字列に戻す
    decodeXmlText([...entry[1].matchAll(TEXT_REGEX)].map((text) => text[1]).join("")),
  );
}

/**
 * xlsxの1枚目のシートを、行×列の文字列として読み出す。
 * 値の入っていないセルは空文字で埋め、列の位置がずれないようにする。
 */
export function readXlsxRows(buf: Buffer): string[][] {
  const sharedStrings = parseSharedStrings(readZipEntry(buf, "xl/sharedStrings.xml").toString("utf8"));
  const sheet = readZipEntry(buf, "xl/worksheets/sheet1.xml").toString("utf8");

  const rows: string[][] = [];
  for (const rowMatch of sheet.matchAll(ROW_REGEX)) {
    const cells: string[] = [];
    let nextIndex = 0;

    for (const cellMatch of rowMatch[1].matchAll(CELL_REGEX)) {
      const attributes = cellMatch[1] ?? cellMatch[2];
      const body = cellMatch[3] ?? "";
      const reference = attributes.match(CELL_REF_REGEX);
      const index = reference ? columnIndex(reference[1]) : nextIndex;
      while (cells.length < index) cells.push("");

      const raw = body.match(VALUE_REGEX)?.[1] ?? "";
      cells[index] = SHARED_TYPE_REGEX.test(attributes)
        ? (sharedStrings[Number(raw)] ?? "")
        : decodeXmlText(raw);
      nextIndex = index + 1;
    }

    rows.push(cells);
  }

  return rows;
}
