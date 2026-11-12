"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/auth/auth-provider";
import { AttachmentPicker } from "@/components/expenses/attachment-picker";
import { setFlash } from "@/components/expenses/types";
import { useAttachments } from "@/components/expenses/use-attachments";
import { Banner, Button, EmptyState, IconButton, MoneyField, Skeleton, TextField } from "@/components/ui";
import { apiFetch, ApiError } from "@/lib/api-client";
import { MAX_DETAILS } from "@/lib/plans/validation";
import type { PlanView } from "@/lib/plans/view";
import { cx } from "@/lib/ui/cx";

export type PlanFormValues = {
	name: string;
	totalCents: number;
	/** Texto digitado; vazio = não informar. */
	expectedPeople: string;
	eventDate: string;
	deadline: string;
	details: string;
};
export type PlanFormErrors = Partial<Record<"name" | "totalCents" | "expectedPeople" | "eventDate" | "deadline" | "details" | "files" | "form", string>>;

export const EMPTY_PLAN_VALUES: PlanFormValues = { name: "", totalCents: 0, expectedPeople: "", eventDate: "", deadline: "", details: "" };

export function valuesOf(plan: PlanView): PlanFormValues {
	return {
		name: plan.name,
		totalCents: plan.totalCents,
		expectedPeople: plan.expectedPeople ? String(plan.expectedPeople) : "",
		eventDate: plan.eventDate ?? "",
		deadline: plan.deadline ?? "",
		details: plan.details ?? "",
	};
}

/** O corpo que a API espera (campos vazios ficam de fora). */
export function bodyOf(v: PlanFormValues): Record<string, unknown> {
	const people = Number(v.expectedPeople.trim());
	return {
		name: v.name.trim(),
		totalCents: v.totalCents,
		...(v.eventDate ? { eventDate: v.eventDate } : {}),
		...(v.deadline ? { deadline: v.deadline } : {}),
		...(v.details.trim() ? { details: v.details } : {}),
		...(v.expectedPeople.trim() ? { expectedPeople: Number.isFinite(people) ? people : 0 } : {}),
	};
}

/** Confere os campos como o servidor (o servidor confere de novo). */
export function validatePlan(v: PlanFormValues): PlanFormErrors {
	const e: PlanFormErrors = {};
	if (!v.name.trim()) e.name = "Dê um nome ao plano.";
	else if (v.name.trim().length > 80) e.name = "Use até 80 letras.";
	if (v.totalCents <= 0) e.totalCents = "Digite quanto custa no total.";
	if (v.expectedPeople.trim()) {
		const n = Number(v.expectedPeople.trim());
		if (!Number.isInteger(n) || n < 2 || n > 200) e.expectedPeople = "Escreva um número de 2 a 200.";
	}
	if (v.details.length > MAX_DETAILS) e.details = `Use até ${MAX_DETAILS} letras.`;
	return e;
}

/** Visual do formulário de plano (criar e editar). As fotos entram como slots. */
export function PlanFormView(p: Readonly<{
	values: PlanFormValues;
	errors: PlanFormErrors;
	busy: boolean;
	submitLabel: string;
	onChange: (patch: Partial<PlanFormValues>) => void;
	onSubmit: () => void;
	photos: React.ReactNode;
	existingPhotos?: React.ReactNode;
	editing?: boolean;
}>) {
	const { values: v, errors } = p;
	return (
		<form
			noValidate
			onSubmit={(e) => {
				e.preventDefault();
				p.onSubmit();
			}}
			className="mx-auto max-w-xl space-y-6 max-md:pb-2"
		>
			<MoneyField id="campo-valor" label="Quanto custa no total?" cents={v.totalCents} onChange={(c) => p.onChange({ totalCents: c })} error={errors.totalCents} autoFocus={!p.editing} />
			<TextField
				id="campo-nome"
				label="O que vocês vão fazer?"
				value={v.name}
				maxLength={80}
				onChange={(e) => p.onChange({ name: e.target.value })}
				error={errors.name}
				autoComplete="off"
				supportingText={v.name ? undefined : "Por exemplo: Hotel da viagem de fim de ano"}
			/>
			<TextField
				id="campo-pessoas"
				label="Quantas pessoas você pensa em chamar?"
				floatLabel
				inputMode="numeric"
				value={v.expectedPeople}
				onChange={(e) => p.onChange({ expectedPeople: e.target.value.replace(/\D/g, "").slice(0, 3) })}
				error={errors.expectedPeople}
				autoComplete="off"
				supportingText={errors.expectedPeople ? undefined : "Opcional. Só o número, ajuda a ver quanto fica para cada um."}
			/>
			<TextField id="campo-quando" type="date" floatLabel label="Quando vai ser (opcional)" value={v.eventDate} onChange={(e) => p.onChange({ eventDate: e.target.value })} error={errors.eventDate} />
			<TextField
				id="campo-limite-resposta"
				type="date"
				floatLabel
				label="Responder até (opcional)"
				value={v.deadline}
				onChange={(e) => p.onChange({ deadline: e.target.value })}
				error={errors.deadline}
				supportingText={errors.deadline ? undefined : "Só avisa as pessoas até quando você espera a resposta."}
			/>

			<div>
				<label htmlFor="campo-detalhes" className="mb-1 block text-title-medium text-on-surface-variant">
					Detalhes (opcional)
				</label>
				<textarea
					id="campo-detalhes"
					rows={5}
					value={v.details}
					maxLength={MAX_DETAILS + 200}
					onChange={(e) => p.onChange({ details: e.target.value })}
					aria-invalid={errors.details ? true : undefined}
					aria-describedby="ajuda-detalhes"
					className={cx(
						"w-full resize-y rounded-shape-sm border bg-transparent p-4 text-body-large text-on-surface outline-none focus:border-primary",
						errors.details ? "border-error" : "border-outline",
					)}
				/>
				<p id="ajuda-detalhes" className={cx("px-1 pt-1 text-body-large", errors.details ? "text-error" : "text-on-surface-variant")} role={errors.details ? "alert" : undefined}>
					{errors.details ?? `Dia previsto, link do lugar, o que ficou combinado. ${v.details.length}/${MAX_DETAILS}`}
				</p>
			</div>

			{p.existingPhotos}
			{p.photos}

			{errors.form && (
				<Banner tone="error" icon="error" role="alert">
					{errors.form}
				</Banner>
			)}
			<Button type="submit" fullWidth loading={p.busy} icon={p.busy ? undefined : "check"}>
				{p.busy ? "Salvando..." : p.submitLabel}
			</Button>
		</form>
	);
}

const FIELDS: Record<string, keyof PlanFormErrors> = { name: "name", totalCents: "totalCents", expectedPeople: "expectedPeople", eventDate: "eventDate", deadline: "deadline", details: "details", files: "files" };

/** Fotos que o plano já tem, com o botão de tirar (cada uma é apagada na hora). */
function ExistingPhotos({ plan, busyId, onRemove }: Readonly<{ plan: PlanView; busyId: string | null; onRemove: (id: string) => void }>) {
	if (plan.attachments.length === 0) return null;
	return (
		<section className="space-y-2" aria-label="Fotos do plano">
			<h2 className="text-title-medium">Fotos que já estão no plano</h2>
			<ul className="space-y-2">
				{plan.attachments.map((a) => (
					<li key={a.id} className="flex items-center gap-3 rounded-shape-md bg-surface-container-low p-2 pl-4">
						<span className="min-w-0 flex-1 truncate text-body-large">{a.name}</span>
						<IconButton icon="delete" label={`Tirar a foto ${a.name}`} onClick={() => busyId === null && onRemove(a.id)} />
					</li>
				))}
			</ul>
		</section>
	);
}

const PHOTO_COPY = {
	title: "Fotos",
	optional: true,
	hint: "Foto do lugar, print do anúncio. Até 3 fotos, 4 MB no total.",
	pick: "Anexar foto",
	pickAgain: "Anexar foto",
	inputLabel: "Escolher fotos para o plano",
};

export function PlanForm({ planId }: Readonly<{ planId?: string }>) {
	const router = useRouter();
	const { user } = useAuth();
	const [plan, setPlan] = useState<PlanView | null>(null);
	const [loadError, setLoadError] = useState<string | null>(null);
	const [values, setValues] = useState<PlanFormValues>(EMPTY_PLAN_VALUES);
	const [errors, setErrors] = useState<PlanFormErrors>({});
	const [busy, setBusy] = useState(false);
	const [removingPhoto, setRemovingPhoto] = useState<string | null>(null);
	const left = plan ? 3 - plan.attachments.length : 3;
	const att = useAttachments({ enabled: !busy, maxFiles: Math.max(0, left), imagesOnly: true });

	useEffect(() => {
		if (!user || !planId) return;
		let cancelled = false;
		apiFetch<PlanView>(`/api/plans/${encodeURIComponent(planId)}`)
			.then((d) => {
				if (cancelled) return;
				setPlan(d);
				setValues(valuesOf(d));
			})
			.catch((e) => {
				if (!cancelled) setLoadError(e instanceof ApiError ? e.message : "Não foi possível carregar o plano.");
			});
		return () => {
			cancelled = true;
		};
	}, [user, planId]);

	if (loadError) {
		return (
			<EmptyState tone="error" icon="error" role="alert" title="Ops!" action={<Button href="/app">Voltar para o início</Button>}>
				{loadError}
			</EmptyState>
		);
	}
	if (planId && !plan) return <Skeleton className="mx-auto h-96 max-w-xl rounded-shape-lg" />;
	if (plan && !plan.canEdit) {
		return (
			<EmptyState tone="error" icon="error" role="alert" title="Você não pode editar" action={<Button href={`/app/planos/${encodeURIComponent(plan.id)}`}>Voltar para o plano</Button>}>
				Só quem criou o plano pode editar, e só enquanto ele está aberto.
			</EmptyState>
		);
	}

	function show(e: PlanFormErrors) {
		setErrors(e);
		const first = (["totalCents", "name", "expectedPeople", "eventDate", "deadline", "details"] as const).find((k) => e[k]);
		const ids = { totalCents: "campo-valor", name: "campo-nome", expectedPeople: "campo-pessoas", eventDate: "campo-quando", deadline: "campo-limite-resposta", details: "campo-detalhes" };
		if (first) setTimeout(() => document.getElementById(ids[first])?.focus(), 0);
	}

	async function removePhoto(aid: string) {
		if (!plan) return;
		setRemovingPhoto(aid);
		try {
			setPlan(await apiFetch<PlanView>(`/api/plans/${encodeURIComponent(plan.id)}/attachments/${encodeURIComponent(aid)}`, { method: "DELETE" }));
		} catch (err) {
			show({ form: err instanceof ApiError ? err.message : "Não foi possível tirar a foto." });
		}
		setRemovingPhoto(null);
	}

	async function submit() {
		if (busy) return;
		const bad = validatePlan(values);
		if (Object.keys(bad).length > 0) return show(bad);
		setErrors({});
		setBusy(true);
		try {
			if (plan) {
				await apiFetch<PlanView>(`/api/plans/${encodeURIComponent(plan.id)}`, { method: "PATCH", body: JSON.stringify(bodyOf(values)) });
				if (att.items.length > 0) {
					const form = new FormData();
					for (const it of att.items) form.append("files", it.file, it.file.name);
					await apiFetch<PlanView>(`/api/plans/${encodeURIComponent(plan.id)}/attachments`, { method: "POST", body: form });
				}
				setFlash("Plano salvo!");
				router.push(`/app/planos/${encodeURIComponent(plan.id)}`);
				return;
			}
			const form = new FormData();
			form.append("data", JSON.stringify(bodyOf(values)));
			for (const it of att.items) form.append("files", it.file, it.file.name);
			const created = await apiFetch<PlanView>("/api/plans", { method: "POST", body: form });
			setFlash("Plano criado! Agora chame as pessoas.");
			router.push(`/app/planos/${encodeURIComponent(created.id)}`);
		} catch (err) {
			setBusy(false);
			if (err instanceof ApiError) {
				const key = err.field ? FIELDS[err.field] : undefined;
				return show(key ? { [key]: err.message } : { form: err.message });
			}
			show({ form: "Não foi possível salvar. Tente de novo." });
		}
	}

	return (
		<PlanFormView
			values={values}
			errors={errors}
			busy={busy}
			editing={!!plan}
			submitLabel={plan ? "Salvar alterações" : "Criar plano"}
			onChange={(patch) => {
				setValues((v) => ({ ...v, ...patch }));
				const cleared = Object.keys(patch).filter((k) => errors[k as keyof PlanFormErrors]);
				if (cleared.length) setErrors((e) => ({ ...e, ...Object.fromEntries(cleared.map((k) => [k, undefined])) }));
			}}
			onSubmit={() => void submit()}
			existingPhotos={plan ? <ExistingPhotos plan={plan} busyId={removingPhoto} onRemove={(id) => void removePhoto(id)} /> : undefined}
			photos={
				left > 0 && (
					<AttachmentPicker
						items={att.items}
						problems={att.problems}
						serverError={errors.files}
						processing={att.processing}
						dragging={att.dragging}
						canPaste={att.canReadClipboard}
						disabled={busy}
						onPick={att.addFiles}
						onRemove={att.remove}
						onPaste={() => void att.pasteFromClipboard()}
						maxFiles={left}
						imagesOnly
						copy={{ ...PHOTO_COPY, hint: `Foto do lugar, print do anúncio. Até ${left} ${left === 1 ? "foto" : "fotos"}, 4 MB no total.` }}
					/>
				)
			}
		/>
	);
}
