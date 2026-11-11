"use client";
import { MapPinned } from "lucide-react";
import { useState } from "react";
import { Button, Card } from "@/components/ui/primitives";
import { InstallPrompt } from "@/components/ui/InstallPrompt";

/** Onboarding step 3: install + location, with the reason for each. */
export function InstallAndLocation() {
  const [loc, setLoc] = useState<"idle" | "ok" | "denied" | "unavailable">("idle");
  const ask = () => {
    if (!("geolocation" in navigator)) return setLoc("unavailable");
    navigator.geolocation.getCurrentPosition(() => setLoc("ok"), () => setLoc("denied"), { timeout: 8000 });
  };
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Card className="space-y-3"><h3 className="text-[20px] font-semibold">Install the app</h3><p className="text-muted">So your trip opens like an app and stays saved on your phone.</p><InstallPrompt compact /></Card>
      <Card className="space-y-3"><h3 className="flex items-center gap-2 text-[20px] font-semibold"><MapPinned size={20} className="text-accent" /> Allow location</h3><p className="text-muted">So the blue dot can show where you are on your saved map. GPS works with no mobile data. We never track you in the background.</p>
        <Button onClick={ask}>{loc === "ok" ? "Location allowed" : "Allow location"}</Button>{loc === "denied" && <p className="text-warn text-[15px]">Location is blocked. You can turn it on later in your phone settings.</p>}{loc === "unavailable" && <p className="text-warn text-[15px]">This device does not share location.</p>}
      </Card>
    </div>
  );
}
