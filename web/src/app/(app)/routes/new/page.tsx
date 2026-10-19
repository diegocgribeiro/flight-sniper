import { RouteForm } from "@/components/route-form";
import { requireSession } from "@/lib/session";

export default async function NewRoutePage() {
  await requireSession();
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <h1 className="text-2xl font-semibold tracking-tight">Nova rota</h1>
      <RouteForm defaultEmail={process.env.ALERT_EMAIL} />
    </div>
  );
}
