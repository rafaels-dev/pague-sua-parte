import { readFileSync } from "node:fs";
import type { Db } from "mongodb";
import { describe, expect, it, vi } from "vitest";
import { canViewReceipt, type MemberLike } from "@/lib/groups/helpers";
import type { AttachmentStore } from "@/lib/storage/attachments";
import { receiptDigest } from "./facts";
import { pushPayload } from "./push";
import { readStoredFile, resolveReceiptAttachment, safeAttachmentName, type FileCache, type ReceiptDeps } from "./receipt-attachment";
import type { Notice, ReceiptTarget } from "./types";

const PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 1, 2, 3]);
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 9]);
const stream = (b: Uint8Array) => new ReadableStream<Uint8Array>({ start: (c) => (c.enqueue(b), c.close()) });
const storeWith = (files: Record<string, Uint8Array | null>, size?: number): (() => AttachmentStore) => () => ({
	put: async () => {},
	delete: async () => {},
	get: async (k) => (files[k] ? { body: stream(files[k]!), size: size ?? files[k]!.byteLength } : null),
});

// Grupo: adm (administrador), ana (quem pagou), bia (devedora), cid (membro comum), m_vo (pessoa cuidada por bia).
const members: MemberLike[] = [
	{ uid: "adm", role: "admin" },
	{ uid: "ana", role: "member" },
	{ uid: "bia", role: "member" },
	{ uid: "cid", role: "member" },
	{ uid: "m_vo", role: "member", kind: "managed", managedBy: "bia" },
];
const target = (o: Partial<ReceiptTarget> = {}): ReceiptTarget => ({ groupId: "g", expenseId: "e", targetUid: "bia", kind: "payment", ...o });
/** Mesma regra de `getReceiptRef` (a rota de download): membro do grupo + `canViewReceipt`. */
const getRef: NonNullable<ReceiptDeps["getRef"]> = async (_db, t, viewer) =>
	canViewReceipt(members, viewer, t.targetUid, "ana") ? { status: "ok", key: `receipts/g/e/${t.partId ?? "top"}`, name: "Comprovante João.pdf", contentType: "application/pdf" } : { status: "not_found" };
const db = {} as Db;
const notice = (uid: string, receipts: ReceiptTarget[] = [target()]): Pick<Notice, "uid" | "receipts"> => ({ uid, receipts });
const store = storeWith({ "receipts/g/e/top": PDF });

describe("canViewReceipt (a regra das rotas de download)", () => {
	it("a própria pessoa, quem age por ela, quem pagou e o administrador veem; membro comum e estranho não", () => {
		const v = (viewer: string, target = "bia") => canViewReceipt(members, viewer, target, "ana");
		expect(v("bia")).toBe(true);
		expect(v("ana")).toBe(true);
		expect(v("adm")).toBe(true);
		expect(v("bia", "m_vo")).toBe(true); // quem cuida da pessoa da cota
		expect(v("cid")).toBe(false);
		expect(v("zzz")).toBe(false);
		expect(canViewReceipt(members, "cid", "bia", "m_vo")).toBe(false);
		expect(canViewReceipt(members, "bia", "cid", "m_vo")).toBe(true); // bia cuida de quem pagou
	});
	it("getReceiptRef usa exatamente esta função", () => {
		const src = readFileSync(new URL("../expenses/repo.ts", import.meta.url), "utf8");
		const body = src.slice(src.indexOf("export async function getReceiptRef"), src.indexOf("// ---------- apagar"));
		expect(body).toContain("canViewReceipt(group.members, uid, targetUid, e.paidBy)");
	});
});

describe("anexo do comprovante: autorização por papel", () => {
	for (const [who, uid] of [["a própria pessoa", "bia"], ["quem pagou a despesa", "ana"], ["o administrador", "adm"]] as const) {
		it(`${who} recebe o arquivo`, async () => {
			const r = await resolveReceiptAttachment(db, notice(uid), { getRef, store });
			expect(r.line).toBe("attached");
			if (r.line === "attached") {
				expect(r.attachment.contentType).toBe("application/pdf");
				expect(r.attachment.filename).toBe("Comprovante_Joao.pdf");
				expect(Array.from(r.attachment.bytes)).toEqual(Array.from(PDF));
			}
		});
	}
	it("quem cuida da pessoa da cota recebe", async () => {
		expect((await resolveReceiptAttachment(db, notice("bia", [target({ targetUid: "m_vo" })]), { getRef, store })).line).toBe("attached");
	});
	it("membro comum que recebeu algum aviso NÃO recebe anexo, nem a linha sobre o comprovante, e o arquivo nem é lido", async () => {
		const get = vi.fn();
		const r = await resolveReceiptAttachment(db, notice("cid"), { getRef, store: () => ({ put: async () => {}, delete: async () => {}, get }) });
		expect(r).toEqual({ line: "none" });
		expect(get).not.toHaveBeenCalled();
	});
	it("aviso sem referência: nada", async () => {
		expect(await resolveReceiptAttachment(db, { uid: "bia" }, { getRef, store })).toEqual({ line: "none" });
	});
});

describe("anexo do comprovante: falhas e limites (o e-mail sai igual, sem arquivo)", () => {
	it("arquivo sumiu do armazenamento: 'app'", async () => {
		expect(await resolveReceiptAttachment(db, notice("bia"), { getRef, store: storeWith({ "receipts/g/e/top": null }) })).toEqual({ line: "app" });
	});
	it("leitura que lança: 'app', e o log não traz nada do arquivo", async () => {
		const log = vi.spyOn(console, "error").mockImplementation(() => {});
		const bad: () => AttachmentStore = () => ({ put: async () => {}, delete: async () => {}, get: async () => Promise.reject(new Error("falha com receipts/g/e/top")) });
		expect(await resolveReceiptAttachment(db, notice("bia"), { getRef, store: bad })).toEqual({ line: "app" });
		log.mockRestore();
	});
	it("falha ao conferir a permissão: nada (não diz 'veja no app' a quem talvez não possa ver)", async () => {
		const r = await resolveReceiptAttachment(db, notice("bia"), { getRef: async () => Promise.reject(new Error("db")), store });
		expect(r).toEqual({ line: "none" });
	});
	it("acima de 4 MB (declarado ou real): 'app'", async () => {
		expect(await resolveReceiptAttachment(db, notice("bia"), { getRef, store: storeWith({ "receipts/g/e/top": PDF }, 4 * 1024 * 1024 + 1) })).toEqual({ line: "app" });
		const big = new Uint8Array(4 * 1024 * 1024 + 10);
		big.set(PDF);
		expect(await resolveReceiptAttachment(db, notice("bia"), { getRef, store: storeWith({ "receipts/g/e/top": big }, 10) })).toEqual({ line: "app" });
	});
	it("tipo desconhecido pelos bytes: 'app' (nunca anexa o que não reconhece)", async () => {
		expect(await resolveReceiptAttachment(db, notice("bia"), { getRef, store: storeWith({ "receipts/g/e/top": new Uint8Array([1, 2, 3, 4]) }) })).toEqual({ line: "app" });
	});
	it("pouco tempo sobrando no orçamento: nem lê o arquivo", async () => {
		const get = vi.fn();
		const r = await resolveReceiptAttachment(db, notice("bia"), { getRef, store: () => ({ put: async () => {}, delete: async () => {}, get }), deadline: Date.now() + 1000 });
		expect(r).toEqual({ line: "app" });
		expect(get).not.toHaveBeenCalled();
	});
	it("a extensão e o tipo são os do arquivo real, não os do nome", async () => {
		const r = await resolveReceiptAttachment(db, notice("bia"), { getRef, store: storeWith({ "receipts/g/e/top": PNG }) });
		expect(r.line === "attached" && r.attachment.contentType).toBe("image/png");
		expect(r.line === "attached" && r.attachment.filename).toBe("Comprovante_Joao.png");
	});
});

const resolveReceiptAngle = (many: ReceiptTarget[], get: AttachmentStore["get"]) =>
	resolveReceiptAttachment(db, notice("ana", many), { getRef: async () => ({ status: "ok", key: "k", name: "x.pdf", contentType: "application/pdf" }), store: () => ({ put: async () => {}, delete: async () => {}, get }) });

describe("lote ('Pagar tudo'): um só arquivo anexa uma vez", () => {
	const batch = [target({ expenseId: "e1" }), target({ expenseId: "e2" }), target({ expenseId: "e3" })];
	const sameKey: ReceiptDeps["getRef"] = async () => ({ status: "ok", key: "receipts/batch/b/r", name: "lote.pdf", contentType: "application/pdf" });
	it("mesma chave em várias partes: lê e anexa uma vez", async () => {
		const get = vi.fn(async () => ({ body: stream(PDF), size: PDF.byteLength }));
		const r = await resolveReceiptAttachment(db, notice("ana", batch), { getRef: sameKey, store: () => ({ put: async () => {}, delete: async () => {}, get }) });
		expect(r.line).toBe("attached");
		expect(get).toHaveBeenCalledTimes(1);
	});
	it("arquivos diferentes: não escolhe um; 'Veja os comprovantes no app'", async () => {
		let n = 0;
		const r = await resolveReceiptAttachment(db, notice("ana", batch), { getRef: async () => ({ status: "ok", key: `k${n++}`, name: "x.pdf", contentType: "application/pdf" }), store });
		expect(r).toEqual({ line: "app_many" });
	});
	it("nem todos os pagamentos têm comprovante (receiptsOf maior): não afirma 'em anexo' para o lote inteiro", async () => {
		const r = await resolveReceiptAttachment(db, { uid: "ana", receipts: batch.slice(0, 2), receiptsOf: 3 }, { getRef: sameKey, store });
		expect(r).toEqual({ line: "app_many" });
	});
	it("mais referências que o máximo: 'app_many', sem ler o arquivo", async () => {
		const get = vi.fn<AttachmentStore["get"]>();
		const many = Array.from({ length: 9 }, (_, i) => target({ expenseId: `e${i}` }));
		const r = await resolveReceiptAngle(many, get);
		expect(r).toEqual({ line: "app_many" });
		expect(get).not.toHaveBeenCalled();
	});
	it("um aviso de um pagamento só diz 'o comprovante' (singular)", async () => {
		expect((await resolveReceiptAttachment(db, notice("bia"), { getRef, store: storeWith({ "receipts/g/e/top": null }) })).line).toBe("app");
	});
});

describe("nome do arquivo", () => {
	it("só ASCII seguro, sem caminho nem quebra de linha, extensão do tipo real", () => {
		expect(safeAttachmentName('../../etc/pass"wd\r\nX: y.exe', "application/pdf")).toBe("pass_wd_X_y.pdf");
		expect(safeAttachmentName("C:\\Users\\Ana\\recibo ação.JPG", "image/jpeg")).toBe("recibo_acao.jpg");
		expect(safeAttachmentName("....", "image/png")).toBe("comprovante.png");
		expect(safeAttachmentName(undefined, "image/webp")).toBe("comprovante.webp");
		expect(safeAttachmentName("a".repeat(300), "application/pdf").length).toBeLessThanOrEqual(64);
		for (const raw of ["x\u0000y.pdf", "a\u202eb.pdf", "😀.pdf", "a b.pdf"]) expect(safeAttachmentName(raw, "application/pdf")).toMatch(/^[A-Za-z0-9._-]+\.pdf$/);
	});
});

describe("a referência interna nunca vaza", () => {
	const n: Notice = { uid: "bia", title: "Pagamento recebido", body: "Ana pagou.", url: "/app/x", receipts: [target()] };
	it("o push não leva a referência", () => {
		const p = pushPayload(n);
		expect(p).not.toMatch(/receipts|targetUid|groupId/);
		expect(Object.keys(JSON.parse(p)).sort()).toEqual(["body", "title", "url"]);
	});
});

describe("comprovante trocado entre o fato e o envio", () => {
	it("mesmo resumo: anexa; resumo diferente (arquivo trocado, outro pagamento, desfazer): só 'Veja o comprovante no app', sem ler", async () => {
		const get = vi.fn(async () => ({ body: stream(PDF), size: PDF.byteLength }));
		const st = () => ({ put: async () => {}, delete: async () => {}, get });
		const ref: ReceiptDeps["getRef"] = async () => ({ status: "ok", key: "receipts/g/e/ATUAL", name: "a.pdf", contentType: "application/pdf" });
		const same = await resolveReceiptAttachment(db, notice("bia", [target({ digest: receiptDigest("receipts/g/e/ATUAL") })]), { getRef: ref, store: st });
		expect(same.line).toBe("attached");
		get.mockClear();
		const changed = await resolveReceiptAttachment(db, notice("bia", [target({ digest: receiptDigest("receipts/g/e/ANTIGO") })]), { getRef: ref, store: st });
		expect(changed).toEqual({ line: "app" });
		expect(get).not.toHaveBeenCalled();
	});
	it("quem não pode ver continua sem nada, mesmo com resumo", async () => {
		expect(await resolveReceiptAttachment(db, notice("cid", [target({ digest: receiptDigest("receipts/g/e/top") })]), { getRef, store })).toEqual({ line: "none" });
	});
	it("o resumo nunca sai no push", () => {
		const n: Notice = { uid: "bia", title: "t", body: "b", url: "/u", receipts: [target({ digest: receiptDigest("k") })] };
		expect(pushPayload(n)).not.toContain(receiptDigest("k"));
	});
});

describe("um arquivo, lido uma vez, vários destinatários", () => {
	it("o cache guarda só os bytes; a permissão é conferida para cada destinatário antes de usar", async () => {
		const get = vi.fn(async () => ({ body: stream(PDF), size: PDF.byteLength }));
		const cache: FileCache = new Map();
		const deps = (): ReceiptDeps => ({ getRef, store: () => ({ put: async () => {}, delete: async () => {}, get }), cache });
		const a = await resolveReceiptAttachment(db, notice("bia"), deps());
		const b = await resolveReceiptAttachment(db, notice("adm"), deps());
		const c = await resolveReceiptAttachment(db, notice("cid"), deps()); // membro comum: o cache existe, mas ele não pode
		expect([a.line, b.line, c.line]).toEqual(["attached", "attached", "none"]);
		expect(get).toHaveBeenCalledTimes(1);
	});
	it("todos os destinatários de um lote recebem o anexo mesmo sendo o 5º e-mail (cada um com o próprio orçamento)", async () => {
		const get = vi.fn(async () => ({ body: stream(PDF), size: PDF.byteLength }));
		const cache: FileCache = new Map();
		const deadline = Date.now() + 20_000;
		const lines: string[] = [];
		for (let i = 0; i < 5; i++) lines.push((await resolveReceiptAttachment(db, notice("bia"), { getRef, store: () => ({ put: async () => {}, delete: async () => {}, get }), cache, deadline })).line);
		expect(lines).toEqual(Array(5).fill("attached"));
		expect(get).toHaveBeenCalledTimes(1);
	});
});

describe("leitura que estoura o tempo é cancelada de verdade", () => {
	it("o fluxo é abortado (cancel chamado) e nada é anexado", async () => {
		const cancel = vi.fn();
		let sent = false;
		const slow = new ReadableStream<Uint8Array>({
			pull(c) {
				if (!sent) {
					sent = true;
					c.enqueue(PDF);
				}
				return new Promise(() => {}); // nunca termina
			},
			cancel,
		});
		const st: AttachmentStore = { put: async () => {}, delete: async () => {}, get: async () => ({ body: slow, size: 1000 }) };
		const r = await readStoredFile(st, "k", 30);
		expect(r).toEqual({ ok: false });
		await new Promise((res) => setTimeout(res, 20));
		expect(cancel).toHaveBeenCalled();
	});
	it("arquivo que só chega depois do prazo também é descartado (stream cancelado)", async () => {
		const cancel = vi.fn();
		const body = new ReadableStream<Uint8Array>({ start: (c) => c.enqueue(PDF), cancel });
		const st: AttachmentStore = { put: async () => {}, delete: async () => {}, get: () => new Promise((res) => setTimeout(() => res({ body, size: 5 }), 60)) };
		expect(await readStoredFile(st, "k", 20)).toEqual({ ok: false });
		await new Promise((res) => setTimeout(res, 100));
		expect(cancel).toHaveBeenCalled();
	});
	it("sobrando pouco do prazo (< 5 s), nem lê; sobrando bastante, lê", async () => {
		const get = vi.fn(async () => ({ body: stream(PDF), size: PDF.byteLength }));
		const st = () => ({ put: async () => {}, delete: async () => {}, get });
		expect((await resolveReceiptAttachment(db, notice("bia"), { getRef, store: st, deadline: Date.now() + 4_000 })).line).toBe("app");
		expect(get).not.toHaveBeenCalled();
		expect((await resolveReceiptAttachment(db, notice("bia"), { getRef, store: st, deadline: Date.now() + 9_000 })).line).toBe("attached");
	});
});
