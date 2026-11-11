/** A map-pin teardrop with a glyph and the place name under it (like a consumer map). Plain DOM, used as a MapLibre marker element. */
export type PinKind = "hotel" | "airport" | "sight";
export const PIN_COLOR: Record<PinKind, string> = { hotel: "#ea4335", airport: "#1a73e8", sight: "#f29900" };
const GLYPH: Record<PinKind, string> = { hotel: "H", airport: "✈", sight: "★" };

export function pinElement(kind: PinKind, name: string, label: string | number = GLYPH[kind]): HTMLDivElement {
  const d = document.createElement("div");
  d.style.cssText = "display:flex;flex-direction:column;align-items:center;cursor:pointer";
  const safe = name.replace(/[<>&"]/g, "").replace(/ \(.*\)$/, "");
  d.innerHTML = `<svg width="30" height="38" viewBox="0 0 30 38" aria-hidden="true"><path d="M15 1C7.8 1 2 6.7 2 13.8c0 9.4 13 22.7 13 22.7s13-13.3 13-22.7C28 6.7 22.2 1 15 1z" fill="${PIN_COLOR[kind]}" stroke="#fff" stroke-width="2"/><text x="15" y="19" text-anchor="middle" font-size="12" font-weight="700" fill="#fff" font-family="system-ui,sans-serif">${label}</text></svg><span style="margin-top:-2px;max-width:128px;font-size:12px;font-weight:600;line-height:1.15;text-align:center;color:#202124;text-shadow:0 0 3px #fff,0 0 3px #fff,0 0 3px #fff,0 0 3px #fff">${safe}</span>`;
  return d;
}
