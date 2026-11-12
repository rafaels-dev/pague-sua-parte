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

- **E-mail (Resend)**: crie a conta, verifique o domínio `paguesuaparte.com.br` (registros DNS na Cloudflare), gere uma API key e configure `RESEND_API_KEY` e `EMAIL_FROM` (ex.: `PagueSuaParte <avisos@paguesuaparte.com.br>`). Só recebe e-mail quem tem o e-mail confirmado pelo Google.
- **Push (VAPID)**: rode `npx web-push generate-vapid-keys` e configure `NEXT_PUBLIC_VAPID_PUBLIC_KEY` (vai no build), `VAPID_PRIVATE_KEY` e `VAPID_SUBJECT` (`mailto:...`). Cada pessoa ativa em Perfil > Avisos; no iPhone é preciso antes adicionar o app à Tela de Início.
- `APP_URL` (opcional) define o endereço dos links dos e-mails.
- Rode `npm run db:indexes` para criar os índices de `push_subscriptions` antes de publicar.

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
| `RESEND_API_KEY` | servidor (segredo) | Chave da API do Resend; sem ela não há e-mail |
| `EMAIL_FROM` | servidor | Remetente verificado, ex.: `PagueSuaParte <avisos@paguesuaparte.com.br>` |
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
