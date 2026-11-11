"use client";
import { Printer } from "lucide-react";
import { TripGate } from "./TripGate";
import { Button } from "@/components/ui/primitives";
import { fmtDate, fmtTimeZ, inr } from "@/lib/time";

/** Printable voucher built from the offline pack (works offline). Save as PDF from the print dialog. STUB: no emailed PDF until Resend/Blob keys are set. */
export function Voucher() {
  return (
    <TripGate>
      {(pack) => (
        <article className="space-y-4 bg-white p-4 text-black print:p-0 sm:rounded-2xl" data-testid="voucher">
          <div className="no-print flex items-center justify-between"><p className="text-[15px] text-neutral-600">Sample voucher. Test payment, no money moved.</p><Button size="md" variant="primary" onClick={() => window.print()}><Printer size={18} /> Print or save as PDF</Button></div>
          <header className="border-b-2 border-black pb-3"><p className="text-[13px] uppercase tracking-widest">Safar Saathi · sample voucher</p><h1 className="text-[28px] font-bold">{pack.booking.title}</h1><p>Booking <span className="font-mono font-bold">{pack.booking.ref}</span> · {pack.booking.pax} travellers · {fmtDate(pack.booking.dates[0])} to {fmtDate(pack.booking.dates[1], true)}</p><p>Travellers: {pack.booking.travellers.join(", ")}</p></header>
          <section><h2 className="text-[20px] font-bold">Flights</h2><ul className="space-y-1">{pack.flights.map((f) => <li key={f.flight_no}>{f.carrier} {f.flight_no} · {f.from} to {f.to} · {fmtDate(f.depart_at.slice(0, 10))} {fmtTimeZ(f.depart_at, f.from_tz)} · code {f.pnr}</li>)}</ul></section>
          <section><h2 className="text-[20px] font-bold">Hotels</h2><ul className="space-y-1">{pack.stays.map((s) => { const h = pack.places[s.hotelId]; return <li key={s.hotelId}>{h.name}, {h.address} · {fmtDate(s.from)} to {fmtDate(s.to)}<br /><span className="text-neutral-600">{h.address_local}</span></li>; })}</ul></section>
          <section><h2 className="text-[20px] font-bold">Airport transfers</h2><ul className="space-y-1">{pack.stays.map((s) => <li key={s.city}>{s.cityName}: driver {s.driver.name} ({s.driver.vendor}), pickup code <span className="font-mono font-bold">{s.driver.pickup_code}</span></li>)}</ul></section>
          <p className="text-[20px] font-bold">Total {inr(pack.booking.totalInr)}</p>
          <p className="text-[13px] text-neutral-600">{pack.disclaimer} All airlines, hotels, vendors and phone numbers here are fictional sample data.</p>
        </article>
      )}
    </TripGate>
  );
}
