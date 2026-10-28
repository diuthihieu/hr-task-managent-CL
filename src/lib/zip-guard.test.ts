import { test } from "node:test";
import assert from "node:assert/strict";
import { crc32, deflateRawSync } from "node:zlib";
import { randomBytes } from "node:crypto";
import JSZip from "jszip";
import * as XLSX from "xlsx";
import { Document, Packer, Paragraph, TextRun } from "docx";
import PptxGenJS from "pptxgenjs";
import { assertOfficePreviewable, assertSafeZip, MAX_PREVIEW_XML_BYTES, ZipRejected } from "./zip-guard";

// Hand-built archives (BUG-22): the guard must read a ZIP the way JSZip / mammoth do,
// and check the real expanded sizes, not the sizes the file claims.

type Entry = { name: string; data: Buffer; declared?: number };
const u16 = (n: number) => Buffer.from([n & 0xff, (n >> 8) & 0xff]);
const u32 = (n: number) => {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(n >>> 0);
  return b;
};

/** Local headers + data, and the matching central directory (offsets from `base`). */
function parts(entries: Entry[], base = 0) {
  const locals: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = base;
  for (const e of entries) {
    const name = Buffer.from(e.name);
    const packed = deflateRawSync(e.data);
    const size = e.declared ?? e.data.length;
    const crc = crc32(e.data);
    const local = Buffer.concat([u32(0x04034b50), u16(20), u16(0), u16(8), u16(0), u16(0), u32(crc), u32(packed.length), u32(size), u16(name.length), u16(0), name, packed]);
    central.push(Buffer.concat([u32(0x02014b50), u16(20), u16(20), u16(0), u16(8), u16(0), u16(0), u32(crc), u32(packed.length), u32(size), u16(name.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(offset), name]));
    locals.push(local);
    offset += local.length;
  }
  return { locals: Buffer.concat(locals), central: Buffer.concat(central) };
}
const eocd = (entries: number, cdSize: number, cdOffset: number) => Buffer.concat([u32(0x06054b50), u16(0), u16(0), u16(entries), u16(entries), u32(cdSize), u32(cdOffset), u16(0)]);

const HUGE = Buffer.alloc(10 * 1024 * 1024, "a");
const docxEntries = (doc: Buffer, declared?: number): Entry[] => [
  { name: "[Content_Types].xml", data: Buffer.from('<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>') },
  { name: "_rels/.rels", data: Buffer.from('<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>') },
  { name: "word/document.xml", data: doc, declared },
];

test("zip guard: a part that lies about its expanded size is caught by expanding it", () => {
  const { locals, central } = parts(docxEntries(HUGE, 1000));
  const file = Buffer.concat([locals, central, eocd(3, central.length, locals.length)]);
  assert.ok(file.length < 100 * 1024);
  assert.throws(() => assertSafeZip(file), ZipRejected);
});

test("zip guard: a decoy central directory placed where the real one isn't is rejected", () => {
  const real = parts(docxEntries(HUGE));
  const B = real.locals.length;
  const S = real.central.length;
  // A harmless prefix whose own (decoy) directory sits at absolute offset B, with the same names.
  const decoy = parts(docxEntries(Buffer.from("x")).map((e) => ({ name: e.name, data: Buffer.from("x") })));
  const prefix = Buffer.alloc(Math.max(B + S, decoy.locals.length + B));
  decoy.locals.copy(prefix, 0);
  decoy.central.copy(prefix, B);
  assert.equal(decoy.central.length, S, "same names, same directory size");
  const file = Buffer.concat([prefix, real.locals, real.central, eocd(3, S, B)]);
  assert.throws(() => assertSafeZip(file), ZipRejected);
});

test("zip guard: directory records beyond the count in the end record are rejected", () => {
  const { locals, central } = parts(docxEntries(HUGE));
  const file = Buffer.concat([locals, central, eocd(1, central.length, locals.length)]);
  assert.throws(() => assertSafeZip(file), ZipRejected);
});

test("zip guard: real Office files made by docx, xlsx and pptxgenjs still pass", async () => {
  const docx = await Packer.toBuffer(new Document({ sections: [{ children: [new Paragraph({ children: [new TextRun("Xin chào - hello")] })] }] }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["Tên", "Lương"], ["Linh", 1500000]]), "Nhân sự");
  const xlsx = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
  const pptx = new PptxGenJS();
  pptx.addSlide().addText("Slide one", { x: 1, y: 1 });
  const pptxBuf = (await pptx.write({ outputType: "nodebuffer" })) as Buffer;
  // JSZip with data descriptors (sizes only in the central directory), as some editors write.
  const streamed = await new JSZip().file("a.xml", "<a/>").file("b.txt", "hello").generateAsync({ type: "nodebuffer", streamFiles: true, compression: "DEFLATE" });
  for (const [name, buf] of [["docx", docx], ["xlsx", xlsx], ["pptx", pptxBuf], ["streamed", streamed]] as const) {
    assert.doesNotThrow(() => assertSafeZip(new Uint8Array(buf)), name);
  }
});

test("preview limit: Word files with more than 5 MB of XML are refused before parsing", async () => {
  // Random text compresses like real prose (not suspiciously well).
  const docOf = (bytes: number) => Packer.toBuffer(new Document({ sections: [{ children: [new Paragraph({ children: [new TextRun(randomBytes(Math.ceil(bytes * 0.75)).toString("base64"))] })] }] }));
  assert.equal(MAX_PREVIEW_XML_BYTES, 5 * 1024 * 1024);
  const big = new Uint8Array(await docOf(6 * 1024 * 1024));
  const ok = new Uint8Array(await docOf(4 * 1024 * 1024));
  assert.throws(() => assertOfficePreviewable(big), /too large to preview/);
  assert.doesNotThrow(() => assertOfficePreviewable(ok));
});
