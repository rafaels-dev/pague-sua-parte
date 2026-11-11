// Cria os índices do MongoDB. Uso: npm run db:indexes
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
	const groups = client.db(dbName).collection("groups");
	console.log("groups:", await groups.createIndex({ "members.uid": 1 }, { name: "members_uid" }));
	console.log(
		"groups:",
		await groups.createIndex(
			{ "invite.token": 1 },
			{ name: "invite_token_unique", unique: true, partialFilterExpression: { "invite.token": { $type: "string" } } },
		),
	);
	const expenses = client.db(dbName).collection("expenses");
	console.log("expenses:", await expenses.createIndex({ groupId: 1, date: -1, createdAt: -1 }, { name: "group_date_created" }));
	console.log("expenses:", await expenses.createIndex({ "shares.uid": 1 }, { name: "shares_uid" }));
	console.log("expenses:", await expenses.createIndex({ paidBy: 1 }, { name: "paid_by" }));
	console.log("expenses:", await expenses.createIndex({ groupId: 1, dueDate: 1 }, { name: "group_due_date" }));
	console.log(
		"expenses:",
		await expenses.createIndex(
			{ "installment.seriesId": 1, "installment.number": 1 },
			{ name: "installment_series" },
		),
	);
	console.log("expenses:", await expenses.createIndex({ "attachments.key": 1 }, { name: "attachment_key" }));
} catch (err) {
	console.error("Falha ao criar índices:", err instanceof Error ? err.name : "erro desconhecido");
	process.exitCode = 1;
} finally {
	await client.close();
}
