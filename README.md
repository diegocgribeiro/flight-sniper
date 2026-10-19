# ✈ Flight Sniper

Monitor pessoal de passagens aéreas. Você cadastra rotas com datas fixas, um período
("entre 01 e 12/dez, viagem de 4 dias") ou um horizonte flexível ("próximos 6 meses"),
define o preço alvo e a frequência das buscas. Quando aparece um preço **abaixo da meta**,
chega um e-mail. Nenhum outro e-mail é enviado.

Tudo roda no tier gratuito: **Vercel** (site), **Neon** (Postgres), **GitHub Actions** (agendador e
scraper) e **Resend** (e-mail). Os preços vêm do **Google Flights** via
[`fast-flights`](https://github.com/AWeirdDev/fast-flights).

## Arquitetura

```
GitHub Actions (cron de hora em hora) ──► worker Python (fast-flights → Google Flights)
                                              │  grava preços / decide alertas
                                              ▼
Vercel (Next.js, 24/7) ◄──────────────► Neon Postgres ──► Resend (e-mail se < meta)
   cadastro de rotas, histórico, gráfico, botão "Buscar agora" (workflow_dispatch)
```

| Peça | Onde | Por quê |
|---|---|---|
| Site | `web/` · Next.js 16 no Vercel | Fica no ar 24/7; o Hobby só permite cron 1x/dia, então não agenda as buscas |
| Worker | `worker/` · Python 3.12 | `fast-flights` é Python; no Actions o job tem até 6h, sem o limite de 300s do Vercel |
| Agenda | `.github/workflows/check-prices.yml` | Dispara **de hora em hora**. Cada rota decide se está "na vez" pelas faixas cadastradas (ex.: 1h de madrugada, 2h no resto do dia) |

### Como as datas viram buscas

| Modo | Combinações |
|---|---|
| **Data fixa** | Exatamente ida/volta informadas |
| **Período** | Toda ida/volta que **cabe** dentro do período com duração entre mín. e máx. Ex.: 01–12/dez com 4 dias → 01→05, 02→06 … 08→12 |
| **Próximos meses** | Ida entre amanhã e o horizonte (a volta pode passar dele), duração mín./máx. |

Vários aeroportos (`UDI, CNF` → `LIS, OPO`) multiplicam as combinações. Quando o total passa do
**máx. de buscas por execução**, o worker usa uma **janela rotativa**: cada execução cobre a próxima
fatia, e o formulário mostra em quantas execuções a cobertura completa acontece.

### Regra do alerta

O e-mail é enviado quando `menor preço < meta` **e** ele é menor que qualquer alerta já enviado
para a rota nas últimas 24h (`ALERT_COOLDOWN_HOURS`). Assim você não recebe o mesmo voo toda hora,
mas uma nova queda sempre avisa.

## Setup

### 1. Neon
Crie um projeto em <https://neon.tech> e copie a connection string (`DATABASE_URL`).
As migrations (`web/drizzle/`) rodam automaticamente no build do Vercel (`vercel-build`).
Para rodar localmente:

```bash
cd web && npm run db:migrate
```

### 2. Resend
Crie uma API key em <https://resend.com>. Sem domínio verificado, o remetente
`onboarding@resend.dev` só entrega para o e-mail da sua conta Resend, o que basta para uso pessoal.

### 3. Vercel
Importe o repositório com **Root Directory = `web`** e configure as variáveis de `web/.env.example`:

| Variável | Descrição |
|---|---|
| `DATABASE_URL` | Neon |
| `APP_PASSWORD` | Senha do site |
| `AUTH_SECRET` | `openssl rand -base64 32` |
| `ALERT_EMAIL` | E-mail padrão |
| `GITHUB_DISPATCH_TOKEN` | *(opcional)* PAT fine-grained só deste repo, **Actions: read & write**, para o botão "Buscar agora" |
| `GITHUB_REPO` | `dono/repo` |

### 4. GitHub Actions
Em **Settings → Secrets and variables → Actions**:

- **Secrets:** `DATABASE_URL`, `RESEND_API_KEY`, `ALERT_EMAIL`
- **Variables:** `APP_URL` (URL do Vercel), `RESEND_FROM` (opcional)

## Desenvolvimento

```bash
# site
cd web && cp .env.example .env.local && npm install && npm run dev

# worker
cd worker && python -m venv .venv && .venv/bin/pip install -e ".[dev]"
.venv/bin/pytest -q
.venv/bin/python -m flight_sniper.main --force --dry-run   # busca sem gravar/enviar
```

## Limites e cuidados

- `fast-flights` **não é oficial**: lê o HTML do Google Flights. Se o Google mudar a página ou
  bloquear o IP do runner, as buscas falham. O worker faz retentativas, aborta a rota após 5 erros
  seguidos sem avançar o cursor, e registra tudo em **Execuções recentes**.
- O cron do GitHub pode atrasar alguns minutos; a agenda tem 15 min de tolerância.
- O histórico com mais de 90 dias é apagado para caber nos 0,5 GB do Neon.
- Ida e volta: o preço é o **total** da viagem; paradas e duração referem-se ao trecho de ida.
