import { notFound } from "next/navigation";
import { RouteForm } from "@/components/route-form";
import { getRoute } from "@/lib/queries";
import { requireSession } from "@/lib/session";

export default async function EditRoutePage(props: PageProps<"/routes/[id]/edit">) {
  await requireSession();
  const { id } = await props.params;
  const route = await getRoute(Number(id));
  if (!route) notFound();
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <h1 className="text-2xl font-semibold tracking-tight">Editar rota</h1>
      <RouteForm route={route} defaultEmail={process.env.ALERT_EMAIL} />
    </div>
  );
}
