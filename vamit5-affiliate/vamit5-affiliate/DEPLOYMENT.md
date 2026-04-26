# VAMIT-5 Athlete Affiliate · Deployment Vodic

Sve sto treba da uradis korak po korak. Procitaj redom — ne preskaci.

> **Realan timing:** ~2h aktivnog rada + 2-4 nedelje cekanja Meta App Review za Instagram OAuth.

---

## Sta cemo deployovati

```
Frontend  →  Vercel (besplatan tier, neograniceno)
Backend   →  Supabase (besplatan tier do 500MB / 50K MAU)
Email     →  Resend (besplatan tier 3000 email/mes)
Plac.     →  Stripe (postojeci nalog)
IG track. →  Meta Graph API (besplatan, ali zahteva App Review)
```

**Ukupan trosak mesecno: €0** dok ne predjes Supabase ili Resend free limit.

---

## KORAK 1 · Supabase setup (15 min)

### 1.1 Kreiraj projekat
1. Idi na **https://supabase.com** → **Start your project** → Sign in sa Google (`vamit5.team@gmail.com`).
2. **New project**:
   - Name: `vamit5-affiliate`
   - Database Password: **GENERIŠI STRONG i sačuvaj** u password manageru
   - Region: **Frankfurt (eu-central-1)** — najblize Srbiji
   - Pricing: **Free**
3. Sacekaj 2 min da se napravi.

### 1.2 Pokreni SQL schema
1. Levi meni → **SQL Editor** → **New query**
2. Kopiraj kompletan sadrzaj iz `supabase/schema.sql`
3. Klikni **Run** (Ctrl+Enter)
4. Trebaš videti: `Success. No rows returned`

### 1.3 Setup Storage bucket-a (za audition videa)
1. Levi meni → **Storage** → **New bucket**
2. Bucket 1: `application-videos` → **Private** → Create
3. Bucket 2: `avatars` → **Public** → Create

### 1.4 Auth provider-i
1. Levi meni → **Authentication** → **Providers**
2. **Email**: aktiviraj, ostavi default
3. **Google**:
   - Klikni → **Enable**
   - Idi na **Google Cloud Console** → APIs & Services → Credentials
   - Create OAuth Client ID → Web application
   - Authorized redirect URI: `https://YOUR-PROJECT-ID.supabase.co/auth/v1/callback`
   - Kopiraj Client ID i Secret nazad u Supabase
4. **Site URL** (gore u Auth → URL Configuration):
   - **Site URL**: stavi `https://athletes.vamit5.app` (ili tvoj Vercel link kasnije)
   - **Redirect URLs**: dodaj `https://*.vercel.app/dashboard.html`

### 1.5 Sacuvaj API kljuceve
- Levi meni → **Project Settings** → **API**
- Kopiraj:
  - **Project URL** → bice `SUPABASE_URL`
  - **anon public** → bice `SUPABASE_ANON_KEY`
  - **service_role** (skroz dole, klikni "Reveal") → bice `SUPABASE_SERVICE_ROLE_KEY` ⚠️ **NIKAD NE STAVLJAJ U FRONTEND**

### 1.6 Postavi sebe kao admin-a
- Idi na sajt nakon deploy-a, **prijavi se** preko email magic link-a sa `vamit5.team@gmail.com`
- Vrati se u Supabase → **SQL Editor** → New query, izvrši:
```sql
INSERT INTO public.admins (id, email, full_name)
SELECT id, email, 'Borislav' FROM auth.users WHERE email = 'vamit5.team@gmail.com';
```

---

## KORAK 2 · Stripe setup (20 min)

### 2.1 Stripe Connect (jednokratno)
1. Idi na **dashboard.stripe.com** → **Connect** (levi meni) → **Get started**
2. Type: **Platform or marketplace**
3. Popuni informacije o firmi (Srbija)
4. Caceka odobravanje 1-3 dana

### 2.2 Kreiraj 4 produkta i cene
1. Stripe Dashboard → **Products** → **Add product**
2. Za svaki paket:
   - **VAMIT-5 · 1 mesec** → €29.99 / mesec → **Recurring** → **Monthly**
   - **VAMIT-5 · 3 meseca** → €79.99 → **One time**
   - **VAMIT-5 · 6 meseci** → €139.99 → **One time**
   - **VAMIT-5 · 12 meseci** → €239.99 → **One time**
3. Za svaki, kopiraj **Price ID** (pocinje sa `price_...`)
4. Vrati se u Supabase → SQL Editor:
```sql
UPDATE public.products SET stripe_price_id = 'price_LIVE_MONTHLY_ID' WHERE duration_months = 1;
UPDATE public.products SET stripe_price_id = 'price_LIVE_3MO_ID'     WHERE duration_months = 3;
UPDATE public.products SET stripe_price_id = 'price_LIVE_6MO_ID'     WHERE duration_months = 6;
UPDATE public.products SET stripe_price_id = 'price_LIVE_12MO_ID'    WHERE duration_months = 12;
```

### 2.3 API Keys
1. Stripe → **Developers** → **API keys**
2. Kopiraj **Secret key** (`sk_live_...` ili `sk_test_...`) → bice `STRIPE_SECRET_KEY`
3. *Webhook secret se generise u koraku 4*

---

## KORAK 3 · Resend setup (5 min)

1. Idi na **https://resend.com** → Sign up sa `vamit5.team@gmail.com`
2. **API Keys** → **Create API Key** → naziv: `vamit5-prod` → kopiraj `re_...` → bice `RESEND_API_KEY`
3. **Domains** → **Add Domain** → `vamit5.app` (ili `athletes.vamit5.app`)
4. Dodaj DNS zapise koje Resend trazi (TXT, MX, CNAME) na tvom DNS provideru
5. Sacekaj DNS propagaciju (5-30 min) → status mora biti **Verified**

---

## KORAK 4 · Vercel deploy (10 min)

### 4.1 Instaliraj Vercel CLI (jednokratno)
```bash
npm install -g vercel
```

### 4.2 Edituj `public/config.js`
Otvori taj fajl i upiši:
```js
window.SUPABASE_URL = "https://YOUR-PROJECT-ID.supabase.co";
window.SUPABASE_ANON_KEY = "eyJhbGc...your-anon-key";
window.SITE_URL = window.location.origin;
```

### 4.3 Edituj `vercel.json`
Zameni `YOUR-PROJECT-ID` sa pravim Supabase project ID na obe linije.

### 4.4 Deploy
U folderu projekta:
```bash
vercel
```
- Login sa `vamit5.team@gmail.com`
- Project name: `vamit5-affiliate`
- Directory: `./` (Enter)
- Override defaults? **No**

Deploy traje ~30 sec. Dobices URL kao `vamit5-affiliate.vercel.app`.

### 4.5 Production deploy
```bash
vercel --prod
```

---

## KORAK 5 · Edge functions deploy (15 min)

### 5.1 Supabase CLI
```bash
npm install -g supabase
supabase login
```

### 5.2 Link projekat
U folderu:
```bash
supabase link --project-ref YOUR-PROJECT-ID
```

### 5.3 Postavi secrets
```bash
supabase secrets set STRIPE_SECRET_KEY=sk_live_...
supabase secrets set STRIPE_WEBHOOK_SECRET=whsec_   # placeholder, popunjavamo u sledecem koraku
supabase secrets set RESEND_API_KEY=re_...
supabase secrets set FB_APP_ID=123456789
supabase secrets set FB_APP_SECRET=...
supabase secrets set SITE_URL=https://vamit5-affiliate.vercel.app
```

### 5.4 Deploy sve funkcije
```bash
supabase functions deploy stripe-webhook --no-verify-jwt
supabase functions deploy redirect --no-verify-jwt
supabase functions deploy stripe-connect-onboard
supabase functions deploy approve-application
supabase functions deploy monthly-payouts --no-verify-jwt
supabase functions deploy generate-challenges --no-verify-jwt
supabase functions deploy daily-checks --no-verify-jwt
supabase functions deploy instagram-oauth-start --no-verify-jwt
supabase functions deploy instagram-oauth-callback --no-verify-jwt
supabase functions deploy instagram-sync --no-verify-jwt
```

---

## KORAK 6 · Stripe webhook (5 min)

1. Stripe → **Developers** → **Webhooks** → **Add endpoint**
2. **URL**: `https://YOUR-PROJECT-ID.supabase.co/functions/v1/stripe-webhook`
3. **Events to send**:
   - `checkout.session.completed`
   - `invoice.paid`
   - `charge.refunded`
4. Klikni **Add endpoint**
5. Kopiraj **Signing secret** (pocinje `whsec_...`)
6. Update u Supabase:
```bash
supabase secrets set STRIPE_WEBHOOK_SECRET=whsec_...
supabase functions deploy stripe-webhook --no-verify-jwt
```

---

## KORAK 7 · Cron jobs (5 min)

U Supabase SQL Editor pokreni `supabase/cron.sql`. Pre toga:
- Edituj `app.settings.supabase_url` i `app.settings.service_role_key` na vrhu cron.sql sa pravim vrednostima.

```sql
alter database postgres set "app.settings.supabase_url" = 'https://YOUR-PROJECT-ID.supabase.co';
alter database postgres set "app.settings.service_role_key" = 'eyJhbGc...service_role';
```

Posle: pokreni ostatak cron.sql.

---

## KORAK 8 · Meta / Instagram OAuth (cekamo Meta App Review 2-6 nedelja)

### 8.1 Pre-review (radi za tebe i test atlete iz **Instagram Tester** liste)
1. **developers.facebook.com** → My Apps → Create App → tip **Other** → **Business**
2. App name: `VAMIT-5 Athletes` → **Create app**
3. Dashboard → **Add Product** → **Instagram** → **Set up**
4. Levi meni → **App Roles** → **Roles** → dodaj sebe kao Admin
5. Levi meni → **App Settings** → **Basic** → kopiraj **App ID** i **App Secret** → save kao `FB_APP_ID` i `FB_APP_SECRET`
6. **Instagram → Basic Display** → **Create New App** → naziv: `vamit5-tracker`
7. **Valid OAuth Redirect URIs**: `https://YOUR-PROJECT-ID.supabase.co/functions/v1/instagram-oauth-callback`
8. **Instagram Tester**: dodaj svoj IG i 1-2 atlete da testiras

### 8.2 App Review (kad budes spreman)
- Trazi permissions: `instagram_basic`, `instagram_manage_insights`, `pages_show_list`, `pages_read_engagement`, `business_management`
- Submission zahteva: privacy policy URL, screen recording demo, opis use-case-a
- Meta odgovara 2-6 nedelja

**Dok cekas: atlete koji su Instagram Tester (do 25 testera) mogu da koriste OAuth normalno.**

---

## KORAK 9 · Test (15 min)

1. Otvori **https://vamit5-affiliate.vercel.app**
2. Klikni **Prijavi se** → popuni formular sa test podacima → upload kratak video
3. Login admin → otvori **Aplikacije** → klikni **Odobri** za test prijavu
4. Magic link stiže na test email → klikni → otvara dashboard
5. **Connect Instagram** → testiraj OAuth flow (samo ako si u Instagram Tester listi)
6. **Setup payouts** → testiraj Stripe Connect onboarding
7. Test prodaja:
   - Kopiraj affiliate link iz dashboard-a → otvori u incognito → klikni → preusmerava na Stripe Checkout
   - Koristi test karticu `4242 4242 4242 4242` → bilo koji datum / CVC
   - Vrati se u admin → **Prodaje** → trebas videti novu liniju!
8. **Pokreni mesecne isplate** ručno za test (samo ako ima confirmed sales)

---

## KORAK 10 · Production switch

Kad si testirao i sve radi:
1. Stripe → **Developers** → toggle **View test data** OFF → kreiraj prave price_id i webhook
2. Update `STRIPE_SECRET_KEY` na `sk_live_...`
3. Update `STRIPE_WEBHOOK_SECRET` na live webhook secret
4. Redeploy edge functions
5. Update Supabase products tabelu sa LIVE price_id

---

## Ongoing maintenance

- **Supabase backups**: Free tier ima 7-dana backup, automatski.
- **Monitoring**: Vercel + Supabase imaju dashbord za logove. Proveri 1x nedeljno.
- **Updates**: Edge functions mozes redeployovati anytime sa `supabase functions deploy <name>`.
- **Skaliranje**: Kad predjes 50K MAU ili 500MB baze, pređi na Supabase Pro ($25/mes).

---

## Troubleshooting

**"Magic link" ne radi?**
- Proveri Supabase Auth → URL Configuration → Site URL i Redirect URLs.
- Proveri Resend domen verifikovan.

**Stripe webhook ne stiže?**
- Stripe Dashboard → Webhooks → klikni endpoint → tab **Events** → vidis pokušaje. Proveri response code.

**Affiliate link `/r/marko` 404?**
- Proveri `vercel.json` → rewrites → da li si zamenio `YOUR-PROJECT-ID`.

**IG Connect baca gresku?**
- Pre App Review-a: proveri da je atleta u **Instagram Tester** listi.
- Posle App Review-a: proveri da li su sva permissions odobrena.

---

## Sledeci koraci (kad bude vreme)

- **Domen**: Vercel → Project → Settings → Domains → dodaj `athletes.vamit5.app`
- **Email obavestenja**: Vec radi za welcome i streak warning. Dodaj weekly summary tako sto napravis novu edge function `weekly-summary` koja se zove svake nedelje preko cron-a.
- **TikTok integration**: Slican OAuth flow kao IG, ali TikTok API je losiji. Trebaće ekstra trud.
- **Mobilna app za atlete**: Vec radi kao PWA — atlete mogu da "Add to home screen" iz mobile browser-a.

---

**Pitanja?** Sve je u kodu. Citaj komentare na vrhu svakog fajla.
