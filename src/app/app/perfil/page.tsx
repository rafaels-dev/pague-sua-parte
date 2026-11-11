export const metadata = { title: "Meu perfil" };

const inputClass =
	"min-h-14 w-full rounded-xl border border-border bg-card px-4 text-lg outline-none focus:border-primary focus:ring-2 focus:ring-primary/40";

export default function PerfilPage() {
	// TODO: carregar/salvar perfil via API (nome e chave Pix); formulário ainda não está ligado.
	return (
		<div className="space-y-5">
			<h1 className="text-3xl font-bold">Meu perfil</h1>

			<form className="space-y-5">
				<label className="block space-y-2">
					<span className="text-base font-medium">Nome</span>
					<input name="name" type="text" autoComplete="name" className={inputClass} />
				</label>

				<label className="block space-y-2">
					<span className="text-base font-medium">Chave Pix</span>
					<input
						name="pixKey"
						type="text"
						autoComplete="off"
						placeholder="CPF, e-mail, telefone ou chave aleatória"
						className={inputClass}
					/>
					<span className="block text-sm text-muted">É para onde os outros vão pagar você.</span>
				</label>

				<button
					type="submit"
					className="min-h-14 w-full rounded-2xl bg-primary px-6 text-xl font-semibold text-primary-foreground active:opacity-80"
				>
					Salvar
				</button>
			</form>
		</div>
	);
}
