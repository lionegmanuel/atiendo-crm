"use client";

import { useCallback } from "react";

import { emitNotification, type EmitNotificationInput } from "@/lib/notifications/emit";

export function useNotify(): (input: EmitNotificationInput) => void {
  return useCallback((input: EmitNotificationInput) => {
    emitNotification(input);
  }, []);
}
