import { test } from "node:test";
import assert from "node:assert/strict";
import JSZip from "jszip";
import * as XLSX from "xlsx";
import { parseCsv, readXlsx, sheetToCsv } from "./xlsx-lite";
import { assertSafeZip, ZipRejected } from "./zip-guard";

test("xlsx-lite reads sheet names, shared strings, numbers and gaps", async () => {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["Tên", "Lương"], ["Linh", 1500000], ["An, B", ""], [null, "x\"y"]]), "Nhân sự");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["only"]]), "Sheet 2");
  const buf = new Uint8Array(XLSX.write(wb, { type: "buffer", bookType: "xlsx" }));
  const sheets = await readXlsx(buf);
  assert.deepEqual(sheets.map((s) => s.name), ["Nhân sự", "Sheet 2"]);
  assert.deepEqual(sheets[0].rows[1], ["Linh", "1500000"]);
  assert.equal(sheets[0].rows[3][1], 'x"y');
  assert.match(sheetToCsv(sheets[0].rows), /"An, B"/);
});

test("zip guard rejects archive bombs and non-archives before anything is unpacked", async () => {
  const zip = new JSZip();
  zip.file("big.xml", "0".repeat(40 * 1024 * 1024));
  const bomb = await zip.generateAsync({ type: "uint8array", compression: "DEFLATE", compressionOptions: { level: 9 } });
  assert.ok(bomb.length < 1024 * 1024, "tiny on disk");
  assert.throws(() => assertSafeZip(bomb), ZipRejected);
  assert.throws(() => assertSafeZip(new TextEncoder().encode("not a zip at all")), ZipRejected);
  const many = new JSZip();
  for (let i = 0; i < 2100; i++) many.file(`f${i}.txt`, "x");
  const manyBuf = await many.generateAsync({ type: "uint8array" });
  assert.throws(() => assertSafeZip(manyBuf), /too many/);
});

test("csv parser handles quotes, embedded newlines and tabs", () => {
  assert.deepEqual(parseCsv('a,"b,c","d ""q"""\n1,"line\nbreak",3'), [["a", "b,c", 'd "q"'], ["1", "line\nbreak", "3"]]);
  assert.deepEqual(parseCsv("x\ty\n1\t2"), [["x", "y"], ["1", "2"]]);
});
