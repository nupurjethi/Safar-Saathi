"use client";
import Link from "next/link";
import type { ComponentProps } from "react";

/**
 * A normal Next link online. With no network, a client-side route change cannot fetch the next page's data and can stall or
 * fail, so offline it does a full page load instead: the service worker answers that from the pages saved with the trip.
 */
export function SafeLink({ onClick, href, ...rest }: ComponentProps<typeof Link>) {
  return (
    <Link
      href={href}
      {...rest}
      onClick={(e) => {
        onClick?.(e);
        if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
        if (typeof navigator !== "undefined" && navigator.onLine === false) { e.preventDefault(); window.location.assign(typeof href === "string" ? href : String(href)); }
      }}
    />
  );
}
