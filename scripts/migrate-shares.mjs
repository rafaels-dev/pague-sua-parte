// Converte cotas antigas (status) para o modelo paidCents. Idempotente. Uso: npm run db:migrate-shares
//   status 'paid'  -> paidCents = amountCents
//   outro          -> paidCents = 0
// e remove `status`; despesas sem `version` passam a ter version 0.
import { MongoClient } from "mongodb";

const uri = process.env.MONGODB_URI;
if (!uri) {
	console.error("MONGODB_URI não definida.");
	process.exit(1);
}
const dbName = process.env.MONGODB_DB || "despesas";

const client = new MongoClient(uri, { serverSelectionTimeoutMS: 10_000 });
try {
	await client.connect();
	const expenses = client.db(dbName).collection("expenses");

	// Só toca documentos que ainda têm alguma cota com `status` ou sem `paidCents`.
	const pending = { $or: [{ "shares.status": { $exists: true } }, { shares: { $elemMatch: { paidCents: { $exists: false } } } }] };
	const total = await expenses.countDocuments({});
	const toConvert = await expenses.countDocuments(pending);

	const res = await expenses.updateMany(pending, [
		{
			$set: {
				shares: {
					$map: {
						input: "$shares",
						as: "s",
						in: {
							$let: {
								vars: { base: { $unsetField: { field: "status", input: "$$s" } } },
								in: {
									$cond: [
										{ $isNumber: "$$s.paidCents" },
										"$$base",
										{
											$mergeObjects: [
												"$$base",
												{ paidCents: { $cond: [{ $eq: ["$$s.status", "paid"] }, "$$s.amountCents", 0] } },
											],
										},
									],
								},
							},
						},
					},
				},
			},
		},
	]);
	const versioned = await expenses.updateMany({ version: { $exists: false } }, { $set: { version: 0 } });
	const left = await expenses.countDocuments(pending);

	console.log(`despesas: ${total}`);
	console.log(`com cotas no modelo antigo: ${toConvert}`);
	console.log(`convertidas: ${res.modifiedCount}`);
	console.log(`version=0 atribuída: ${versioned.modifiedCount}`);
	console.log(`restantes no modelo antigo: ${left}`);
	if (left > 0) process.exitCode = 1;
} catch (err) {
	console.error("Falha na migração:", err instanceof Error ? err.name : "erro desconhecido");
	process.exitCode = 1;
} finally {
	await client.close();
}
