import { Suspense } from "react";
import { Login } from "@/components/trip/Login";
export const metadata = { title: "Sign in" };
export default function Page() {
  return <Suspense><Login /></Suspense>;
}
