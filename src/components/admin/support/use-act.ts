"use client";

import { useRouter } from "next/navigation";
import * as React from "react";
import { toast } from "sonner";

type Result<T> =
  { ok: true; data: T } | { ok: false; error: string; fieldErrors?: Record<string, string> };

/** Runs a Server Action in a transition, refreshes the page on success and toasts failures. */
export function useAct() {
  const router = useRouter();
  const [pending, start] = React.useTransition();
  return {
    pending,
    run<T>(
      fn: () => Promise<Result<T>>,
      onOk: (data: T) => void,
      onError?: (message: string, fields?: Record<string, string>) => void,
    ) {
      start(async () => {
        const res = await fn();
        if (res.ok) {
          onOk(res.data);
          router.refresh();
        } else if (onError) onError(res.error, res.fieldErrors);
        else toast.error(res.error);
      });
    },
  };
}
