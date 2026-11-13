# PagueSuaParte

Divida despesas em grupo e receba por Pix: lance o gasto, cada um paga a sua parte com Pix Copia e Cola e anexa o comprovante. Site mobile-first, em pt-BR, que roda inteiro em planos gratuitos.

## Stack

- Next.js (App Router, TypeScript) + Tailwind CSS
- Vercel (funções Node.js, plano Hobby, região São Paulo `gru1`)
- MongoDB Atlas (M0) com o driver oficial `mongodb`
- Firebase Authentication (Google) no cliente; o servidor valida o ID token com `jose`
- Cloudflare R2 para os anexos das despesas, pela API S3 (`aws4fetch`)
- Vitest para testes

## Rodando localmente

```bash
npm install
cp .env.example .env.local      # preencha os valores
npm run dev                     # http://localhost:3000
```

## Anexos

Os anexos (foto ou PDF, até 3 por despesa, 4 MB no total) e os comprovantes (4 MB) ficam num bucket do Cloudflare R2, acessado pela API S3. O limite de 4 MB existe porque as funções da Vercel recusam requisições acima de 4,5 MB.

Sem as variáveis `R2_*`, o `npm run dev` guarda os arquivos em disco, em `.data/attachments/` (ignorada pelo git). Em produção, sem elas o servidor responde erro 500: nunca grava em disco.

## Avisos (e-mail e push)

O app avisa por e-mail e por push (Web Push) quando alguém entra no grupo, paga, devolve ou lança uma despesa (inclusive as fixas). Cada canal só funciona se as variáveis dele existirem; sem elas, fica desligado em silêncio.

- **E-mail (Mailgun)**: só recebe quem tem o e-mail confirmado pelo Google. Para ver os modelos, rode `npm run dev` e abra `/dev/ui/emails`. Passo a passo:
  1. Crie a conta em mailgun.com (plano Free: 100 e-mails por dia, 1 domínio de envio, 1 dia de histórico; confira em https://www.mailgun.com/pricing/).
  2. Em Sending > Domains > Add domain, cadastre o domínio de envio (`paguesuaparte.com.br`; um subdomínio como `mg.` também serve) e escolha a região **US** (o Mailgun só tem US e EU; a EU serve a quem precisa guardar dados na Europa). A região não muda depois de criado o domínio.
  3. No DNS da Cloudflare, crie os registros que o painel mostrar, **só DNS, sem proxy (nuvem cinza)**: TXT de SPF (`v=spf1 include:mailgun.org ~all` no subdomínio), TXT/CNAME de DKIM (o valor está no painel) e, se quiser, o CNAME de rastreio. O MX do Mailgun só serve para **receber** e-mail nesse subdomínio: o app não precisa dele (e o MX do domínio raiz, se existir, não deve ser mexido). Clique em "Verify DNS settings" e espere o selo verde (pode levar até 48 h).
  4. Em Sending > Domains > (seu domínio) > Sending keys, crie uma **chave de envio** (só envia por esse domínio).
  5. Na Vercel, configure `MAILGUN_SENDING_KEY` (a chave de envio), `MAILGUN_DOMAIN` (`paguesuaparte.com.br`), `MAILGUN_REGION` (`us`, pode omitir) e `EMAIL_FROM` (`PagueSuaParte <avisos@paguesuaparte.com.br>`). Sem qualquer uma das três obrigatórias, o e-mail fica desligado em silêncio.
  6. (Recomendado) Publique um DMARC em `_dmarc.paguesuaparte.com.br` (TXT `v=DMARC1; p=none; rua=mailto:...`) e só endureça depois de ver os relatórios. Com remetente no mesmo subdomínio que o Mailgun assina e autentica (SPF e DKIM), o alinhamento do DMARC passa; um remetente em outro domínio exigiria mais configuração.

  Por que subdomínio: a documentação do Mailgun não recomenda um nem outro (https://documentation.mailgun.com/docs/mailgun/user-manual/domains/domains-verify); a escolha aqui é prática: o domínio raiz só pode ter um SPF e provavelmente já tem registros de e-mail, e a reputação dos avisos fica separada do resto. O envio já desliga rastreio de abertura e de clique, então o CNAME de rastreio é opcional.
- **Lembretes de vencimento** (despesa fixa: 15, 7, 3 dias antes e no dia): o `vercel.json` agenda `/api/cron/reminders` uma vez por dia (`0 10 * * *` UTC, de manhã em São Paulo; no plano Hobby a Vercel roda em qualquer minuto da hora marcada). Crie `CRON_SECRET` nas variáveis da Vercel (a Vercel o envia sozinha no cabeçalho) e rode `scripts/db-indexes.mjs` antes do push.
- **Push (VAPID)**: rode `npx web-push generate-vapid-keys` e configure `NEXT_PUBLIC_VAPID_PUBLIC_KEY` (vai no build), `VAPID_PRIVATE_KEY` e `VAPID_SUBJECT` (`mailto:...`). Cada pessoa ativa em Perfil > Avisos; no iPhone é preciso antes adicionar o app à Tela de Início.
- **Caixa de avisos (sininho)**: coleção `inbox` (um documento por aviso por pessoa: `uid`, `title`, `body`, `url`, `createdAt`, `readAt?`; nunca Pix, comprovante nem e-mail), gravada por `notify` antes dos envios; `users.inboxSeenAt` zera o contador. Índices `inbox_uid_created` (`{ uid, createdAt: -1 }`) e `inbox_ttl` (90 dias), criados por `npm run db:indexes`: rode antes do push. Rotas: `GET /api/me/inbox`, `GET /api/me/inbox/count`, `POST /api/me/inbox/seen`, `POST /api/me/inbox/read`. Tela: `/app/avisos`.
- `APP_URL` (opcional) define o endereço dos links dos e-mails.
- Rode `npm run db:indexes` para criar os índices de `push_subscriptions` antes de publicar.

## Planejar despesa (pré-grupo)

Antes de existir grupo e despesa, alguém pode "planejar" um gasto grande (ex.: hotel de fim de ano). O criador informa nome, valor total e, se quiser, quando vai ser, detalhes (texto com links), até 3 fotos e quantas pessoas pensa em chamar. Ele manda o link de convite do plano (WhatsApp); cada pessoa diz **Vou** (com "até quanto posso pagar", opcional) ou **Não vou**, por si e por pessoas sem celular que acrescentar. A conta (`src/lib/plans/compute.ts`) acha o maior grupo em que a parte igual cabe no limite de todos. O limite de cada um só aparece para a própria pessoa, para quem a acrescentou e para o criador. Fechar = **Criar grupo e despesa** (só o criador): cria o grupo com quem foi escolhido e a despesa dividida em partes iguais; a despesa guarda `planId` e mostra "Ver o plano". Se preferir (ex.: "pagamos 50% do sítio e vamos dividir diferente"), escolha **Só o grupo**: o grupo é criado com as mesmas pessoas, sem lançar a despesa e sem escolher quem pagou; as despesas são lançadas depois. As fotos ficam no mesmo bucket dos anexos (prefixo `plans/`), sempre servidas pela API. Depois que o plano vira grupo, o mesmo link de convite do plano leva a pessoa a **Entrar no grupo** (sem parte nas despesas que já existem; o administrador inclui à mão), até o dia do evento ou, sem data, 7 dias depois do fechamento.

- Coleção `plans`; índices em `scripts/db-indexes.mjs` (`npm run db:indexes`; rode contra produção antes do push).
- Telas de exemplo: `/dev/ui/telas?tela=plano-fecha` (e `plano-nao-fecha`, `plano-acima-limite`, `plano-criador-limites`, `plano-virou`, `plano-virou-sem-despesa`, `plano-cancelado`, `plano-novo`, `plano-fechar`, `plano-fechar-so-grupo`, `plano-convite`, `plano-convite-confirmado`, `plano-convite-vencido`, `grupo-remover`, `grupo-nao-voltam`, `plano-lista`).

## Publicar na Vercel

1. **Atlas**: crie o cluster e o usuário do banco; libere o acesso de rede para a Vercel (a Hobby não tem IP fixo, então use `0.0.0.0/0` com um usuário de senha forte). Depois rode uma vez `npm run db:indexes` (usa o `.env.local`).
2. **R2**: crie um bucket e um API token do R2 com a permissão *Object Read & Write* restrita a esse bucket. Guarde o Account ID, o Access Key ID e o Secret Access Key.
3. **Firebase**: ative o login Google e adicione o domínio do site em *Authentication > Settings > Authorized domains*.
4. **Vercel**: importe o repositório (framework Next.js) e cadastre as variáveis de ambiente abaixo. A região das funções (`gru1`) já está no `vercel.json`.

## Variáveis de ambiente

| Nome | Onde | Descrição |
| --- | --- | --- |
| `NEXT_PUBLIC_FIREBASE_API_KEY` | build/cliente | API key web do Firebase |
| `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN` | build/cliente | `<projeto>.firebaseapp.com` |
| `NEXT_PUBLIC_FIREBASE_PROJECT_ID` | build/cliente | ID do projeto Firebase |
| `NEXT_PUBLIC_FIREBASE_APP_ID` | build/cliente | App ID web do Firebase |
| `FIREBASE_PROJECT_ID` | servidor | Usado para validar o token (issuer/audience) |
| `MONGODB_URI` | servidor (segredo) | String de conexão do Atlas |
| `MONGODB_DB` | servidor | Nome do banco (padrão `despesas`) |
| `R2_ACCOUNT_ID` | servidor | ID da conta Cloudflare dona do bucket |
| `R2_ACCESS_KEY_ID` | servidor (segredo) | Access Key ID do token R2 |
| `R2_SECRET_ACCESS_KEY` | servidor (segredo) | Secret Access Key do token R2 |
| `R2_BUCKET` | servidor | Nome do bucket dos anexos |
| `APP_URL` | servidor | (opcional) Endereço do app nos links dos e-mails |
| `MAILGUN_SENDING_KEY` | servidor (segredo) | Chave de envio do Mailgun; sem ela não há e-mail |
| `MAILGUN_DOMAIN` | servidor | Domínio de envio cadastrado no Mailgun, ex.: `paguesuaparte.com.br` |
| `MAILGUN_REGION` | servidor | (opcional) `us` (padrão) ou `eu` |
| `EMAIL_FROM` | servidor | Remetente do domínio de envio, ex.: `PagueSuaParte <avisos@paguesuaparte.com.br>` |
| `CRON_SECRET` | servidor (segredo) | Segredo do Vercel Cron (16+ caracteres aleatórios); a rota `/api/cron/reminders` (lembretes de vencimento das despesas fixas) só aceita `Authorization: Bearer <CRON_SECRET>` |
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY` | build/cliente | Chave pública VAPID (push) |
| `VAPID_PRIVATE_KEY` | servidor (segredo) | Chave privada VAPID |
| `VAPID_SUBJECT` | servidor | `mailto:` de contato para os serviços de push |

`NEXT_PUBLIC_*` são embutidas no bundle em tempo de build. Nunca commite valores reais: use `.env.local` no desenvolvimento e as variáveis do projeto na Vercel.

## Comandos

```bash
npm run dev          # servidor de desenvolvimento
npm run lint         # ESLint
npm test             # Vitest
npm run build        # build do Next.js
npm run db:indexes   # cria os índices no MongoDB (usa .env.local)
```

## Estrutura dos contratos

- `src/lib/auth/server.ts`: `requireUser(request)`, `UnauthorizedError`, `AuthUser`
- `src/lib/auth/client.ts`: `signInWithGoogle`, `signOut`, `getIdToken`, `onUserChanged`
- `src/lib/db/client.ts`: `getDb()`
- `src/lib/money.ts`: `formatBRL`, `parseBRLToCents` (valores sempre em centavos inteiros)
