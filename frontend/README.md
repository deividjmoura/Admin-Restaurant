# Frontend — Admin Restaurant

React + Vite + Tailwind v4.

## Dev

```bash
# terminal 1 — API
cd .. && npm run dev

# terminal 2 — web
cd frontend
cp .env.example .env   # opcional
npm install
npm run dev
```

Abra http://localhost:5173

- Cliente: `/m/:token` (token da mesa no seed/admin)
- Staff: `/login` → cozinha, garçom, caixa, admin

Em produção, defina `VITE_API_URL` apontando para a API (Railway) e `CORS_ORIGIN` na API.
