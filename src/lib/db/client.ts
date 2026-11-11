import { MongoClient, type Db } from "mongodb";
import { getCloudflareContext } from "@opennextjs/cloudflare";

/**
 * Retorna o Db do MongoDB Atlas (MONGODB_URI / MONGODB_DB, default "despesas").
 *
 * Em Workers, objetos de I/O (sockets) não podem ser reaproveitados entre
 * requisições (docs da Cloudflare), então NÃO guardamos o client em variável de
 * módulo. Criamos um client por requisição (memoizado pelo objeto de contexto
 * da requisição, para várias chamadas na mesma requisição dividirem a conexão).
 * Fora de Workers (next dev/build, testes) não há contexto Cloudflare e um
 * único client é reutilizado.
 */

type Env = { MONGODB_URI?: string; MONGODB_DB?: string };

const CLIENT_OPTIONS = {
	maxPoolSize: 1,
	minPoolSize: 0,
	maxIdleTimeMS: 20_000,
	serverSelectionTimeoutMS: 5_000,
	connectTimeoutMS: 5_000,
} as const;

const perRequest = new WeakMap<object, Promise<MongoClient>>();
let shared: Promise<MongoClient> | undefined;

function readEnv(): { env: Env; scope: object | null } {
	try {
		const { env, ctx } = getCloudflareContext();
		return { env: env as unknown as Env, scope: ctx as object };
	} catch {
		return { env: {}, scope: null };
	}
}

async function connect(uri: string): Promise<MongoClient> {
	const client = new MongoClient(uri, CLIENT_OPTIONS);
	try {
		return await client.connect();
	} catch (err) {
		await client.close().catch(() => undefined);
		throw err;
	}
}

export async function getDb(): Promise<Db> {
	const { env, scope } = readEnv();
	const uri = env.MONGODB_URI || process.env.MONGODB_URI;
	if (!uri) {
		throw new Error("MONGODB_URI não está configurada (defina o segredo MONGODB_URI).");
	}
	const dbName = env.MONGODB_DB || process.env.MONGODB_DB || "despesas";

	let clientPromise: Promise<MongoClient>;
	if (scope) {
		clientPromise = perRequest.get(scope) ?? connect(uri);
		perRequest.set(scope, clientPromise);
	} else {
		clientPromise = shared ??= connect(uri);
	}
	try {
		return (await clientPromise).db(dbName);
	} catch (err) {
		if (scope) perRequest.delete(scope);
		else shared = undefined;
		throw err;
	}
}
