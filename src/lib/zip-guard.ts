// Checks an Office / ZIP file's central directory BEFORE anything unpacks it:
// bounded entry count, total expanded size and compression ratio, so a
// crafted archive ("zip bomb") can't exhaust memory or CPU. Pure, no deps.

export interface ZipLimits {
  maxEntries: number;
  maxTotalBytes: number;
  maxEntryBytes: number;
  maxRatio: number;
}
export const DEFAULT_ZIP_LIMITS: ZipLimits = { maxEntries: 2000, maxTotalBytes: 64 * 1024 * 1024, maxEntryBytes: 32 * 1024 * 1024, maxRatio: 200 };

export class ZipRejected extends Error {}

export function assertSafeZip(buf: Uint8Array, limits: ZipLimits = DEFAULT_ZIP_LIMITS) {
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
  let p = cdOffset;
  let total = 0;
  for (let n = 0; n < entries; n++) {
    if (p + 46 > buf.length || dv.getUint32(p, true) !== 0x02014b50) throw new ZipRejected("Corrupted file");
    const compressed = dv.getUint32(p + 20, true);
    const size = dv.getUint32(p + 24, true);
    if (compressed === 0xffffffff || size === 0xffffffff) throw new ZipRejected("ZIP64 archives are not supported");
    if (size > limits.maxEntryBytes) throw new ZipRejected("A part of the file is too large once expanded");
    if (size > 1024 * 1024 && size / Math.max(1, compressed) > limits.maxRatio) throw new ZipRejected("The file is compressed suspiciously well (possible zip bomb)");
    total += size;
    if (total > limits.maxTotalBytes) throw new ZipRejected("The file is too large once expanded");
    p += 46 + dv.getUint16(p + 28, true) + dv.getUint16(p + 30, true) + dv.getUint16(p + 32, true);
  }
}
