"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { db, schema } from "@/db";
import {
  SESSION_COOKIE,
  SESSION_TTL_SECONDS,
  checkPassword,
  createSessionToken,
} from "@/lib/auth";
import { dispatchScan, type DispatchResult } from "@/lib/github";
import { ntfyTopic, parseRouteForm, type RouteInput } from "@/lib/route-input";
import { requireSession } from "@/lib/session";

export type FormState = { errors?: Record<string, string[]>; message?: string } | undefined;

export async function login(_: FormState, fd: FormData): Promise<FormState> {
  const password = String(fd.get("password") ?? "");
  if (!(await checkPassword(password))) return { message: "Senha incorreta" };

  const store = await cookies();
  store.set(SESSION_COOKIE, await createSessionToken(), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  });
  const next = String(fd.get("next") ?? "/");
  redirect(next.startsWith("/") && !next.startsWith("//") ? next : "/");
}

export async function logout() {
  (await cookies()).delete(SESSION_COOKIE);
  redirect("/login");
}

function toRow(r: RouteInput) {
  const rt = r.tripType === "round_trip";
  return {
    name: r.name,
    origins: r.origins,
    destinations: r.destinations,
    tripType: r.tripType,
    dateMode: r.dateMode,
    departDate: r.dateMode === "fixed" ? r.departDate : null,
    returnDate: r.dateMode === "fixed" && rt ? r.returnDate : null,
    windowStart: r.dateMode === "window" ? r.windowStart : null,
    windowEnd: r.dateMode === "window" ? r.windowEnd : null,
    horizonDays: r.dateMode === "rolling" ? r.horizonDays : null,
    minStayDays: rt && r.dateMode !== "fixed" ? r.minStayDays : null,
    maxStayDays: rt && r.dateMode !== "fixed" ? r.maxStayDays : null,
    targetPrice: r.targetPrice.toFixed(2),
    currency: r.currency,
    adults: r.adults,
    cabin: r.cabin,
    maxStops: r.maxStops,
    schedule: r.schedule,
    maxQueriesPerRun: r.maxQueriesPerRun,
    notifyEmail: r.notifyEmail,
    ntfyTopic: r.ntfyTopic,
    active: r.active,
  };
}

export async function saveRoute(
  routeId: number | null,
  _: FormState,
  fd: FormData,
): Promise<FormState> {
  await requireSession();
  const parsed = parseRouteForm(fd);
  if (!parsed.success) {
    const errors: Record<string, string[]> = {};
    for (const issue of parsed.error.issues) {
      const key = String(issue.path[0] ?? "form");
      (errors[key] ??= []).push(issue.message);
    }
    return { errors, message: "Corrija os campos destacados" };
  }

  const row = toRow(parsed.data);
  let id = routeId;
  if (id == null) {
    const [created] = await db()
      .insert(schema.routes)
      .values(row)
      .returning({ id: schema.routes.id });
    id = created.id;
  } else {
    // Rota editada: meta/datas podem ter mudado, então recomeça o episódio de alerta.
    await db()
      .update(schema.routes)
      .set({ ...row, cursor: 0, alertFloor: null, updatedAt: new Date() })
      .where(eq(schema.routes.id, id));
  }
  // Já traz a primeira estimativa sem esperar o próximo horário agendado.
  if (row.active) {
    const res = await dispatchScan({ routeId: id, force: true, trigger: "new-route" });
    if (!res.ok) console.warn("Varredura inicial não disparada:", res.message);
  }
  revalidatePath("/");
  redirect(`/routes/${id}`);
}

export async function toggleRoute(routeId: number, active: boolean) {
  await requireSession();
  await db()
    .update(schema.routes)
    .set({ active, updatedAt: new Date() })
    .where(eq(schema.routes.id, routeId));
  revalidatePath("/");
  revalidatePath(`/routes/${routeId}`);
}

export async function deleteRoute(routeId: number) {
  await requireSession();
  await db().delete(schema.routes).where(eq(schema.routes.id, routeId));
  revalidatePath("/");
  redirect("/");
}

/** Dispara a varredura imediatamente (botão "Buscar agora"). */
export async function runNow(routeId: number | null): Promise<DispatchResult> {
  await requireSession();
  return dispatchScan({ routeId, force: true, trigger: "manual" });
}

/** Envia uma notificação de teste para o tópico ntfy informado no formulário. */
export async function testNtfy(topic: string): Promise<DispatchResult> {
  await requireSession();
  const parsed = ntfyTopic.safeParse(topic);
  if (!parsed.success || !parsed.data) return { ok: false, message: "Tópico inválido" };
  const server = (process.env.NTFY_SERVER ?? "https://ntfy.sh").replace(/\/$/, "");
  const res = await fetch(`${server}/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      topic: parsed.data,
      title: "✈ Flight Sniper",
      message: "Notificação de teste: os alertas desta rota chegarão aqui.",
      tags: ["white_check_mark"],
    }),
  });
  return res.ok
    ? { ok: true, message: "Enviada! Confira o app do ntfy." }
    : { ok: false, message: `ntfy respondeu ${res.status}` };
}
