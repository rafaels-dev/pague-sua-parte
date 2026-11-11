// Roda o teste de integração (src/lib/expenses/repo.it.test.ts) contra o MongoDB real de desenvolvimento.
// Uso: node --env-file=.env.local scripts/it-expenses.mjs
// Cria apenas dados descartáveis "__it__*" e apaga tudo no final (mesmo em caso de falha).
import { spawnSync } from "node:child_process";

if (!process.env.MONGODB_URI) {
	console.error("MONGODB_URI não definida (use --env-file=.env.local).");
	process.exit(1);
}
const r = spawnSync(process.execPath, ["node_modules/vitest/vitest.mjs", "run", "src/lib/expenses/repo.it.test.ts"], {
	stdio: "inherit",
	env: { ...process.env, IT_MONGO: "1" },
});
process.exit(r.status ?? 1);
