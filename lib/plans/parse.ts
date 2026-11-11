import { createHash } from "node:crypto";

/**
 * Turn one uploaded travel document into something the model can read: text for PDF, Word, Excel/CSV, email, HTML and
 * plain text; a small data URL for photos and screenshots (the model reads images directly). Nothing is sent anywhere here.
 */
export type ParsedFile = { kind: "pdf" | "word" | "sheet" | "image" | "text" | "unsupported"; text?: string; imageDataUrl?: string; note?: string; sha256: string };

export const MAX_FILE_BYTES = 4 * 1024 * 1024; // per upload request (serverless request bodies are limited to ~4.5 MB)
export const MAX_FILES = 12;
const MAX_TEXT = 60_000; // characters kept per file

const ext = (name: string) => (name.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] ?? "");
const clip = (t: string) => { const s = t.replace(/\u0000/g, "").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim(); return s.length > MAX_TEXT ? s.slice(0, MAX_TEXT) + "\n[...truncated]" : s; };
const stripHtml = (h: string) => h.replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ").replace(/<br\s*\/?>|<\/(p|div|tr|li|h\d)>/gi, "\n").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">");

export function kindOf(name: string, mime: string): ParsedFile["kind"] {
  const e = ext(name);
  if (mime === "application/pdf" || e === "pdf") return "pdf";
  if (e === "docx" || mime.includes("wordprocessingml")) return "word";
  if (["xlsx", "csv", "tsv"].includes(e) || mime.includes("spreadsheetml") || mime === "text/csv") return "sheet";
  if (mime.startsWith("image/") || ["jpg", "jpeg", "png", "webp", "gif"].includes(e)) return "image";
  if (mime.startsWith("text/") || ["txt", "md", "eml", "html", "htm", "json", "ics", "xml"].includes(e)) return "text";
  return "unsupported";
}

export async function parseFile(name: string, mime: string, buf: Buffer): Promise<ParsedFile> {
  const sha256 = createHash("sha256").update(buf).digest("hex");
  const kind = kindOf(name, mime);
  try {
    if (kind === "pdf") {
      const { extractText, getDocumentProxy } = await import("unpdf");
      const pdf = await getDocumentProxy(new Uint8Array(buf));
      const { text } = await extractText(pdf, { mergePages: true });
      const t = clip(Array.isArray(text) ? text.join("\n") : text);
      return t.length > 20 ? { kind, text: t, sha256 } : { kind, sha256, note: "This PDF has no readable text (it may be a scan). Upload a photo or screenshot of it instead." };
    }
    if (kind === "word") {
      const mammoth = await import("mammoth");
      const r = await mammoth.extractRawText({ buffer: buf });
      return { kind, text: clip(r.value), sha256 };
    }
    if (kind === "sheet") {
      if (ext(name) === "csv" || ext(name) === "tsv" || mime === "text/csv") return { kind, text: clip(buf.toString("utf8")), sha256 };
      const ExcelJS = (await import("exceljs")).default;
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(buf as unknown as ArrayBuffer);
      const parts: string[] = [];
      wb.eachSheet((ws) => {
        parts.push(`## Sheet: ${ws.name}`);
        ws.eachRow({ includeEmpty: false }, (row) => {
          const cells = (row.values as unknown[]).slice(1).map((v) => {
            if (v == null) return "";
            if (v instanceof Date) return v.toISOString().replace("T", " ").slice(0, 16);
            if (typeof v === "object") { const o = v as { text?: string; result?: unknown; richText?: { text: string }[] }; return o.text ?? (o.richText ? o.richText.map((r) => r.text).join("") : String(o.result ?? "")); }
            return String(v);
          });
          parts.push(cells.join(" | "));
        });
      });
      return { kind, text: clip(parts.join("\n")), sha256 };
    }
    if (kind === "image") {
      const type = mime.startsWith("image/") ? mime : `image/${ext(name) === "jpg" ? "jpeg" : ext(name)}`;
      return { kind, imageDataUrl: `data:${type};base64,${buf.toString("base64")}`, sha256 };
    }
    if (kind === "text") {
      const raw = buf.toString("utf8");
      return { kind, text: clip(/<html|<body|<div|<table/i.test(raw) ? stripHtml(raw) : raw), sha256 };
    }
    return { kind, sha256, note: "This file type cannot be read yet. Use PDF, Word (.docx), Excel (.xlsx), CSV, a photo or text." };
  } catch (e) {
    return { kind, sha256, note: `Could not read this file (${e instanceof Error ? e.message.slice(0, 80) : "unknown error"}).` };
  }
}
