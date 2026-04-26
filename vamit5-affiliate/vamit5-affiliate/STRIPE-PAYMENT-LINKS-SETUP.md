# Stripe Payment Links — Setup za atribuciju

> Jednokratno (5 minuta), za sva 4 tvoja Payment Linka.

## Sta menjamo

Tvoja 4 postojeca Payment Linka **ostaju isti**. Pare i dalje idu na isti racun. Samo aktiviramo opciju da Stripe **prosledi `client_reference_id`** webhook-u — to je jedini nacin da znamo ko je doneo prodaju.

## Koraci za svaki Payment Link

1. Idi na **dashboard.stripe.com** → **Payment Links** (levi meni)
2. Klikni na svaki od 4 linka redom (1mo, 3mo, 6mo, 12mo)
3. Pri vrhu klikni **"..."** → **Edit**
4. Skroluj dole do **"After payment"** (ili "Advanced options")
5. Pronadji opciju **"Pass client_reference_id to webhooks"** ili **"Allow client_reference_id"** → **TURN ON**
6. **Save** / **Update link**
7. Ponovi za svaki od 4 linka

> Napomena: Stripe ovo ima ukljuceno po default-u za vecinu naloga. Ako ne vidis tu opciju — vec radi i mozes da preskocis.

## Test (1 min)

1. Otvori u browseru: `https://buy.stripe.com/eVq3cuewseLsgd94J8eEo0q?client_reference_id=test123`
2. Stranica treba da se otvori normalno (ne sme da daje gresku)
3. Stripe vec hvata `client_reference_id` automatski

## Webhook event check

Posle prve test-prodaje:
1. Stripe → **Developers** → **Webhooks** → klikni tvoj endpoint
2. Otvori najnoviji **`checkout.session.completed`** event
3. Trazi `client_reference_id` u JSON body — treba biti popunjeno (nesto kao `ath_abc__prod_xyz__clk_123`)

Ako je tu — **sve radi**. Sistem ce automatski parsirati i pripisati proviziju atleti.

---

## Kako ce stvar izgledati u praksi

**Atleta deli (na Instagramu/TikToku):**
```
vamit5.app/r/marko-nikolic/12mo
```

**Sta korisnik vidi:**
1. Klik → momentalni redirect na tvoj Stripe Payment Link sa atribucijom u URL-u (transparentno za korisnika)
2. Kupac kupuje normalno preko tvog Payment Linka
3. Pare → tvoj Stripe nalog (kao i do sad)

**Sta ti vidis u Stripe:**
- Transakcija ima `client_reference_id` = "ath_xxx__prod_yyy__clk_zzz"
- I `utm_source` (npr. "instagram") + `utm_content` (username atlete) u Checkout Session metadata-u — vidno odmah

**Sta ti vidis u VAMIT-5 admin panelu:**
- Tabela "Prodaje" → "Marko Nikolic | 12mo | €239.99 | €83.99 (35%)"
- Plus pravi izvestaj po atleti, mesecu, paketu
- Plus auto isplata atleti 20. u mesecu

---

**To je sve. Ide.**
