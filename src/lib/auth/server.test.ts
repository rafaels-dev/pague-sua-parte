import { beforeAll, describe, expect, it } from "vitest";
import { SignJWT, generateKeyPair, type CryptoKey } from "jose";
import { UnauthorizedError, requireUser, verifyIdToken } from "./server";

const PROJECT = "meu-projeto";
let privateKey: CryptoKey;
let publicKey: CryptoKey;
let otherPrivate: CryptoKey;

beforeAll(async () => {
	({ privateKey, publicKey } = await generateKeyPair("RS256"));
	({ privateKey: otherPrivate } = await generateKeyPair("RS256"));
});

const now = () => Math.floor(Date.now() / 1000);

function sign(
	over: { claims?: Record<string, unknown>; iss?: string; aud?: string; sub?: string; exp?: number; key?: CryptoKey } = {},
) {
	return new SignJWT({ auth_time: now() - 10, email: "ana@example.com", name: "Ana", picture: "https://x/y.png", firebase: { sign_in_provider: "google.com" }, ...over.claims })
		.setProtectedHeader({ alg: "RS256", kid: "k1" })
		.setIssuer(over.iss ?? `https://securetoken.google.com/${PROJECT}`)
		.setAudience(over.aud ?? PROJECT)
		.setSubject(over.sub ?? "uid-123")
		.setIssuedAt(now() - 10)
		.setExpirationTime(over.exp ?? now() + 3600)
		.sign(over.key ?? privateKey);
}

const verify = (t: string) => verifyIdToken(t, { projectId: PROJECT, keySet: publicKey });

describe("verifyIdToken", () => {
	it("aceita token válido", async () => {
		expect(await verify(await sign())).toEqual({
			uid: "uid-123",
			email: "ana@example.com",
			name: "Ana",
			picture: "https://x/y.png",
		});
	});
	it("rejeita expirado", async () => {
		await expect(verify(await sign({ exp: now() - 100 }))).rejects.toBeInstanceOf(UnauthorizedError);
	});
	it("rejeita audience errada", async () => {
		await expect(verify(await sign({ aud: "outro" }))).rejects.toBeInstanceOf(UnauthorizedError);
	});
	it("rejeita issuer errado", async () => {
		await expect(verify(await sign({ iss: "https://securetoken.google.com/outro" }))).rejects.toBeInstanceOf(
			UnauthorizedError,
		);
	});
	it("rejeita assinatura de outra chave", async () => {
		await expect(verify(await sign({ key: otherPrivate }))).rejects.toBeInstanceOf(UnauthorizedError);
	});
	it("rejeita sub vazio", async () => {
		await expect(verify(await sign({ sub: "" }))).rejects.toBeInstanceOf(UnauthorizedError);
	});
	it("rejeita login que não é do Google", async () => {
		await expect(verify(await sign({ claims: { firebase: { sign_in_provider: "password" } } }))).rejects.toBeInstanceOf(UnauthorizedError);
		await expect(verify(await sign({ claims: { firebase: undefined } }))).rejects.toBeInstanceOf(UnauthorizedError);
	});
	it("rejeita auth_time ausente ou no futuro", async () => {
		await expect(verify(await sign({ claims: { auth_time: now() + 1000 } }))).rejects.toBeInstanceOf(UnauthorizedError);
		await expect(verify(await sign({ claims: { auth_time: undefined } }))).rejects.toBeInstanceOf(UnauthorizedError);
	});
	it("rejeita lixo", async () => {
		await expect(verify("lixo.lixo.lixo")).rejects.toBeInstanceOf(UnauthorizedError);
	});
});

describe("requireUser", () => {
	const req = (h?: string) => new Request("https://x.test/api", h ? { headers: { authorization: h } } : {});
	it("rejeita sem header", async () => {
		await expect(requireUser(req())).rejects.toBeInstanceOf(UnauthorizedError);
	});
	it("rejeita header fora do formato Bearer", async () => {
		await expect(requireUser(req("Basic abc"))).rejects.toBeInstanceOf(UnauthorizedError);
		await expect(requireUser(req("Bearer"))).rejects.toBeInstanceOf(UnauthorizedError);
		await expect(requireUser(req("Bearer a b"))).rejects.toBeInstanceOf(UnauthorizedError);
	});
});
