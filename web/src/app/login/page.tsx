import { Suspense } from "react";
import { LoginForm } from "./login-form";

async function LoginFormWithNext({ searchParams }: { searchParams: PageProps<"/login">["searchParams"] }) {
  const sp = await searchParams;
  const next = typeof sp.next === "string" ? sp.next : "/";
  return <LoginForm next={next} />;
}

export default function LoginPage(props: PageProps<"/login">) {
  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="card w-full max-w-sm p-6">
        <div className="mb-6">
          <div className="text-2xl font-semibold tracking-tight">✈ Flight Sniper</div>
          <p className="mt-1 text-sm text-muted">Entre para gerenciar suas rotas.</p>
        </div>
        <Suspense fallback={<LoginForm next="/" />}>
          <LoginFormWithNext searchParams={props.searchParams} />
        </Suspense>
      </div>
    </main>
  );
}
