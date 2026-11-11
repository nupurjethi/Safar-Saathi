import { Suspense } from "react";
import { Checkout } from "@/components/trip/Checkout";
import { Skeleton } from "@/components/ui/primitives";

export const metadata = { title: "Checkout" };
export default function Page() {
  return <Suspense fallback={<Skeleton className="h-96" />}><Checkout /></Suspense>;
}
