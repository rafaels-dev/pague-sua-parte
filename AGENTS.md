<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# PagueSuaParte — guia para agentes

Site mobile-first, em pt-BR, para dividir despesas em grupo e pagar por Pix. Projeto open source, em produção em https://paguesuaparte.com.br. Stack, variáveis de ambiente e passos de publicação estão no `README.md`; este arquivo traz o que um agente precisa saber para mexer no código sem quebrar as regras do projeto.

## Princípios do produto

- **Muito fácil de usar**: o público inclui pessoas idosas e pouco técnicas. Textos curtos, em português simples, sem jargão. Uma ação principal por tela.
- **Mobile-first**: toda tela precisa caber em 390px sem rolagem horizontal. Conferir no Safari do iPhone quando mexer em campos de formulário (ex.: `input[type="date"]`).
- **Tudo gratuito**: a solução roda inteira em planos gratuitos (Vercel Hobby, Atlas M0, R2, Firebase Auth). Não introduzir serviço pago nem dependência pesada sem pedido explícito.
- **Sem complicar**: preferir o modelo mais simples que resolve. Exemplo de decisão já tomada: pagamento a mais vira **devolução** dentro da própria despesa; não existe conta-corrente nem crédito entre pessoas.

## Fluxo de trabalho com agentes

- **Revisão obrigatória antes da `main`**: todo código entregue por um agente deve ser avaliado por **outro** agente executando `/code-review`, em busca de problemas, antes de qualquer push na `main`. Os problemas encontrados são corrigidos (ou explicitamente descartados com justificativa) antes do push.
- **Push na `main` publica em produção** automaticamente (integração Git da Vercel). Antes do push precisam passar: `npm run lint`, `npx tsc --noEmit`, `npm test` e `npm run build`.
- **Índices do MongoDB antes do código**: se a mudança precisa de índice novo, acrescente em `scripts/db-indexes.mjs` e rode o script contra produção *antes* do push (`node --env-file=.env.production.local scripts/db-indexes.mjs`).
- **Documentação de bibliotecas**: consultar a documentação atual (Context7 ou `node_modules/next/dist/docs/`) antes de usar APIs de Next.js, Firebase, driver do MongoDB etc.
- Relatar com honestidade o que foi verificado e como (teste unitário, teste de integração, dados fictícios, login real). Não afirmar que algo funciona em produção sem ter conferido.

## Segurança e privacidade (inegociável)

- **Nenhum segredo no código ou no histórico**: chaves do Firebase, string do MongoDB e credenciais do R2 ficam só em arquivos `.env*.local` (ignorados pelo git) e nas variáveis do projeto na Vercel. O `.env.example` lista só os nomes. Antes de commitar, conferir o diff.
- **Autorização sempre no servidor**: toda rota em `src/app/api/` valida o ID token do Firebase (`src/lib/auth/server.ts`, só login Google) e confere que quem chama é membro do grupo. Esconder um botão na tela nunca é a proteção.
- **Anexos e comprovantes são privados**: só membros do grupo acessam, sempre através das rotas da API. O bucket não é público e a URL dele nunca vai para o cliente. Downloads saem com `Cache-Control: private, no-store`.
- **Chave Pix**: só aparece para membros do mesmo grupo, na hora de pagar. Nunca incluir chave Pix em textos compartilháveis (WhatsApp) nem em logs.
- **Logs**: usar `describeError` (`src/lib/api/http.ts`), que registra nome e mensagem redigida. Não logar tokens, corpos de requisição nem dados pessoais.
- **Uploads**: no máximo 4 MB por requisição (limite de corpo da Vercel é 4,5 MB); até 3 anexos por despesa; `bodyTooLarge` recusa requisição sem `Content-Length`. Em produção, sem as variáveis `R2_*` o servidor falha em vez de gravar em disco.
- Os cabeçalhos de segurança (CSP, HSTS, `X-Frame-Options` etc.) ficam em `next.config.ts`; não afrouxar sem motivo.

## Arquitetura

- **Next.js 16, App Router, TypeScript, Tailwind v4**, runtime Node.js na Vercel (região `gru1`, em `vercel.json`). Não usar runtime Edge.
- **Páginas**: `src/app/page.tsx` (landing pública), `src/app/app/**` (área logada: início, `grupos/`, `pagar/`, `receber/`, `perfil/`), `src/app/convite/` (aceitar convite), `src/app/dev/ui/` (telas com dados fictícios para conferir layout sem login).
- **API**: `src/app/api/groups/[id]/**` (grupo, membros, pessoas cuidadas, convite, despesas, despesas fixas, relatório, resumo), `src/app/api/invites/`, `src/app/api/me/**` (resumo, contas a pagar, pagamentos em lote, quem me deve).
- **Regra de negócio** em `src/lib/` (funções puras sempre que possível, com teste ao lado em `*.test.ts`): `expenses/`, `payments/`, `recurrences/`, `reports/`, `groups/`, `users/`, `pix/`, `storage/`, `auth/`, `db/`, `api/`. Lógica de apresentação e textos em `src/lib/ui/`.
- **Componentes** em `src/components/`; o kit visual (Material 3) fica em `src/components/ui/` e deve ser reutilizado em vez de criar botões, cartões e sheets novos.
- **Banco**: MongoDB com o driver oficial; cliente em cache no `globalThis` com pool pequeno (`src/lib/db/client.ts`). Sem ORM.
- **Arquivos**: Cloudflare R2 pela API S3 com `aws4fetch` (`src/lib/storage/`); em desenvolvimento, sem `R2_*`, grava em `.data/attachments/`.
- **Tema**: claro/escuro por `data-theme` no `<html>` (`src/lib/ui/theme.ts`); cores só pelos tokens de `src/app/globals.css`, que existem em três blocos (claro, escuro automático, escuro escolhido).

## Modelo de domínio (resumo)

- **Grupo**: membros com login Google, um administrador, e **pessoas cuidadas** (sem celular), cuja conta é controlada por um membro responsável (`actsFor`).
- **Despesa**: quem pagou (`paidBy`), valor em centavos, forma de pagamento (à vista com dinheiro/cartão/Pix, ou parcelado), anexos e as **partes** (`shares`) de cada pessoa.
- **Parte** (`share`): `amountCents`, `paidCents`, quem marcou e como (`markedBy`, `method`), comprovante (`receipt`) e lote (`batch`, quando paga pelo "Pagar tudo"). `paidCents < amountCents` é pendente; igual é pago; maior é **devolução** que quem pagou a despesa deve à pessoa.
- **Concorrência**: toda alteração de partes passa por `mutateShares`, com controle otimista pelo campo `version`. Não escrever em `shares` por fora.
- **Comprovantes**: um mesmo arquivo pode servir a várias partes (lote); o objeto só é apagado quando nenhuma parte o referencia (`releaseReceipts`).
- **Despesas fixas** (`recurrences`): guarda-se só o modelo mensal; a despesa de cada mês é criada quando o mês chega, de forma preguiçosa e idempotente (`materializeRecurrences`). Nunca pré-criar os meses futuros.
- **Pagar tudo**: agrupa o que a pessoa deve por destinatário (mesmo recebedor e mesma chave Pix), gera um único Pix e vincula um único comprovante a todas as partes. Pode ser de todos os grupos ou de um só (`?grupo=`).
- **Quem pagou**: cada pessoa lança as próprias despesas e as de quem cuida; o administrador pode lançar em nome de qualquer membro atual do grupo (`canLaunchPaidBy`), e a despesa registra `createdBy` ("Lançada por ... (administrador)"). O Pix gravado é sempre o de quem pagou. Se essa pessoa ainda não tem chave, a despesa fica sem `pix` e a chave é resolvida na leitura (`fillMissingPix`); todo código que lê `e.pix` precisa tratar a ausência.
- **Pix copia-e-cola estático** (`src/lib/pix/`): o identificador (txid, campo 62-05) é sempre `***`. Um identificador próprio fez o banco recebedor (Inter) recusar o pagamento ("rejeitado pelo PSP do recebedor"). A mensagem com o nome da despesa vai no campo 26-02 (`src/lib/pix/message.ts`), só com letras, números e espaços ASCII; cada banco decide se a exibe (a CAIXA não mostra para quem paga).
- **Permissões**: quem pagou a despesa (ou quem cuida dessa pessoa) e o administrador do grupo podem editar, recalcular a divisão, escolher quem participa, marcar partes como pagas e desfazer. Os demais só agem sobre a própria parte (e a de quem cuidam).
- **Dinheiro** sempre em centavos inteiros (`src/lib/money.ts`); nunca usar ponto flutuante para valores.

## Testes e conferência

- `npm test` (Vitest) roda os testes unitários; toda regra nova de divisão, permissão ou texto compartilhável ganha teste.
- Teste de integração opcional contra o banco de **desenvolvimento**: `node --env-file=.env.local scripts/it-expenses.mjs`. Nunca rodar testes contra o banco de produção.
- Para conferir layout, acrescentar o estado novo nas telas de `src/app/dev/ui/` e olhar em largura de celular.
- `.agents/` e `.claude/skills/` (skills instaladas) são ignorados pelo git; só o `skills-lock.json` é versionado.

## Notificações (e-mail e push)

- **Eventos** (`src/lib/notifications/`): entrada no grupo (avisa o administrador), pagamento (avisa quem recebe, ou quem cuida dele; avisa também o devedor quando outra pessoa marcou a parte dele; o "Pagar tudo" gera um aviso por destinatário), devolução (avisa quem recebe), despesa nova (cada pessoa com parte, ou quem cuida dela, com o total sob sua responsabilidade; o administrador lançando em nome de outro avisa esse membro), despesa fixa do mês atual (uma vez, só quando o documento foi de fato inserido) e quem foi incluído numa edição ("mudar quem divide"). Nunca avisa quem fez a ação; "desfazer" não avisa; chave Pix nunca entra.
- **Como dispara**: os repositórios devolvem fatos do que mudou de verdade (`payments`, `newExpense`, `joined`), calculados comparando as partes antes e depois da gravação (`facts.ts`); as rotas chamam `afterPayments`/`afterNewExpenses`/`afterMemberJoined` (`events.ts`), que usam `after()` do Next (`schedule.ts`). Falha de envio só vai para o log (`describeError`) e nunca quebra a ação. Textos e destinatários são funções puras em `messages.ts`, com teste.
- **Canais**: e-mail por Resend via `fetch` (`RESEND_API_KEY`, `EMAIL_FROM`; só para e-mail confirmado pelo Google, `users.emailVerified`) e Web Push com `web-push` (`NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`; inscrições em `push_subscriptions`, removidas ao devolver 404/410 e ao sair da conta). Sem as variáveis, o canal não faz nada. Links usam `APP_URL`.
- **Preferências**: `users.notify { email, push }`, padrão ligado; tela em Perfil > Avisos (`src/components/notify-card.tsx`); rotas `/api/me/notifications` e `/api/me/push`. `public/sw.js` só trata `push` e `notificationclick`; `src/app/manifest.ts` existe porque o iPhone só recebe push com o app na Tela de Início.
