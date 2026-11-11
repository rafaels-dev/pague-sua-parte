import { MongoClient, type Db } from "mongodb";
import { attachDatabasePool } from "@vercel/functions";

/**
 * Retorna o Db do MongoDB Atlas (MONGODB_URI / MONGODB_DB, default "despesas").
 *
 * O client fica numa variável global: uma função "quente" da Vercel reaproveita a conexão entre
 * requisições, e o `next dev` (que recarrega os módulos) não abre uma conexão nova a cada alteração.
 * `attachDatabasePool` (@vercel/functions) avisa a Vercel para fechar as conexões ociosas antes de a
 * função ser suspensa; fora da Vercel (dev, build, testes) ele não faz nada.
 */

const CLIENT_OPTIONS = {
	maxPoolSize: 5,
	minPoolSize: 0,
	maxIdleTimeMS: 5_000,
	serverSelectionTimeoutMS: 5_000,
	connectTimeoutMS: 5_000,
	socketTimeoutMS: 20_000,
} as const;

const globalForMongo = globalThis as unknown as { __mongoClient?: Promise<MongoClient> };

async function connect(uri: string): Promise<MongoClient> {
	const client = new MongoClient(uri, CLIENT_OPTIONS);
	attachDatabasePool(client);
	try {
		return await client.connect();
	} catch (err) {
		await client.close().catch(() => undefined);
		throw err;
	}
}

export async function getDb(): Promise<Db> {
	const uri = process.env.MONGODB_URI;
	if (!uri) {
		throw new Error("MONGODB_URI não está configurada.");
	}
	const dbName = process.env.MONGODB_DB || "despesas";

	const clientPromise = (globalForMongo.__mongoClient ??= connect(uri));
	try {
		return (await clientPromise).db(dbName);
	} catch (err) {
		// Conexão falhou: a próxima requisição tenta de novo em vez de reaproveitar a falha.
		if (globalForMongo.__mongoClient === clientPromise) globalForMongo.__mongoClient = undefined;
		throw err;
	}
}
