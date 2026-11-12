"use client";

import { useCallback, useEffect, useState } from "react";
import { Button, Card, Skeleton } from "@/components/ui";
import { apiFetch, ApiError } from "@/lib/api-client";
import {
	disablePush,
	enablePush,
	isSubscribed,
	pushSupport,
	type PushSupport,
} from "@/lib/push-client";

export type NotifyCardViewProps = {
	/** O servidor está configurado para mandar e-mail / push; sem isso a parte some do cartão. */
	emailAvailable: boolean;
	pushAvailable: boolean;
	emailOn: boolean;
	/** O e-mail da conta foi confirmado pelo Google; sem isso não dá para avisar por e-mail. */
	canEmail: boolean;
	support: PushSupport;
	pushOn: boolean;
	busy: boolean;
	error: string | null;
	onEmail: (on: boolean) => void;
	onEnablePush: () => void;
	onDisablePush: () => void;
};

/** Cartão "Avisos" do perfil (visual): e-mail ligado/desligado e avisos neste celular. */
export function NotifyCardView(p: Readonly<NotifyCardViewProps>) {
	return (
		<Card className="p-5 md:p-8 lg:col-start-2">
			<div className="space-y-6 md:max-w-xl">
				<div>
					<h2 className="text-title-large">Avisos</h2>
					<p className="text-body-large text-on-surface-variant">
						{p.emailAvailable || p.pushAvailable
							? `Saiba quando alguém entrar no grupo, pagar ou lançar uma despesa${p.emailAvailable && p.pushAvailable ? ", por e-mail e no celular" : p.emailAvailable ? ", por e-mail" : ", no celular"}.`
							: "Os avisos ainda não estão disponíveis."}
					</p>
				</div>

				{p.emailAvailable && (
					<div className="flex items-center justify-between gap-4">
						<div className="min-w-0">
							<p id="notify-email-label" className="text-body-large">
								Receber por e-mail
							</p>
							{!p.canEmail && (
								<p className="text-body-medium text-on-surface-variant">
									Não foi possível confirmar o e-mail desta conta.
								</p>
							)}
						</div>
						<button
							type="button"
							role="switch"
							aria-checked={p.emailOn}
							aria-labelledby="notify-email-label"
							disabled={!p.canEmail || p.busy}
							onClick={() => p.onEmail(!p.emailOn)}
							className={`relative h-8 w-14 shrink-0 rounded-full transition-colors disabled:opacity-40 ${p.emailOn ? "bg-primary" : "bg-outline"}`}
						>
							<span
								className={`absolute top-1 size-6 rounded-full bg-surface transition-[left] ${p.emailOn ? "left-7" : "left-1"}`}
							/>
						</button>
					</div>
				)}

				{p.pushAvailable && (
					<div className="space-y-3">
						{p.support === "ready" &&
							(p.pushOn ? (
								<>
									<p className="text-body-large">
										Os avisos estão ligados neste celular.
									</p>
									<Button
										variant="outlined"
										loading={p.busy}
										onClick={p.onDisablePush}
										fullWidth
										className="md:w-auto"
									>
										Desativar neste celular
									</Button>
								</>
							) : (
								<Button
									variant="tonal"
									loading={p.busy}
									onClick={p.onEnablePush}
									fullWidth
									className="md:w-auto"
								>
									Ativar avisos neste celular
								</Button>
							))}
						{p.support === "ios-install" && (
							<p className="text-body-large text-on-surface-variant">
								No iPhone, toque em Compartilhar e em &quot;Adicionar à Tela de
								Início&quot; para receber avisos.
							</p>
						)}
						{p.support === "denied" && (
							<p className="text-body-large text-on-surface-variant">
								Os avisos estão bloqueados neste celular. Para liberar, abra as
								configurações do navegador, procure este site e permita as
								notificações.
							</p>
						)}
						{p.support === "unsupported" && (
							<p className="text-body-large text-on-surface-variant">
								Este celular ainda não recebe avisos pelo navegador.{p.emailAvailable ? " Você continua recebendo por e-mail." : ""}
							</p>
						)}
					</div>
				)}
				{p.error && (
					<p role="alert" className="text-body-large text-error">
						{p.error}
					</p>
				)}
			</div>
		</Card>
	);
}

type Prefs = {
	email: boolean;
	push: boolean;
	canEmail: boolean;
	channels: { email: boolean; push: boolean };
};

export function NotifyCardSkeleton() {
	return <Skeleton className="h-64 rounded-shape-lg lg:col-start-2" />;
}

/** Cartão "Avisos" ligado à API e ao navegador. */
export function NotifyCard() {
	const [prefs, setPrefs] = useState<Prefs | null>(null);
	const [support, setSupport] = useState<PushSupport>("unsupported");
	const [pushOn, setPushOn] = useState(false);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const refreshPush = useCallback(async () => {
		const s = pushSupport();
		setSupport(s);
		setPushOn(s === "ready" ? await isSubscribed() : false);
	}, []);

	useEffect(() => {
		let cancelled = false;
		apiFetch<Prefs>("/api/me/notifications")
			.then((p) => !cancelled && setPrefs(p))
			.catch(
				() => !cancelled && setError("Não foi possível carregar seus avisos."),
			);
		void (async () => {
			const s = pushSupport();
			const on = s === "ready" ? await isSubscribed() : false;
			if (cancelled) return;
			setSupport(s);
			setPushOn(on);
		})();
		return () => {
			cancelled = true;
		};
	}, []);

	async function run(work: () => Promise<void>) {
		setBusy(true);
		setError(null);
		try {
			await work();
		} catch (e) {
			setError(
				e instanceof ApiError || e instanceof Error
					? e.message
					: "Algo deu errado. Tente de novo.",
			);
		} finally {
			setBusy(false);
			void refreshPush();
		}
	}

	if (!prefs)
		return error ? (
			<p role="alert" className="text-body-large text-error lg:col-start-2">
				{error}
			</p>
		) : (
			<NotifyCardSkeleton />
		);
	return (
		<NotifyCardView
			emailAvailable={prefs.channels.email}
			pushAvailable={prefs.channels.push}
			emailOn={prefs.email}
			canEmail={prefs.canEmail}
			support={support}
			pushOn={pushOn}
			busy={busy}
			error={error}
			onEmail={(on) =>
				void run(async () =>
					setPrefs(
						await apiFetch<Prefs>("/api/me/notifications", {
							method: "PATCH",
							body: JSON.stringify({ email: on }),
						}),
					),
				)
			}
			onEnablePush={() => void run(enablePush)}
			onDisablePush={() => void run(disablePush)}
		/>
	);
}
