"use client";

import { Banner, Button } from "@/components/ui";
import { cx } from "@/lib/ui/cx";

/** Quais parcelas a mudança atinge. */
export type InstallmentScope = "this" | "following";

/** Escolha de uma de duas opções, em linhas grandes (alvo de toque de 64px): bolinha, título e explicação. */
export function ScopePicker({
	value,
	onChange,
	number,
	count,
	disabled,
}: Readonly<{ value: InstallmentScope; onChange: (v: InstallmentScope) => void; number: number; count: number; disabled?: boolean }>) {
	const following = count - number + 1;
	const options: { value: InstallmentScope; title: string; detail: string }[] = [
		{ value: "this", title: "Só esta parcela", detail: `Parcela ${number} de ${count}` },
		{
			value: "following",
			title: "Esta e as próximas",
			detail: following === 2 ? `Parcelas ${number} e ${count}` : `Parcelas ${number} a ${count} (${following} parcelas)`,
		},
	];
	return (
		<div role="radiogroup" aria-label="Quais parcelas?" className="space-y-3">
			{options.map((o) => {
				const selected = o.value === value;
				return (
					<button
						key={o.value}
						type="button"
						role="radio"
						aria-checked={selected}
						disabled={disabled}
						onClick={() => onChange(o.value)}
						className={cx(
							"state-layer flex min-h-16 w-full items-center gap-4 rounded-shape-md border px-4 py-3 text-left",
							selected ? "border-primary bg-secondary-container text-on-secondary-container" : "border-outline text-on-surface",
						)}
					>
						<span
							aria-hidden="true"
							className={cx("flex size-6 shrink-0 items-center justify-center rounded-full border-2", selected ? "border-primary" : "border-on-surface-variant")}
						>
							{selected && <span className="size-3 rounded-full bg-primary" />}
						</span>
						<span className="min-w-0">
							<span className="block text-title-medium">{o.title}</span>
							<span className="block text-body-large opacity-80">{o.detail}</span>
						</span>
					</button>
				);
			})}
		</div>
	);
}

/** Sheet "Mudar quem divide" de uma parcela: primeiro pergunta quais parcelas. */
export function ResplitScopeContent({
	scope,
	number,
	count,
	onScope,
	onContinue,
	onCancel,
}: Readonly<{ scope: InstallmentScope; number: number; count: number; onScope: (s: InstallmentScope) => void; onContinue: () => void; onCancel: () => void }>) {
	return (
		<div className="space-y-5">
			<p className="text-body-large text-on-surface-variant">Esta despesa é uma parcela. Em quais parcelas você quer mudar quem divide?</p>
			<ScopePicker value={scope} onChange={onScope} number={number} count={count} />
			<div className="flex flex-col gap-3">
				<Button onClick={onContinue} fullWidth icon="group">
					Continuar
				</Button>
				<Button variant="outlined" onClick={onCancel} fullWidth>
					Cancelar
				</Button>
			</div>
		</div>
	);
}

/** Sheet de apagar uma parcela: escolhe quais e confirma, tudo numa tela só. */
export function DeleteInstallmentContent({
	scope,
	number,
	count,
	busy,
	error,
	onScope,
	onConfirm,
	onCancel,
}: Readonly<{
	scope: InstallmentScope;
	number: number;
	count: number;
	busy: boolean;
	error: string | null;
	onScope: (s: InstallmentScope) => void;
	onConfirm: () => void;
	onCancel: () => void;
}>) {
	return (
		<div className="space-y-5">
			<ScopePicker value={scope} onChange={onScope} number={number} count={count} disabled={busy} />
			<p className="text-body-large text-on-surface-variant">
				{scope === "following"
					? "Apaga também os anexos. As próximas parcelas que já têm pagamento não são apagadas. Não dá para desfazer."
					: "Apaga a parcela e os anexos para todo mundo do grupo. Não dá para desfazer."}
			</p>
			{error && (
				<Banner tone="error" icon="error" role="alert">
					{error}
				</Banner>
			)}
			<div className="flex flex-col gap-3">
				<Button onClick={onConfirm} loading={busy} fullWidth className="bg-error! text-on-error!">
					{busy ? "Apagando..." : scope === "following" ? "Apagar estas parcelas" : "Apagar esta parcela"}
				</Button>
				<Button variant="outlined" onClick={onCancel} disabled={busy} fullWidth>
					Cancelar
				</Button>
			</div>
		</div>
	);
}
