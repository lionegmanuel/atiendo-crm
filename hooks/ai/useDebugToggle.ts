"use client";
import { useEffect, useState } from "react";
import type { Role } from "@/lib/auth/types";

const KEY = "deskcomm.show_ai_citations";

function defaultFor(role: Role | null): boolean {
  if (role === "viewer") return false;
  return true; // admin, manager, agent
}

export function useDebugToggle(role: Role | null) {
  const [enabled, setEnabled] = useState<boolean>(() => defaultFor(role));
  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(KEY);
      if (stored === null) setEnabled(defaultFor(role));
      else setEnabled(stored === "1");
    } catch {
      /* SSR / disabled */
    }
  }, [role]);
  function update(next: boolean) {
    setEnabled(next);
    try {
      window.localStorage.setItem(KEY, next ? "1" : "0");
    } catch {
      /* noop */
    }
  }
  return { enabled, setEnabled: update };
}
