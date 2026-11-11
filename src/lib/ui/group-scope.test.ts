import { describe, expect, it } from "vitest";
import { groupParam, normalizeScopeGroup, payAllUrl, receivablesUrl, scopedApiUrl } from "./group-scope";

const ID = "0123456789abcdef01234567";

describe("group-scope", () => {
	it("groupParam só aceita um id de grupo válido", () => {
		expect(groupParam(`?grupo=${ID}`)).toBe(ID);
		expect(groupParam(`?x=1&grupo=${ID}`)).toBe(ID);
		for (const bad of ["", "?grupo=", "?grupo=abc", "?grupo=../x", `?grupo=${ID}0`, "?outro=1"]) expect(groupParam(bad)).toBeNull();
		expect(groupParam(null)).toBeNull();
		expect(groupParam(undefined)).toBeNull();
	});
	it("monta os endereços, com e sem grupo", () => {
		expect(payAllUrl()).toBe("/app/pagar");
		expect(payAllUrl(ID)).toBe(`/app/pagar?grupo=${ID}`);
		expect(receivablesUrl(null)).toBe("/app/receber");
		expect(receivablesUrl(ID)).toBe(`/app/receber?grupo=${ID}`);
		expect(scopedApiUrl("/api/me/payables", null)).toBe("/api/me/payables");
		expect(scopedApiUrl("/api/me/payables", ID)).toBe(`/api/me/payables?groupId=${ID}`);
	});
	it("normalizeScopeGroup tem padrões seguros", () => {
		expect(normalizeScopeGroup({ group: { id: ID, name: " Casa " } })).toEqual({ id: ID, name: "Casa" });
		expect(normalizeScopeGroup({ group: { id: ID } })).toEqual({ id: ID, name: "este grupo" });
		for (const bad of [null, {}, { group: null }, { group: { name: "x" } }, "x"]) expect(normalizeScopeGroup(bad)).toBeNull();
	});
});
