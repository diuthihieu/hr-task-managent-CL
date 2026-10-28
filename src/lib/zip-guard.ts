// Checks an Office / ZIP file BEFORE a parser unpacks it: bounded entry count,
// total expanded size and compression ratio, so a crafted archive ("zip bomb")
// can't exhaust memory or CPU. It reads the archive the way JSZip (and so
// mammoth) does, and expands every part with a cap to learn its real size:
// the sizes a file declares can lie (BUG-22). Node built-ins only.
import { inflateRawSync } from "node:zlib";

export interface ZipLimits {
  maxEntries: number;
  maxTotalBytes: number;
  maxEntryBytes: number;
  maxRatio: number;
}
export const DEFAULT_ZIP_LIMITS: ZipLimits = { maxEntries: 2000, maxTotalBytes: 64 * 1024 * 1024, maxEntryBytes: 32 * 1024 * 1024, maxRatio: 200 };

export class ZipRejected extends Error {}

export interface ZipEntryInfo {
  name: string;
  /** Real expanded size (checked by expanding it). */
  size: number;
}

export function assertSafeZip(buf: Uint8Array, limits: ZipLimits = DEFAULT_ZIP_LIMITS): ZipEntryInfo[] {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  // End of central directory: last 22..65557 bytes.
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (dv.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new ZipRejected("Not a valid Office/ZIP file");
  const entries = dv.getUint16(eocd + 10, true);
  const cdSize = dv.getUint32(eocd + 12, true);
  const cdOffset = dv.getUint32(eocd + 16, true);
  if (entries === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) throw new ZipRejected("ZIP64 archives are not supported");
  if (entries > limits.maxEntries) throw new ZipRejected("The file contains too many parts");
  if (cdOffset + cdSize > buf.length) throw new ZipRejected("Corrupted file");
  // JSZip treats anything before the declared directory as prepended data and shifts every
  // offset; Office files never have any, so the directory must end right at the end record.
  if (cdOffset + cdSize !== eocd) throw new ZipRejected("Corrupted file");
  const out: ZipEntryInfo[] = [];
  let p = cdOffset;
  let total = 0;
  for (let n = 0; n < entries; n++) {
    if (p + 46 > buf.length || dv.getUint32(p, true) !== 0x02014b50) throw new ZipRejected("Corrupted file");
    const method = dv.getUint16(p + 10, true);
    const compressed = dv.getUint32(p + 20, true);
    const declared = dv.getUint32(p + 24, true);
    const nameLength = dv.getUint16(p + 28, true);
    const localOffset = dv.getUint32(p + 42, true);
    if (compressed === 0xffffffff || declared === 0xffffffff || localOffset === 0xffffffff) throw new ZipRejected("ZIP64 archives are not supported");
    const name = new TextDecoder().decode(buf.subarray(p + 46, p + 46 + nameLength));
    // The part's data, found through its local header (what JSZip reads).
    if (localOffset + 30 > cdOffset || dv.getUint32(localOffset, true) !== 0x04034b50) throw new ZipRejected("Corrupted file");
    const start = localOffset + 30 + dv.getUint16(localOffset + 26, true) + dv.getUint16(localOffset + 28, true);
    if (start + compressed > cdOffset) throw new ZipRejected("Corrupted file");
    const size = realSize(buf.subarray(start, start + compressed), method, limits.maxEntryBytes);
    if (size !== declared) throw new ZipRejected("Corrupted file");
    if (size > 1024 * 1024 && size / Math.max(1, compressed) > limits.maxRatio) throw new ZipRejected("The file is compressed suspiciously well (possible zip bomb)");
    total += size;
    if (total > limits.maxTotalBytes) throw new ZipRejected("The file is too large once expanded");
    out.push({ name, size });
    p += 46 + nameLength + dv.getUint16(p + 30, true) + dv.getUint16(p + 32, true);
  }
  // No directory records beyond the count in the end record (JSZip would read them too).
  if (p !== cdOffset + cdSize) throw new ZipRejected("Corrupted file");
  return out;
}

/** Expanded size of one part, never expanding more than `max` bytes. */
function realSize(data: Uint8Array, method: number, max: number): number {
  if (method === 0) return data.length;
  if (method !== 8) throw new ZipRejected("Unsupported compression in this file");
  try {
    return inflateRawSync(data, { maxOutputLength: max + 1 }).length;
  } catch (e) {
    if (e instanceof RangeError || (e as { code?: string }).code === "ERR_BUFFER_TOO_LARGE") throw new ZipRejected("A part of the file is too large once expanded");
    throw new ZipRejected("Corrupted file");
  }
}

/** Parsers build the XML tree in memory (tens of times its size), so previews take at most 5 MB of XML. */
export const MAX_PREVIEW_XML_BYTES = 5 * 1024 * 1024;

export function assertOfficePreviewable(buf: Uint8Array): ZipEntryInfo[] {
  const entries = assertSafeZip(buf);
  const xml = entries.filter((e) => /\.(xml|rels)$/i.test(e.name)).reduce((s, e) => s + e.size, 0);
  if (xml > MAX_PREVIEW_XML_BYTES) throw new ZipRejected("This file is too large to preview - download it instead");
  return entries;
}
