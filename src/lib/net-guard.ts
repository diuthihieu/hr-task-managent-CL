// Outbound requests to user-configured URLs (the "API Result" field) must never
// reach the server's own network: private, loopback, link-local, metadata and
// other special-purpose ranges are refused in every spelling (BlockList also
// matches IPv4-mapped IPv6 such as ::ffff:169.254.169.254 / ::ffff:a9fe:a9fe
// against the IPv4 ranges). The main special ranges, not every IANA entry.
// Note: blocking NAT64 (64:ff9b::/96, 64:ff9b:1::/48) means a server on an
// IPv6-only network that reaches IPv4 hosts through NAT64 can't call them.
import { BlockList, isIP } from "node:net";
import type { LookupAddress } from "node:dns";
import type { Readable } from "node:stream";
import { createBrotliDecompress, createGunzip, createInflate } from "node:zlib";

const blocked = new BlockList();
for (const [net, prefix] of [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16], ["172.16.0.0", 12],
  ["192.0.0.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15], ["224.0.0.0", 4], ["240.0.0.0", 4],
] as const) blocked.addSubnet(net, prefix, "ipv4");
for (const [net, prefix] of [
  ["::", 128], ["::1", 128], ["::", 96], ["::ffff:0:0:0", 96], ["fc00::", 7], ["fe80::", 10], ["fec0::", 10],
  ["ff00::", 8], ["64:ff9b::", 96], ["64:ff9b:1::", 48], ["2002::", 16],
] as const) blocked.addSubnet(net, prefix, "ipv6");

/** True when `ip` must not be connected to (anything that isn't an IP address counts too). */
export function privateAddress(ip: string): boolean {
  const bare = ip.replace(/^\[|\]$/g, "");
  const family = isIP(bare);
  if (!family) return true;
  return blocked.check(bare, family === 4 ? "ipv4" : "ipv6");
}

type Resolver = (host: string, opts: { all: true; family?: number; hints?: number }) => Promise<LookupAddress[]>;
type LookupCallback = (err: NodeJS.ErrnoException | null, address: string | LookupAddress[], family?: number) => void;

/**
 * A `lookup` for http(s).request that checks the address at connect time, so a
 * DNS answer that changes between the check and the connection (rebinding)
 * can't slip through. Every answer must be public.
 */
export function guardedLookup(resolve: Resolver) {
  return (host: string, opts: { all?: boolean; family?: number; hints?: number }, cb: LookupCallback) => {
    resolve(host, { all: true, family: opts.family, hints: opts.hints })
      .then((addresses) => {
        if (!addresses.length || addresses.some((a) => privateAddress(a.address))) {
          const err: NodeJS.ErrnoException = new Error("API Result cannot connect to private or local network addresses");
          err.code = "EPRIVATE";
          return cb(err, "");
        }
        if (opts.all) cb(null, addresses);
        else cb(null, addresses[0].address, addresses[0].family);
      })
      .catch((e: NodeJS.ErrnoException) => cb(e, ""));
  };
}

const decoders: Record<string, () => NodeJS.ReadWriteStream> = { gzip: createGunzip, "x-gzip": createGunzip, deflate: createInflate, br: createBrotliDecompress };

/**
 * Read a response body, decoded per its Content-Encoding (node:https, unlike
 * fetch, doesn't decompress), refusing it once the decoded size passes
 * `maxBytes` (so a small compressed body can't expand past the cap).
 */
export function readBody(res: Readable, contentEncoding: string | undefined, maxBytes: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const encoding = (contentEncoding ?? "").trim().toLowerCase();
    let stream: Readable = res;
    if (encoding && encoding !== "identity") {
      const make = decoders[encoding];
      if (!make) {
        res.destroy();
        return reject(Object.assign(new Error(`unsupported Content-Encoding "${encoding}"`), { code: "EENCODING" }));
      }
      const decoder = make();
      res.on("error", reject);
      stream = res.pipe(decoder) as unknown as Readable;
    }
    const chunks: Buffer[] = [];
    let size = 0;
    stream.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > maxBytes) {
        res.destroy();
        stream.destroy();
        reject(Object.assign(new Error("response too large"), { code: "ETOOLARGE" }));
      } else chunks.push(chunk);
    });
    stream.on("end", () => resolve(Buffer.concat(chunks)));
    stream.on("error", (e: NodeJS.ErrnoException) => reject(e.code === "ETOOLARGE" ? e : Object.assign(e, { code: e.code ?? "EDECODE" })));
  });
}

/**
 * GET a JSON-ish body from a public HTTPS host, checking the IP at connect time
 * (guardedLookup), without connection reuse (a pooled socket would skip the
 * lookup), no redirects, a whole-request timeout and a size cap while reading.
 */
export async function getPublicHttps(url: URL, { maxBytes, timeoutMs }: { maxBytes: number; timeoutMs: number }): Promise<{ status: number; body: Buffer }> {
  const [{ request }, { lookup }] = await Promise.all([import("node:https"), import("node:dns/promises")]);
  return new Promise((resolve, reject) => {
    const req = request(
      url,
      { method: "GET", headers: { Accept: "application/json", "Accept-Encoding": "gzip, deflate, br" }, agent: false, lookup: guardedLookup(lookup as Resolver) as never, signal: AbortSignal.timeout(timeoutMs) },
      (res) => {
        const encoding = res.headers["content-encoding"];
        readBody(res, Array.isArray(encoding) ? encoding.join(",") : encoding, maxBytes).then((body) => resolve({ status: res.statusCode ?? 0, body }), reject);
      }
    );
    req.on("error", reject);
    req.end();
  });
}
