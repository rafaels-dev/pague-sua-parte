import { z } from "zod";
import { requireUser, UnauthorizedError } from "@/lib/auth/server";
import { getDb } from "@/lib/db/client";
import { normalizePixKey } from "@/lib/pix/key";
import { updateProfile, upsertFromAuth, type UserDoc } from "@/lib/users/repo";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
	displayName: z.string().trim().min(1, "Digite um nome (até 60 letras).").max(60, "O nome pode ter no máximo 60 letras.").optional(),
	pixKey: z.string().max(200, "Chave Pix inválida.").optional(),
});

const PIX_ERROR =
	"Chave Pix inválida. Confira se é um CPF, CNPJ, e-mail, celular com DDD ou chave aleatória válidos.";

function toProfile(u: UserDoc) {
	return {
		uid: u._id,
		email: u.email,
		name: u.name,
		picture: u.picture ?? null,
		displayName: u.displayName ?? null,
		pixKey: u.pixKey ?? null,
	};
}

function error(message: string, status: number, field?: string) {
	return Response.json({ error: message, ...(field ? { field } : {}) }, { status });
}

function handleError(err: unknown) {
	if (err instanceof UnauthorizedError) return error("Sessão expirada. Entre novamente.", 401);
	console.error("api/me error:", err instanceof Error ? err.name : "unknown");
	return error("Algo deu errado. Tente novamente em instantes.", 500);
}

export async function GET(request: Request) {
	try {
		const user = await requireUser(request);
		const doc = await upsertFromAuth(await getDb(), user);
		return Response.json(toProfile(doc));
	} catch (err) {
		return handleError(err);
	}
}

export async function PUT(request: Request) {
	try {
		const user = await requireUser(request);

		let json: unknown;
		try {
			json = await request.json();
		} catch {
			return error("Pedido inválido.", 400);
		}
		const parsed = bodySchema.safeParse(json);
		if (!parsed.success) {
			const issue = parsed.error.issues[0];
			return error(issue?.message ?? "Dados inválidos.", 422, String(issue?.path[0] ?? ""));
		}

		const patch: Parameters<typeof updateProfile>[2] = {};
		if (parsed.data.displayName !== undefined) patch.displayName = parsed.data.displayName;
		if (parsed.data.pixKey !== undefined) {
			if (parsed.data.pixKey.trim() === "") patch.pixKey = null;
			else {
				const pix = normalizePixKey(parsed.data.pixKey);
				if (!pix) return error(PIX_ERROR, 422, "pixKey");
				patch.pixKey = pix;
			}
		}

		const db = await getDb();
		const current = await upsertFromAuth(db, user);
		const updated = (await updateProfile(db, user.uid, patch)) ?? current;
		return Response.json(toProfile(updated));
	} catch (err) {
		return handleError(err);
	}
}
