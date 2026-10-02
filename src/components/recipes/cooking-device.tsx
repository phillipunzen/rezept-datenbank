"use client";
import { useEffect, useState, useRef } from "react";
export type WakeStatus =
  "pending" | "active" | "inactive" | "unsupported" | "denied";
export function useCookingWakeLock(enabled: boolean) {
  const [status, setStatus] = useState<WakeStatus>("pending");
  useEffect(() => {
    let alive = true,
      pending = false;
    let sentinel: WakeLockSentinel | null = null;
    if (!("wakeLock" in navigator) || !window.isSecureContext) {
      setStatus("unsupported");
      return;
    }
    if (!enabled) {
      setStatus("inactive");
      return;
    }
    async function acquire() {
      if (
        !alive ||
        pending ||
        document.visibilityState !== "visible" ||
        (sentinel && !sentinel.released)
      )
        return;
      pending = true;
      try {
        const acquired = await navigator.wakeLock.request("screen");
        if (!alive) {
          await acquired.release();
          return;
        }
        sentinel = acquired;
        setStatus(acquired.released ? "inactive" : "active");
        acquired.addEventListener("release", () => {
          if (alive) setStatus("inactive");
        });
      } catch {
        if (alive) setStatus("denied");
      } finally {
        pending = false;
      }
    }
    const visibility = () => {
      if (document.visibilityState === "visible") void acquire();
    };
    setStatus("pending");
    void acquire();
    document.addEventListener("visibilitychange", visibility);
    return () => {
      alive = false;
      document.removeEventListener("visibilitychange", visibility);
      if (sentinel && !sentinel.released)
        void sentinel.release().catch(() => {});
    };
  }, [enabled]);
  return status;
}
