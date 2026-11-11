import { describe, expect, it } from "vitest";
import type { Db } from "mongodb";
import { memberGroupsOf } from "@/lib/expenses/repo";
import { groupIdParam } from "./group-scope";

describe("groupIdParam", () => {
	it("ausente = sem filtro; presente = o texto, mesmo vazio", () => {
		expect(groupIdParam(new Request("http://x/api/me/payables"))).toBeUndefined();
		expect(groupIdParam(new Request("http://x/api/me/payables?groupId=abc"))).toBe("abc");
		expect(groupIdParam(new Request("http://x/api/me/payables?groupId="))).toBe("");
	});
});

describe("memberGroupsOf", () => {
	it("id que não é um ObjectId: null sem consultar o banco", async () => {
		const db = new Proxy({}, { get: () => () => { throw new Error("não devia consultar"); } }) as unknown as Db;
		for (const bad of ["", "lixo", "../x", "0123456789abcdef0123456"]) expect(await memberGroupsOf(db, "u1", bad)).toBeNull();
	});
});
