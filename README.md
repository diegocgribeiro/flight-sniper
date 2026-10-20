# ✈ Flight Sniper

Monitor pessoal de passagens aéreas. Você cadastra rotas com datas fixas, um período
("entre 01 e 12/dez, viagem de 4 dias") ou um horizonte flexível ("próximos 6 meses"),
define o preço alvo e a frequência das buscas. Quando aparece um preço **abaixo da meta**,
chega um e-mail (e, se você cadastrar um tópico, uma notificação no celular pelo [ntfy.sh](https://ntfy.sh)).

Tudo roda no tier gratuito: **Vercel** (site), **Neon** (Postgres), **GitHub Actions** (agendador e
scraper) e **Resend** (e-mail). Os preços vêm do **Google Flights** via
[`fast-flights`](https://github.com/AWeirdDev/fast-flights).

## Arquitetura

```
cron-job.org (todo hora cheia) ──► Vercel /api/cron ──► GitHub Actions (workflow_dispatch)
                                                              │
                                                              ▼
                                        worker Python (fast-flights → Google Flights)
                                              │  grava preços / decide alertas
                                              ▼
Vercel (Next.js, 24/7) ◄──────────────► Neon Postgres ──► Resend (e-mail) + ntfy.sh (push)
   cadastro de rotas, histórico, gráfico, botão "Buscar agora" (workflow_dispatch)
```

| Peça | Onde | Por quê |
|---|---|---|
| Site | `web/` · Next.js 16 no Vercel | Fica no ar 24/7; o Hobby só permite cron 1x/dia, então não agenda as buscas |
| Worker | `worker/` · Python 3.12 | `fast-flights` é Python; no Actions o job tem até 6h, sem o limite de 300s do Vercel |
| Disparo | cron-job.org → `web/src/app/api/cron` | O `schedule` do GitHub atrasa horas ou pula execuções; o cron-job.org (grátis) chama o site toda hora cheia e o site dispara o workflow, que começa em segundos |
| Agenda | `worker/src/flight_sniper/schedule.py` | Horários cheios de relógio: "a cada 2h das 6h às 24h" = 6h, 8h, 10h… A rota roda se ainda não foi checada no horário vigente, então disparos extras não duplicam buscas |

### Como as datas viram buscas

| Modo | Combinações |
|---|---|
| **Data fixa** | Exatamente ida/volta informadas |
| **Período** | Toda ida/volta que **cabe** dentro do período com duração entre mín. e máx. Ex.: 01–12/dez com 4 dias → 01→05, 02→06 … 08→12 |
| **Próximos meses** | Ida entre amanhã e o horizonte (a volta pode passar dele), duração mín./máx. |

Vários aeroportos (`UDI, CNF` → `LIS, OPO`) multiplicam as combinações. Quando o total passa do
**máx. de buscas por execução** (60 por padrão), o worker monta uma **amostra representativa**: as
idas são espalhadas pelo período inteiro (alternando dias da semana), cada ida recebe uma duração
alternando entre mín. e máx., e a mesma grade vale para cada par de aeroportos. Assim "próximos
12 meses" já dá a estimativa de preço na primeira varredura, que é disparada ao salvar a rota.

No formulário, origem e destino aceitam o nome da cidade ("Uberlândia", "São Paulo", "Londres"):
a busca usa a base pública do [OurAirports](https://ourairports.com/data/) gerada por
`web/scripts/build_airports.py`, e cidades com vários aeroportos podem entrar todas de uma vez.

### Regra do alerta

Cada período em que o preço fica abaixo da meta é um "episódio" (`routes.alert_floor`):

| Situação | Notifica? |
|---|---|
| Caiu abaixo da meta pela primeira vez | Sim |
| Continua abaixo, mesmo preço ou maior que o último avisado | Não |
| Continua abaixo e caiu mais | Sim |
| Subiu acima da meta e depois voltou a ficar abaixo | Sim (novo episódio) |

Uma varredura com erros nunca encerra o episódio, para não repetir aviso por falha de busca.
O e-mail é obrigatório; o ntfy é opcional por rota (tópicos do ntfy.sh são públicos, use um nome
difícil de adivinhar).

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
| `CRON_SECRET` | Segredo do `/api/cron` (header `Authorization: Bearer <CRON_SECRET>`) |
| `NTFY_SERVER` | *(opcional)* Servidor ntfy, padrão `https://ntfy.sh` |

### 4. GitHub Actions
Em **Settings → Secrets and variables → Actions**:

- **Secrets:** `DATABASE_URL`, `RESEND_API_KEY`, `ALERT_EMAIL`
- **Variables:** `APP_URL` (URL do Vercel), `RESEND_FROM` (opcional)

### 5. cron-job.org
Crie um job em <https://cron-job.org> (grátis): URL `https://SEU-SITE.vercel.app/api/cron`,
**Every hour at minute 0**, fuso `America/Sao_Paulo`, e em *Advanced → Headers* adicione
`Authorization: Bearer <CRON_SECRET>`. O `schedule` do GitHub continua como reserva.

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
  seguidos e registra tudo em **Execuções recentes**.
- Sem o cron-job.org, as buscas dependem só do `schedule` do GitHub, que costuma atrasar horas.
- O histórico com mais de 90 dias é apagado para caber nos 0,5 GB do Neon.
- Ida e volta: o preço é o **total** da viagem; paradas e duração referem-se ao trecho de ida.
