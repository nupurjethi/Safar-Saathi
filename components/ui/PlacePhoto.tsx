import type { ImageCredit } from "@/lib/db/schema";

type Credit = Pick<ImageCredit, "author" | "license" | "sourceUrl" | "title">;

/** Short credit line: "Photo: Author · CC BY-SA 4.0". Full details are on the Commons file page. */
export function creditLine(c: Credit) {
  const a = c.author.length > 34 ? c.author.slice(0, 33) + "…" : c.author;
  return `Photo: ${a} · ${c.license}`;
}

/** A real photo of a real landmark (Wikimedia Commons, openly licensed), with its credit kept on the image. */
export function PlacePhoto({ src, alt, credit, className = "", showCredit = true, priority = false }: { src: string; alt: string; credit: Credit; className?: string; showCredit?: boolean; priority?: boolean }) {
  return (
    <div className={`relative overflow-hidden bg-surface-2 ${className}`}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} alt={alt} loading={priority ? "eager" : "lazy"} decoding="async" className="absolute inset-0 size-full object-cover" data-testid="place-photo" />
      {showCredit && (
        <a href={credit.sourceUrl} target="_blank" rel="noopener noreferrer" title={`${credit.title}: ${credit.author}, ${credit.license}. Wikimedia Commons`} className="absolute bottom-1 right-1 max-w-[92%] truncate rounded-full bg-black/65 px-2 py-0.5 text-[10px] leading-tight text-white/85 hover:text-white">
          {creditLine(credit)}
        </a>
      )}
    </div>
  );
}
