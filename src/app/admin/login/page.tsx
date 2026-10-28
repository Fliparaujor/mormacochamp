import { Header, Page, Title } from "@/components/brand";
import { ActionForm, SubmitButton } from "@/components/ui";
import { loginAction } from "@/app/actions/admin";

export const metadata = { title: "Admin", robots: { index: false } };

export default function Login() {
  return (
    <Page>
      <Header />
      <div className="mx-auto mt-10 max-w-sm">
        <Title before="Painel do" highlight="juiz" className="text-4xl" />
        <ActionForm action={loginAction} className="card mt-6 space-y-4 p-5">
          <label className="block">
            <span className="label">Senha</span>
            <input name="password" type="password" required className="input" autoComplete="current-password" autoFocus />
          </label>
          <SubmitButton className="btn btn-primary w-full" pendingText="Entrando...">
            Entrar
          </SubmitButton>
        </ActionForm>
      </div>
    </Page>
  );
}
