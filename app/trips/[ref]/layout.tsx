import { TripNav } from "@/components/trip/TripNav";
import { TripProvider } from "@/components/trip/TripProvider";

// A client-rendered shell: the HTML holds no personal data. Trip data comes from IndexedDB (the offline pack),
// so these pages can be cached by the service worker and still work in airplane mode.
export default async function TripLayout({ children, params }: { children: React.ReactNode; params: Promise<{ ref: string }> }) {
  const { ref } = await params;
  return (
    <TripProvider refCode={ref}>
      <TripNav refCode={ref} />
      <div className="mx-auto max-w-3xl">{children}</div>
    </TripProvider>
  );
}
