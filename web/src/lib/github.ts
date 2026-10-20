import "server-only";

export type DispatchResult = { ok: boolean; message: string };

/**
 * Dispara o workflow do worker (workflow_dispatch), que começa em segundos,
 * ao contrário do `schedule` do GitHub Actions, que atrasa ou pula execuções.
 * Requer GITHUB_DISPATCH_TOKEN (fine-grained, Actions: read & write) e GITHUB_REPO.
 */
export async function dispatchScan(opts: {
  routeId: number | null;
  force: boolean;
  trigger: "manual" | "cron" | "new-route";
}): Promise<DispatchResult> {
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
        inputs: {
          route_id: opts.routeId == null ? "" : String(opts.routeId),
          force: String(opts.force),
          trigger: opts.trigger,
        },
      }),
    },
  );
  if (!res.ok) {
    return { ok: false, message: `GitHub respondeu ${res.status}: ${await res.text()}` };
  }
  return { ok: true, message: "Busca disparada! Os resultados aparecem em 1–3 minutos." };
}
