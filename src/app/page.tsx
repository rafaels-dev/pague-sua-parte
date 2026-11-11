export default function Home() {
	return (
		<main className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center gap-8 px-5 py-10">
			<div className="space-y-3">
				<h1 className="text-4xl font-bold tracking-tight">Racha Pix</h1>
				<p className="text-xl text-muted">
					Registre os gastos da família, veja quanto cada um deve e pague por Pix com comprovante.
				</p>
			</div>

			{/* TODO(auth agent): ligar a signInWithGoogle() de src/lib/auth/client.ts e redirecionar para /app */}
			<button
				type="button"
				className="min-h-14 w-full rounded-2xl bg-primary px-6 text-xl font-semibold text-primary-foreground active:opacity-80"
			>
				Entrar com Google
			</button>

			<p className="text-center text-base text-muted">Usamos sua conta Google apenas para identificar você.</p>
		</main>
	);
}
