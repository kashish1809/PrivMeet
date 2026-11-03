# PrivMeet frontend

Vite + React (plain JSX) + Tailwind v4. No router library, no TypeScript, no UI kit.
The only icon library is `lucide-react`, and shared controls live in `src/ui/`
(owned by U1.1 — import them, do not edit them from other tasks).

## Run

```bash
npm install
npm run dev      # http://localhost:5173, proxies /api to Django on :8000
npm run build    # writes dist/ with base /static/, which Django + whitenoise serve
```

Start the backend first (`CELERY_EAGER=1 python manage.py runserver`, see the root
`AGENTS.md`). `src/api.js` needs the `csrftoken` cookie that `GET /api/system/`
sets, so the first write after a cold start is only safe once the app has loaded
once — it does that itself in `App.jsx`.

## Layout

| Path | What |
|---|---|
| `index.html`, `src/main.jsx` | entry; applies the saved theme before the first paint |
| `src/index.css` | Tailwind plus the `src/ui/theme.css` tokens |
| `src/api.js` | `api()` JSON helper, `upload()` XHR helper, endpoint wrappers |
| `src/format.js` | duration/date helpers and the "still processing" status list |
| `src/App.jsx` | hash router (`#/`, `#/meetings`, `#/new`, `#/m/<id>`) and temporary header |
| `src/pages/` | `MeetingList`, `NewMeeting`, `MeetingDetail` |
| `src/components/` | `SummaryPanel`, `ActionItemsPanel`, `QABox`, `MeetingInfo` (stubs until T3.4/U1.4) |

`base: "/static/"` applies to the production build only; the dev server stays on `/`
so `npm run dev` serves the app at the root.
