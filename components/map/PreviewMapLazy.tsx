"use client";
import dynamic from "next/dynamic";
import { Skeleton } from "@/components/ui/primitives";

export const PreviewMapLazy = dynamic(() => import("./PreviewMap").then((m) => m.PreviewMap), { ssr: false, loading: () => <Skeleton className="h-[340px]" /> });
