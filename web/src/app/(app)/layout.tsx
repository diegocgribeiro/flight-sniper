import Link from "next/link";
import { Suspense } from "react";
import { logout } from "../actions";

export default function AppLayout({ children }: LayoutProps<"/">) {
  return (
    <div className="min-h-screen">
      <header className="border-b border-line bg-panel">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3">
          <Link href="/" className="text-lg font-semibold tracking-tight">
            ✈ Flight Sniper
          </Link>
          <nav className="flex items-center gap-2">
            <Link href="/routes/new" className="btn-primary">+ Nova rota</Link>
            <form action={logout}>
              <button className="btn-ghost">Sair</button>
            </form>
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6">
        {/* Páginas leem sessão e banco a cada request: streaming atrás do Suspense */}
        <Suspense fallback={<p className="py-10 text-center text-sm text-muted">Carregando…</p>}>
          {children}
        </Suspense>
      </main>
    </div>
  );
}
