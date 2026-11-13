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
	console.log(
		"expenses:",
		await expenses.createIndex(
			{ "recurrence.id": 1, "recurrence.period": 1 },
			{ name: "recurrence_period_unique", unique: true, partialFilterExpression: { "recurrence.id": { $type: "string" } } },
		),
	);
	// Um comprovante pode ser referenciado por várias cotas (pagar tudo de uma vez): só se apaga o objeto sem referências.
	console.log("expenses:", await expenses.createIndex({ "shares.receipt.key": 1 }, { name: "share_receipt_key", sparse: true }));
	// O comprovante de uma devolução também pode estar em várias cotas (pagar tudo de uma vez): mesma consulta, outro campo.
	console.log("expenses:", await expenses.createIndex({ "shares.refund.receipt.key": 1 }, { name: "share_refund_receipt_key", sparse: true }));
	// O comprovante de um pagamento parcial (shares.parts[].receipt) também pode ser referenciado por várias cotas (lote): mesma consulta.
	console.log("expenses:", await expenses.createIndex({ "shares.parts.receipt.key": 1 }, { name: "share_parts_receipt_key", sparse: true }));
	const recurrences = client.db(dbName).collection("recurrences");
	console.log("recurrences:", await recurrences.createIndex({ groupId: 1, active: 1, nextPeriod: 1 }, { name: "group_active_next" }));
	// Despesas fixas: o lembrete de vencimento procura as ativas (e as encerradas há pouco, pelo calendário).
	console.log("recurrences:", await recurrences.createIndex({ active: 1, endedAt: 1 }, { name: "active_ended" }));
	// Lembretes de vencimento já enviados: um por despesa fixa, mês, antecedência e pessoa (nunca repete); apagados sozinhos em 120 dias.
	const reminderLog = client.db(dbName).collection("reminder_log");
	console.log("reminder_log:", await reminderLog.createIndex({ recurrenceId: 1, period: 1, lead: 1, uid: 1 }, { name: "reminder_unique", unique: true }));
	console.log("reminder_log:", await reminderLog.createIndex({ createdAt: 1 }, { name: "reminder_ttl", expireAfterSeconds: 120 * 24 * 60 * 60 }));
	// Avisos (push): um aparelho tem um só endereço; busca por usuário ao avisar.
	const pushSubs = client.db(dbName).collection("push_subscriptions");
	console.log("push_subscriptions:", await pushSubs.createIndex({ endpoint: 1 }, { name: "endpoint_unique", unique: true }));
	console.log("push_subscriptions:", await pushSubs.createIndex({ uid: 1, createdAt: -1 }, { name: "uid_created" }));
	// Caixa de avisos (sininho): lista e contagem por pessoa, do mais novo ao mais antigo; apagados sozinhos em 90 dias.
	const inbox = client.db(dbName).collection("inbox");
	console.log("inbox:", await inbox.createIndex({ uid: 1, createdAt: -1 }, { name: "inbox_uid_created" }));
	console.log("inbox:", await inbox.createIndex({ createdAt: 1 }, { name: "inbox_ttl", expireAfterSeconds: 90 * 24 * 60 * 60 }));
	// Planos (pré-grupo): por participante e estado, por criador, e o token do convite é único.
	const plans = client.db(dbName).collection("plans");
	console.log("plans:", await plans.createIndex({ "participants.uid": 1, status: 1, createdAt: -1 }, { name: "participant_status_created" }));
	console.log("plans:", await plans.createIndex({ createdBy: 1, createdAt: -1 }, { name: "created_by" }));
	console.log(
		"plans:",
		await plans.createIndex(
			{ "invite.token": 1 },
			{ name: "plan_invite_token_unique", unique: true, partialFilterExpression: { "invite.token": { $type: "string" } } },
		),
	);
	// Despesas que nasceram de um plano (para desfazer um fechamento interrompido).
	console.log("expenses:", await expenses.createIndex({ planId: 1 }, { name: "plan_id", sparse: true }));
} catch (err) {
	console.error("Falha ao criar índices:", err instanceof Error ? err.name : "erro desconhecido");
	process.exitCode = 1;
} finally {
	await client.close();
}
