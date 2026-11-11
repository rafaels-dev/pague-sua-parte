import type { Db } from "mongodb";

/**
 * Retorna o Db do MongoDB Atlas (MONGODB_URI / MONGODB_DB, default "despesas").
 * Em Workers, reutilizar o client por isolate. TODO(db agent): implementar.
 */
export async function getDb(): Promise<Db> {
	throw new Error("not implemented");
}
