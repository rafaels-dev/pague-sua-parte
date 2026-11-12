export type NotifyPrefs = { email: boolean; push: boolean };

/** Preferências do documento do usuário; o que falta vale "ligado". */
export function normalizeNotifyPrefs(raw: { email?: unknown; push?: unknown } | null | undefined): NotifyPrefs {
	return { email: raw?.email !== false, push: raw?.push !== false };
}
