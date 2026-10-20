import { searchAirports } from "@/lib/airports";

/** Autocomplete do formulário de rota (protegido pela sessão via proxy.ts). */
export async function GET(request: Request) {
  const q = new URL(request.url).searchParams.get("q") ?? "";
  return Response.json(searchAirports(q.slice(0, 60)));
}
