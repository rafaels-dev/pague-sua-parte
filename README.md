# Racha Pix

Divida despesas em grupo e receba por Pix: lance o gasto, cada um paga a sua parte com Pix Copia e Cola e anexa o comprovante. Site mobile-first, em pt-BR, que roda inteiro em planos gratuitos.

## Stack

- Next.js (App Router, TypeScript) + Tailwind CSS
- Cloudflare Workers via `@opennextjs/cloudflare` (flag `nodejs_compat`)
- MongoDB Atlas (M0) com o driver oficial `mongodb`
- Firebase Authentication (Google) no cliente; o servidor valida o ID token com `jose`
- Cloudflare R2 para comprovantes (etapa futura)
- Vitest para testes

## Rodando localmente

```bash
npm install
cp .env.example .env.local      # preencha os valores
cp .dev.vars.example .dev.vars  # usado pelo preview no runtime do Workers
npm run dev                     # http://localhost:3000
```

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

`NEXT_PUBLIC_*` são embutidas no bundle em tempo de build. Em produção, defina os segredos com `npx wrangler secret put MONGODB_URI` (e as demais variáveis no painel ou em `wrangler.jsonc`).

## Comandos

```bash
npm run dev       # servidor de desenvolvimento
npm run lint      # ESLint
npm test          # Vitest
npm run build     # build do Next.js
npm run preview   # build OpenNext + preview local no runtime do Workers
npm run deploy    # build OpenNext + deploy (requer `wrangler login`)
npm run cf-typegen  # regenera cloudflare-env.d.ts
```

## Estrutura dos contratos

- `src/lib/auth/server.ts`: `requireUser(request)`, `UnauthorizedError`, `AuthUser`
- `src/lib/auth/client.ts`: `signInWithGoogle`, `signOut`, `getIdToken`, `onUserChanged`
- `src/lib/db/client.ts`: `getDb()`
- `src/lib/money.ts`: `formatBRL`, `parseBRLToCents` (valores sempre em centavos inteiros)
