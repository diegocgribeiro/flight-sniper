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
import { parseRouteForm, type RouteInput } from "@/lib/route-input";
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
    // mudança de datas invalida a janela rotativa
    await db()
      .update(schema.routes)
      .set({ ...row, cursor: 0, updatedAt: new Date() })
      .where(eq(schema.routes.id, id));
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

/**
 * Dispara o workflow do worker imediatamente (workflow_dispatch).
 * Requer GITHUB_DISPATCH_TOKEN (fine-grained, Actions: read & write) e GITHUB_REPO.
 */
export async function runNow(routeId: number | null): Promise<{ ok: boolean; message: string }> {
  await requireSession();
  const token = process.env.GITHUB_DISPATCH_TOKEN;
  const repo = process.env.GITHUB_REPO;
  if (!token || !repo) {
    return { ok: false, message: "Configure GITHUB_DISPATCH_TOKEN e GITHUB_REPO no Vercel." };
  }
  const res = await fetch(
    `https://api.github.com/repos/${repo}/actions/workflows/check-prices.yml/dispatches`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
      body: JSON.stringify({
        ref: "main",
        inputs: { route_id: routeId == null ? "" : String(routeId), force: "true" },
      }),
    },
  );
  if (!res.ok) {
    return { ok: false, message: `GitHub respondeu ${res.status}: ${await res.text()}` };
  }
  return { ok: true, message: "Busca disparada! Os resultados aparecem em 1–3 minutos." };
}
