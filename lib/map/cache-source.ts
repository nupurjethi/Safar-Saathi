import type { RangeResponse, Source } from "pmtiles";

/**
 * Reads a saved map file straight from the phone's Cache Storage, in small pieces, with no service worker in between.
 * The file is opened once as a Blob (disk-backed, not copied into memory) and each tile read slices a few KB from it, so
 * panning and zooming stay fast and memory stays low, even for 30 MB map files on an iPhone.
 */
const blobs = new Map<string, Promise<Blob | null>>();

export function cachedBlob(url: string): Promise<Blob | null> {
  let p = blobs.get(url);
  if (!p) {
    p = (async () => {
      try {
        if (typeof caches === "undefined") return null;
        const res = await caches.match(url);
        if (!res || !res.ok) return null;
        const b = await res.blob();
        return b.size > 0 ? b : null;
      } catch { return null; }
    })();
    blobs.set(url, p);
    p.then((b) => { if (!b) blobs.delete(url); }); // a miss is not remembered: the file may be saved a moment later
  }
  return p;
}
export const forgetCachedBlob = (url: string) => blobs.delete(url);

export class CacheSource implements Source {
  constructor(private url: string, private blob: Blob) {}
  getKey() { return this.url; }
  async getBytes(offset: number, length: number): Promise<RangeResponse> {
    return { data: await this.blob.slice(offset, offset + length).arrayBuffer() };
  }
}
