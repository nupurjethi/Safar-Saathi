import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import { PMTiles, zxyToTileId } from "pmtiles";

/**
 * Builds a small offline street-map file (PMTiles v3, OpenStreetMap vector tiles from the public Protomaps daily build) for one
 * bounding box, in-process: no CLI, so it also runs on a serverless host. It reads only the tiles it needs (HTTP range requests),
 * re-packs them, and returns the bytes. Used for cities in uploaded travel plans that our pre-built tiles do not cover.
 */
export type ExtractResult = { data: Buffer; sha256: string; bytes: number; tiles: number; maxZoom: number; bbox: [number, number, number, number] };

const BUILDS = "https://build-metadata.protomaps.dev/builds.json";
let buildUrl: { url: string; at: number } | null = null;

async function latestBuild(): Promise<string> {
  if (process.env.PROTOMAPS_BUILD) return process.env.PROTOMAPS_BUILD;
  if (buildUrl && Date.now() - buildUrl.at < 6 * 3600e3) return buildUrl.url;
  const r = await fetch(BUILDS, { signal: AbortSignal.timeout(10000) });
  if (!r.ok) throw new Error(`Protomaps builds ${r.status}`);
  const list = (await r.json()) as { key: string }[];
  buildUrl = { url: `https://build.protomaps.com/${list[list.length - 1].key}`, at: Date.now() };
  return buildUrl.url;
}

const lon2x = (lon: number, z: number) => Math.floor(((lon + 180) / 360) * 2 ** z);
const lat2y = (lat: number, z: number) => Math.floor(((1 - Math.log(Math.tan((lat * Math.PI) / 180) + 1 / Math.cos((lat * Math.PI) / 180)) / Math.PI) / 2) * 2 ** z);

export function tilesInBbox(bbox: [number, number, number, number], maxZoom: number): [number, number, number][] {
  const out: [number, number, number][] = [];
  for (let z = 0; z <= maxZoom; z++) {
    const x0 = lon2x(bbox[0], z), x1 = lon2x(bbox[2], z), y0 = lat2y(bbox[3], z), y1 = lat2y(bbox[1], z);
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) out.push([z, x, y]);
  }
  return out;
}

function varint(n: number, out: number[]) {
  let v = n;
  while (v >= 0x80) { out.push((v & 0x7f) | 0x80); v = Math.floor(v / 128); }
  out.push(v);
}

type Entry = { tileId: number; offset: number; length: number; runLength: number };
export function serializeDirectory(entries: Entry[]): Buffer {
  const b: number[] = [];
  varint(entries.length, b);
  let last = 0;
  for (const e of entries) { varint(e.tileId - last, b); last = e.tileId; }
  for (const e of entries) varint(e.runLength, b);
  for (const e of entries) varint(e.length, b);
  entries.forEach((e, i) => { varint(i > 0 && e.offset === entries[i - 1].offset + entries[i - 1].length ? 0 : e.offset + 1, b); });
  return Buffer.from(b);
}

function header(h: { rootOffset: number; rootLength: number; metaOffset: number; metaLength: number; dataOffset: number; dataLength: number; addressed: number; entries: number; contents: number; minZoom: number; maxZoom: number; bbox: [number, number, number, number] }): Buffer {
  const buf = Buffer.alloc(127);
  buf.write("PMTiles", 0, "ascii");
  buf.writeUInt8(3, 7);
  const u64 = (v: number, at: number) => buf.writeBigUInt64LE(BigInt(v), at);
  u64(h.rootOffset, 8); u64(h.rootLength, 16); u64(h.metaOffset, 24); u64(h.metaLength, 32); u64(h.dataOffset, 40); u64(0, 48); // no leaf directories (offset points at the data, length 0)
  u64(h.dataOffset, 56); u64(h.dataLength, 64); u64(h.addressed, 72); u64(h.entries, 80); u64(h.contents, 88);
  buf.writeUInt8(1, 96); // clustered
  buf.writeUInt8(2, 97); // internal compression gzip
  buf.writeUInt8(2, 98); // tile compression gzip
  buf.writeUInt8(1, 99); // MVT
  buf.writeUInt8(h.minZoom, 100); buf.writeUInt8(h.maxZoom, 101);
  const e7 = (v: number) => Math.round(v * 1e7);
  buf.writeInt32LE(e7(h.bbox[0]), 102); buf.writeInt32LE(e7(h.bbox[1]), 106); buf.writeInt32LE(e7(h.bbox[2]), 110); buf.writeInt32LE(e7(h.bbox[3]), 114);
  buf.writeUInt8(Math.min(h.maxZoom, 13), 118);
  buf.writeInt32LE(e7((h.bbox[0] + h.bbox[2]) / 2), 119); buf.writeInt32LE(e7((h.bbox[1] + h.bbox[3]) / 2), 123);
  return buf;
}

/** Pack already-fetched tiles (decompressed MVT bytes) into a PMTiles v3 file. Pure: exported for tests. */
export function writePmtiles(tiles: { z: number; x: number; y: number; data: Uint8Array }[], bbox: [number, number, number, number], metadata: unknown): Buffer {
  const sorted = tiles.map((t) => ({ ...t, id: zxyToTileId(t.z, t.x, t.y) })).sort((a, b) => a.id - b.id);
  const chunks: Buffer[] = [];
  const seen = new Map<string, { offset: number; length: number }>();
  const entries: Entry[] = [];
  let offset = 0;
  for (const t of sorted) {
    const gz = gzipSync(Buffer.from(t.data));
    const h = createHash("sha1").update(gz).digest("hex");
    let at = seen.get(h);
    if (!at) { at = { offset, length: gz.length }; seen.set(h, at); chunks.push(gz); offset += gz.length; }
    const prev = entries[entries.length - 1];
    if (prev && prev.tileId + prev.runLength === t.id && prev.offset === at.offset) prev.runLength++;
    else entries.push({ tileId: t.id, offset: at.offset, length: at.length, runLength: 1 });
  }
  const root = gzipSync(serializeDirectory(entries));
  if (127 + root.length > 16384) throw new Error("TOO_MANY_TILES"); // keep it to one root directory
  const meta = gzipSync(Buffer.from(JSON.stringify(metadata ?? {})));
  const data = Buffer.concat(chunks);
  const zs = sorted.map((t) => t.z);
  const head = header({ rootOffset: 127, rootLength: root.length, metaOffset: 127 + root.length, metaLength: meta.length, dataOffset: 127 + root.length + meta.length, dataLength: data.length, addressed: sorted.length, entries: entries.length, contents: seen.size, minZoom: Math.min(...zs), maxZoom: Math.max(...zs), bbox });
  return Buffer.concat([head, root, meta, data]);
}

/** Fetch every tile in the box (z0..maxZoom) from the public build, a few at a time, and pack them. */
export async function extractTiles(bbox: [number, number, number, number], opts: { maxZoom?: number; maxTiles?: number; concurrency?: number } = {}): Promise<ExtractResult> {
  let maxZoom = opts.maxZoom ?? 14;
  let list = tilesInBbox(bbox, maxZoom);
  while (list.length > (opts.maxTiles ?? 1800) && maxZoom > 10) { maxZoom--; list = tilesInBbox(bbox, maxZoom); }
  const src = new PMTiles(await latestBuild());
  const metadata = await src.getMetadata().catch(() => ({}));
  const out: { z: number; x: number; y: number; data: Uint8Array }[] = [];
  let i = 0;
  const worker = async () => {
    while (i < list.length) {
      const [z, x, y] = list[i++];
      for (let attempt = 0; attempt < 3; attempt++) {
        try { const r = await src.getZxy(z, x, y); if (r?.data) out.push({ z, x, y, data: new Uint8Array(r.data) }); break; }
        catch { if (attempt === 2) throw new Error(`Tile ${z}/${x}/${y} could not be read`); }
      }
    }
  };
  await Promise.all(Array.from({ length: opts.concurrency ?? 8 }, worker));
  const data = writePmtiles(out, bbox, metadata);
  return { data, sha256: `sha256:${createHash("sha256").update(data).digest("hex")}`, bytes: data.length, tiles: out.length, maxZoom, bbox };
}
