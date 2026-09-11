# Bahamas Café · Restaurant · Lounge — Bukoto, Kampala

Tailwind-powered single-page restaurant website + Node.js API backend, matching the original [BahamasCafe](https://iscorockie.github.io/BahamasCafe/) design system: sharp-cornered dark luxury (`#0A1512` greens) with gold `#C9A24B` / `#E3C579`, Sora.

## Sections (in order)

1. Fixed header — script logo, nav (Home · About · Menu · Reservation · Contact), social SVGs, circular cart button, mobile dropdown
2. Hero — left-aligned “Taste The Difference”, location overline, dual CTAs
3. About — overlapping photos, “Our Commitment”, lead + body copy
4. Signature Menu — tabs (Grill · Chicken · Quick Meals · Drinks), 29 dish cards with tags, “from” pricing, Add to Order
5. Reserve a Table — Name / Email / Mobile / Date / Time / Persons + gold “10+ Years of Flavor” badge
6. Experience banner — “Stay Close With Us”
7. Gallery — 4-column tall/wide mosaic
8. Footer — About / Location / Contact / Opening Hours
9. Cart drawer — quantities, total, details, WhatsApp checkout (API-first, WhatsApp fallback)

## Tech

- **Front-end:** Tailwind CSS v4 (`css/input.css` → compiled `css/output.css`) + vanilla JS (`js/app.js`)
- **Back-end:** Node.js ≥ 22.5 + Express + built-in `node:sqlite`
- Works fully on static hosting too: menu falls back to `data/menu.json` → embedded `js/menu-data.js`; orders/reservations fall back to WhatsApp deep links

## Quick start

```bash
npm install
npm start            # builds CSS + serves on http://localhost:3000
npm run dev          # same, with server auto-reload
npm run watch:css    # recompile Tailwind on change (run alongside)

# Admin dashboard: http://localhost:3000/admin.html (key: bahamas-admin-2026)
```

Environment: `PORT`, `ADMIN_KEY`, `DB_PATH`.

## API

| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/menu?category=grill` | Menu items (29 seeded) |
| POST | `/api/orders` | `{customer:{name,phone,address}, orderType, notes, items:[{id,qty}]}` |
| GET/PATCH | `/api/orders…?key=` | List / update status (admin) |
| POST | `/api/reservations` | `{name,email,mobile,date,time,persons}` |
| GET/PATCH | `/api/reservations…?key=` | List / update status (admin) |
| POST | `/api/contact`, `/api/newsletter` | Messages / subscriptions |
| GET | `/api/stats?key=` | Dashboard stats (admin) |

## Layout

```
index.html          page (Tailwind utilities + component classes)
admin.html          orders/reservations dashboard
css/input.css       Tailwind v4 theme + components (source)
css/output.css      compiled stylesheet (committed for static hosting)
js/app.js           filters, cart, checkout, reservations, reveal-on-scroll
js/menu-data.js     fallback menu (static hosting)
data/menu.json      seed menu (29 items)
server.js           Express API + static server + SQLite
```
