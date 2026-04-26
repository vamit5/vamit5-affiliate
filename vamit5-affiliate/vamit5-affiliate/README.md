# VAMIT-5 Athlete Affiliate Program

Custom-built affiliate platforma sa gejmifikacijom, auto IG verifikacijom i auto isplatama.

```
Stack:    HTML/JS frontend + Supabase backend + Stripe + Resend + Meta Graph API
Hosting:  Vercel (frontend) + Supabase Edge Functions (backend)
Trosak:   €0/mes (do 50K MAU + 500MB baze)
```

## Sta sistem radi

✅ **Atleta nivoi**: 4 tier-a (Recruit 35% → Pro 40% → Commando 45% → Elite 50%)
✅ **Auto napredovanje** kad se kriterijumi ispune (vreme + prodaje + Reels/Stories quota)
✅ **Audicija**: javni formular sa video upload, admin odobrava
✅ **Magic link login** + Google OAuth
✅ **4 affiliate linka po atleti** (po jedan za svaki paket)
✅ **Real-time tracking**: klikovi, konverzije, provizije
✅ **Stripe Connect Express**: auto isplate 20. u mesecu, atleta upise IBAN
✅ **Instagram Graph API**: auto brojanje Reels-a i Story-ja za napredovanje
✅ **Gejmifikacija**: 32 bedza (7 skrivenih), streak sistem (7/14/30/100 dana), dnevni izazovi (5 svaki dan), XP, leaderboard
✅ **Email obavestenja**: welcome, streak warning (4h pre isteka), payouts, level up
✅ **Admin panel**: pregled svih atleta, prodaja, isplata + CSV export

## Folder struktura

```
vamit5-affiliate/
├── public/                    # Frontend (Vercel deploy)
│   ├── index.html             # Landing + apply forma
│   ├── login.html             # Magic link login
│   ├── dashboard.html         # Atleta dashboard
│   ├── admin.html             # Admin konzola
│   ├── thanks.html            # Posle uspesne kupovine
│   └── config.js              # Public config (Supabase URL + anon key)
│
├── supabase/
│   ├── schema.sql             # Database schema (tabele, indeksi, RLS, triggers)
│   ├── cron.sql               # Scheduled jobs setup
│   └── functions/             # Edge functions (Deno + TypeScript)
│       ├── stripe-webhook/        # Prima Stripe eventove → kreira sale
│       ├── redirect/              # /r/<username> → klik tracking → Stripe Checkout
│       ├── stripe-connect-onboard/# Stripe Connect Express onboarding link
│       ├── approve-application/   # Admin odobrava → kreira atleta + magic link
│       ├── monthly-payouts/       # 20. u mesecu → svim atletama isplata
│       ├── generate-challenges/   # Dnevni izazovi
│       ├── daily-checks/          # Streak warnings, challenge progress
│       ├── instagram-oauth-start/ # OAuth start
│       ├── instagram-oauth-callback/ # OAuth callback
│       └── instagram-sync/        # Daily sync postova
│
├── DEPLOYMENT.md              # Korak po korak setup
├── .env.example               # Template environment varijabli
├── vercel.json                # Vercel config (rewrites za /r/<username>)
└── README.md                  # Ovaj fajl
```

## Brz pocetak

1. Procitaj `DEPLOYMENT.md` (~2h kompletno setup)
2. Treba ti: Supabase nalog, Stripe nalog, Resend nalog, Meta Developer nalog
3. Dok cekas Meta App Review (2-6 nedelja) sve drugo radi normalno

## Sigurnost

- **RLS**: Sve tabele imaju row-level security; atleta vidi samo svoje podatke
- **Service role key**: Samo u edge functions, nikad u frontend-u
- **Stripe webhook signature**: Verifikuje se na svakom pozivu
- **Cookie attribution**: 90 dana, secure + SameSite

## Sledeci koraci za tebe

- [ ] Procitaj DEPLOYMENT.md
- [ ] Setup Supabase + Stripe + Resend (2h)
- [ ] Deploy na Vercel
- [ ] Test sa svojim test atletom
- [ ] Submit Meta App Review (paralelno sa lansiranjem)
- [ ] Lansiraj prvih 5-10 atleta
- [ ] Iteriraj na osnovu povratnih informacija

---

**License**: Private. © VAMIT-5 2026.
