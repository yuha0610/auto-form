import { test, expect } from "@playwright/test";
import { crc32, deflateRawSync } from "node:zlib";
import { readXlsxRows } from "../src/lib/xlsx.js";

/** テスト用にdeflate圧縮のzipを組み立てる(xlsxはzipなので、これがそのまま最小のxlsxになる)。 */
function makeZip(files: { name: string; content: string }[]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;

  for (const file of files) {
    const name = Buffer.from(file.name, "utf8");
    const raw = Buffer.from(file.content, "utf8");
    const deflated = deflateRawSync(raw);
    const sum = crc32(raw);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(sum, 14);
    local.writeUInt32LE(deflated.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(name.length, 26);
    locals.push(local, name, deflated);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(sum, 16);
    central.writeUInt32LE(deflated.length, 20);
    central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, name);

    offset += local.length + name.length + deflated.length;
  }

  const centralBuf = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(centralBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);

  return Buffer.concat([Buffer.concat(locals), centralBuf, eocd]);
}

function makeXlsx(sharedStrings: string[], rowsXml: string): Buffer {
  const si = sharedStrings.map((value) => `<si><t>${value}</t></si>`).join("");
  return makeZip([
    {
      name: "xl/sharedStrings.xml",
      content: `<?xml version="1.0"?><sst count="${sharedStrings.length}">${si}</sst>`,
    },
    {
      name: "xl/worksheets/sheet1.xml",
      content: `<?xml version="1.0"?><worksheet><sheetData>${rowsXml}</sheetData></worksheet>`,
    },
  ]);
}

test("readXlsxRows: 共有文字列のセルと数値のセルを行ごとに取り出す", () => {
  const buf = makeXlsx(
    ["コード", "銘柄名", "極洋"],
    `<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row>` +
      `<row r="2"><c r="A2"><v>1301</v></c><c r="B2" t="s"><v>2</v></c></row>`,
  );

  expect(readXlsxRows(buf)).toEqual([
    ["コード", "銘柄名"],
    ["1301", "極洋"],
  ]);
});

test("readXlsxRows: 抜けている列を空文字で埋めて列の位置を保つ", () => {
  const buf = makeXlsx(
    ["左", "右"],
    `<row r="1"><c r="A1" t="s"><v>0</v></c><c r="C1" t="s"><v>1</v></c></row>`,
  );

  expect(readXlsxRows(buf)).toEqual([["左", "", "右"]]);
});

test("readXlsxRows: XMLエスケープを元の文字に戻す", () => {
  const buf = makeXlsx(
    ["Ａ&amp;Ｂホールディングス"],
    `<row r="1"><c r="A1" t="s"><v>0</v></c></row>`,
  );

  expect(readXlsxRows(buf)).toEqual([["Ａ&Ｂホールディングス"]]);
});
