// Banco de mentira só para os testes de `plans` (não é importado pelo app): igualdade, $set/$unset/$inc/$push, pontos nos nomes.
type Doc = Record<string, unknown>;
type Q = Record<string, unknown>;

function get(d: Doc, path: string): unknown {
	return path.split(".").reduce<unknown>((o, k) => (o as Doc | undefined)?.[k], d);
}

function matches(d: Doc, q: Q): boolean {
	return Object.entries(q).every(([k, v]) => {
		if (k === "$expr") return true; // limite de pessoas: não simulado
		if (k === "participants.uid") {
			const has = (d.participants as { uid: string }[]).some((p) => p.uid === (typeof v === "object" && v !== null ? undefined : v));
			if (typeof v === "object" && v !== null && "$ne" in v) return !(d.participants as { uid: string }[]).some((p) => p.uid === (v as { $ne: string }).$ne);
			return has;
		}
		if (typeof v === "object" && v !== null && !(v instanceof Date) && !("toHexString" in v)) {
			const op = v as { $ne?: unknown; $gt?: unknown; $in?: unknown[] };
			const val = get(d, k);
			if ("$ne" in op) return Array.isArray(val) ? !val.includes(op.$ne) : String(val) !== String(op.$ne);
			if ("$gt" in op) return (val as Date) > (op.$gt as Date);
			if ("$in" in op) return op.$in!.map(String).includes(String(val));
		}
		return String(get(d, k)) === String(v);
	});
}

function apply(d: Doc, u: { $set?: Doc; $unset?: Doc; $inc?: Doc; $push?: Doc }) {
	for (const [k, v] of Object.entries(u.$set ?? {})) {
		if (k.includes(".")) {
			const [a, b] = k.split(".");
			d[a] = { ...(d[a] as Doc), [b]: v };
		} else d[k] = v;
	}
	for (const k of Object.keys(u.$unset ?? {})) delete d[k];
	for (const [k, v] of Object.entries(u.$inc ?? {})) d[k] = ((d[k] as number) ?? 0) + (v as number);
	for (const [k, v] of Object.entries(u.$push ?? {})) d[k] = [...((d[k] as unknown[]) ?? []), v];
}

export function fakeDb() {
	const data: Record<string, Doc[]> = { plans: [], groups: [], expenses: [], users: [] };
	const col = (name: string) => ({
		findOne: async (q: Q) => data[name].find((d) => matches(d, q)) ?? null,
		find: (q: Q) => {
			const cursor = { sort: () => cursor, limit: () => cursor, toArray: async () => data[name].filter((d) => matches(d, q)) };
			return cursor;
		},
		insertOne: async (d: Doc) => void data[name].push(d),
		deleteOne: async (q: Q) => {
			const i = data[name].findIndex((d) => matches(d, q));
			if (i >= 0) data[name].splice(i, 1);
			return { deletedCount: i >= 0 ? 1 : 0 };
		},
		deleteMany: async (q: Q) => {
			const before = data[name].length;
			data[name] = data[name].filter((d) => !matches(d, q));
			return { deletedCount: before - data[name].length };
		},
		updateOne: async (q: Q, u: Parameters<typeof apply>[1]) => {
			const d = data[name].find((x) => matches(x, q));
			if (!d) return { matchedCount: 0 };
			apply(d, u);
			return { matchedCount: 1 };
		},
		findOneAndUpdate: async (q: Q, u: Parameters<typeof apply>[1]) => {
			const d = data[name].find((x) => matches(x, q));
			if (!d) return null;
			apply(d, u);
			return d;
		},
	});
	return { db: { collection: col } as never, data };
}
