import { timingSafeEqual } from "node:crypto";
import { dispatchScan } from "@/lib/github";

/**
 * Chamado de hora em hora por um agendador externo (cron-job.org), que é pontual.
 * Só dispara o worker; cada rota decide pelo próprio horário se está na vez.
 * Autenticação: header `Authorization: Bearer <CRON_SECRET>`.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  const given = request.headers.get("authorization") ?? "";
  const expected = `Bearer ${secret}`;
  const authorized =
    !!secret &&
    given.length === expected.length &&
    timingSafeEqual(Buffer.from(given), Buffer.from(expected));
  if (!authorized) {
    return Response.json({ ok: false, message: "unauthorized" }, { status: 401 });
  }

  const result = await dispatchScan({ routeId: null, force: false, trigger: "cron" });
  return Response.json(result, { status: result.ok ? 200 : 502 });
}
