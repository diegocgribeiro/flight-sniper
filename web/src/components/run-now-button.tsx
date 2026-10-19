"use client";

import { useState, useTransition } from "react";
import { runNow } from "@/app/actions";

export function RunNowButton({ routeId, label = "Buscar agora" }: { routeId: number | null; label?: string }) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; message: string } | null>(null);
  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        className="btn-ghost"
        disabled={pending}
        onClick={() => start(async () => setMsg(await runNow(routeId)))}
      >
        {pending ? "Disparando…" : `⚡ ${label}`}
      </button>
      {msg && <span className={`text-xs ${msg.ok ? "text-good" : "text-bad"}`}>{msg.message}</span>}
    </div>
  );
}
