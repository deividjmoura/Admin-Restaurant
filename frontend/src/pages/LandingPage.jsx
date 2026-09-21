import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client';
import { BASE_DOMAIN } from '../context/entry-context';
import { Button, Card, ErrorBox } from '../components/Layout';

const input =
  'mt-1 w-full rounded-xl border border-stone-300 bg-white px-3 py-2';
export default function LandingPage() {
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState(null);
  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const form = event.currentTarget;
    const data = Object.fromEntries(new FormData(form));
    if (!data.message.trim()) delete data.message;
    try {
      await api('/api/leads', { method: 'POST', body: JSON.stringify(data) });
      setSent(true);
      form.reset();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="min-h-screen bg-stone-50 text-stone-900">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-6 py-6">
        <Link to="/" className="font-bold text-xl">
          Admin Restaurant<span className="text-amber-500">.</span>
        </Link>
        <Link to="/login" className="text-sm underline underline-offset-4">
          Já sou cliente
        </Link>
      </header>
      <main className="mx-auto max-w-6xl px-6">
        <section className="grid gap-12 py-16 md:grid-cols-2 md:py-24">
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-amber-700">
              Da mesa à cozinha
            </p>
            <h1 className="mt-5 text-5xl font-bold leading-tight tracking-tight">
              Sua lanchonete.
              <br />
              Uma operação mais simples.
            </h1>
            <p className="mt-6 max-w-lg text-lg leading-relaxed text-stone-600">
              Cardápio digital, pedidos e atendimento conectados. Mais clareza
              para sua equipe, mais tempo para cuidar de quem senta à mesa.
            </p>
            <a
              href="#contato"
              className="mt-8 inline-block rounded-xl bg-stone-900 px-6 py-3 font-medium text-white"
            >
              Conversar sobre minha loja →
            </a>
          </div>
          <div className="rounded-3xl bg-amber-100 p-8 md:p-10">
            <p className="text-sm font-semibold text-amber-900">
              Cada etapa no seu lugar
            </p>
            {[
              [
                '01',
                'Cliente pede pelo QR',
                'O cardápio da sua loja, direto na mesa.',
              ],
              [
                '02',
                'A equipe acompanha',
                'Cozinha e atendimento com pedidos organizados.',
              ],
              [
                '03',
                'Você tem visibilidade',
                'Administração e caixa no ambiente da sua loja.',
              ],
            ].map(([n, title, desc]) => (
              <div
                key={n}
                className="flex gap-5 border-b border-amber-200 py-6 last:border-0"
              >
                <span className="text-sm text-amber-700">{n}</span>
                <div>
                  <h2 className="font-semibold">{title}</h2>
                  <p className="mt-1 text-sm text-stone-600">{desc}</p>
                </div>
              </div>
            ))}
          </div>
        </section>
        <section
          id="contato"
          className="grid gap-10 border-t border-stone-200 py-16 md:grid-cols-2"
        >
          <div>
            <h2 className="text-3xl font-bold">Vamos conhecer sua operação?</h2>
            <p className="mt-4 max-w-sm text-stone-600">
              Conte um pouco sobre seu negócio. Entraremos em contato para
              apresentar a plataforma e conversar sobre a implantação.
            </p>
            <p className="mt-5 text-sm text-stone-500">
              Usaremos estes dados apenas para responder ao seu interesse
              comercial.
            </p>
          </div>
          <Card>
            <form onSubmit={submit} className="space-y-4">
              {[
                ['name', 'Seu nome', 'text', 120],
                ['email', 'E-mail de contato', 'email', 254],
                ['businessName', 'Nome da lanchonete', 'text', 120],
              ].map(([name, label, type, max]) => (
                <label key={name} className="block text-sm">
                  {label}
                  <input
                    className={input}
                    name={name}
                    type={type}
                    maxLength={max}
                    required
                  />
                </label>
              ))}
              <label className="block text-sm">
                Como podemos ajudar?{' '}
                <span className="text-stone-400">(opcional)</span>
                <textarea
                  className={input}
                  name="message"
                  maxLength={2000}
                  rows={3}
                />
              </label>
              <ErrorBox error={error} />
              {sent && (
                <p role="status" className="text-sm text-emerald-700">
                  Contato recebido. Obrigado pelo interesse!
                </p>
              )}
              <Button type="submit" disabled={busy}>
                {busy ? 'Enviando…' : 'Quero conhecer'}
              </Button>
            </form>
          </Card>
        </section>
      </main>
      <footer className="border-t border-stone-200 px-6 py-6 text-center text-sm text-stone-500">
        Admin Restaurant · Tecnologia para o seu atendimento
      </footer>
    </div>
  );
}

export function AccessPage() {
  const platformUrl = `${window.location.protocol}//app.${BASE_DOMAIN}${window.location.port ? `:${window.location.port}` : ''}/platform/login`;
  return (
    <main className="mx-auto max-w-xl space-y-6 px-6 py-16">
      <Link to="/" className="text-sm underline">
        ← Voltar
      </Link>
      <h1 className="text-3xl font-bold">Qual é o seu acesso?</h1>
      <Card>
        <h2 className="font-semibold">Já sou cliente</h2>
        <p className="mt-2 text-stone-600">
          Abra o endereço exclusivo da sua loja, informado na implantação, e
          acesse /login. Se você não lembra o endereço, fale com o responsável
          pela loja.
        </p>
      </Card>
      <Card>
        <h2 className="font-semibold">Administração da plataforma</h2>
        <p className="mt-2 mb-4 text-sm text-stone-600">
          Área exclusiva do proprietário do SaaS, separada das lojas.
        </p>
        <a href={platformUrl} className="underline">
          Entrar na plataforma →
        </a>
      </Card>
    </main>
  );
}
