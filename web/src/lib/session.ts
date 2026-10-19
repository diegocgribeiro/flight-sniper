import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { SESSION_COOKIE, verifySessionToken } from "./auth";

/** Garante sessão válida dentro de Server Actions / Server Components. */
export async function requireSession(): Promise<void> {
  // A checagem usa o relógio (expiração do token): força renderização por request.
  await connection();
  const store = await cookies();
  if (!(await verifySessionToken(store.get(SESSION_COOKIE)?.value))) {
    redirect("/login");
  }
}
