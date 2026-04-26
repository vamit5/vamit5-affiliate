-- =====================================================================
-- VAMIT-5 ATHLETE AFFILIATE PROGRAM — Database Schema
-- Supabase / PostgreSQL
-- =====================================================================
-- Run this file in: Supabase Dashboard -> SQL Editor -> New Query -> Paste -> Run
-- This creates: tables, indexes, triggers, RLS policies, seed data.
-- =====================================================================

-- Extensions
create extension if not exists "uuid-ossp";
create extension if not exists "pgcrypto";

-- =====================================================================
-- ENUMS
-- =====================================================================
create type tier_level as enum ('recruit','pro','commando','elite');
create type application_status as enum ('pending','video_requested','approved','rejected');
create type sale_status as enum ('pending','confirmed','refunded','cancelled');
create type payout_status as enum ('pending','processing','paid','failed');
create type challenge_type as enum ('first_sale','daily_sales','reels','stories','clicks','social_share');
create type badge_rarity as enum ('common','rare','epic','legendary');

-- =====================================================================
-- 1. ATHLETES (the main user table — extends auth.users)
-- =====================================================================
create table public.athletes (
  id uuid primary key references auth.users(id) on delete cascade,
  email text unique not null,
  full_name text not null,
  username text unique not null,                         -- used in referral link /r/<username>
  phone text,
  country text,                                          -- ISO code (RS, ME, HR…)
  avatar_url text,

  -- Tier system
  tier tier_level not null default 'recruit',
  tier_started_at timestamptz not null default now(),
  xp integer not null default 0,

  -- Streak system
  current_streak integer not null default 0,
  longest_streak integer not null default 0,
  last_activity_date date,

  -- Instagram connection
  instagram_username text,
  instagram_user_id text,                                -- IG Graph API user id
  instagram_access_token text,                           -- long-lived token (encrypt before prod)
  instagram_token_expires_at timestamptz,
  instagram_connected_at timestamptz,

  -- Stripe Connect (for payouts)
  stripe_connect_account_id text,
  stripe_connect_onboarded boolean not null default false,

  -- Telegram (backup za push notifikacije)
  telegram_chat_id text,
  telegram_username text,
  telegram_link_code text,                              -- one-time code athlete uses /start <code> in bot

  -- Notification preferences
  notify_sales boolean not null default true,
  notify_streak boolean not null default true,
  notify_levelup boolean not null default true,
  notify_challenges boolean not null default true,
  notify_leaderboard boolean not null default true,

  -- Status
  is_active boolean not null default true,
  banned boolean not null default false,
  ban_reason text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_athletes_username on public.athletes(username);
create index idx_athletes_tier on public.athletes(tier);
create index idx_athletes_xp on public.athletes(xp desc);

-- =====================================================================
-- 2. APPLICATIONS (Recruit application flow)
-- =====================================================================
create table public.applications (
  id uuid primary key default uuid_generate_v4(),
  email text not null,
  full_name text not null,
  phone text,
  country text,
  instagram_handle text,
  why_join text,                                          -- short essay
  video_url text,                                         -- video upload (KB + BW vežbe)
  status application_status not null default 'pending',
  reviewed_by uuid references public.athletes(id),
  reviewed_at timestamptz,
  rejection_reason text,
  created_at timestamptz not null default now()
);

create index idx_applications_status on public.applications(status);
create index idx_applications_email on public.applications(email);

-- =====================================================================
-- 3. PRODUCTS (the 4 packages)
-- =====================================================================
create table public.products (
  id uuid primary key default uuid_generate_v4(),
  name text not null,
  slug text not null unique,                              -- '1mo', '3mo', '6mo', '12mo' for clean URLs
  duration_months integer not null,
  price_eur numeric(10,2) not null,
  stripe_payment_link text not null,                      -- existing Stripe Payment Link URL
  is_active boolean not null default true,
  display_order integer not null default 0,
  created_at timestamptz not null default now()
);

-- Seed the 4 packages with REAL Stripe Payment Links
insert into public.products (name, slug, duration_months, price_eur, stripe_payment_link, display_order) values
  ('VAMIT-5 · 1 mesec',    '1mo',  1,  29.99,  'https://buy.stripe.com/eVq3cuewseLsgd94J8eEo0q', 1),
  ('VAMIT-5 · 3 meseca',   '3mo',  3,  79.99,  'https://buy.stripe.com/3cI28qews7j0d0X3F4eEo02', 2),
  ('VAMIT-5 · 6 meseci',   '6mo',  6, 139.99,  'https://buy.stripe.com/00w9ASbkg46Od0X0sSeEo03', 3),
  ('VAMIT-5 · 12 meseci', '12mo', 12, 239.99,  'https://buy.stripe.com/8x2dR81JGgTA5yv1wWeEo04', 4);

-- =====================================================================
-- 4. CLICKS (every click on an affiliate link)
-- =====================================================================
create table public.clicks (
  id uuid primary key default uuid_generate_v4(),
  athlete_id uuid not null references public.athletes(id) on delete cascade,
  product_id uuid references public.products(id) on delete set null,
  ip_address inet,
  user_agent text,
  referrer text,
  country text,
  device text,                                           -- mobile/desktop/tablet
  utm_source text,                                       -- ig/tt/yt/wa/qr...
  cookie_id text,                                        -- for attribution tracking (90 days)
  converted boolean not null default false,
  created_at timestamptz not null default now()
);

create index idx_clicks_athlete on public.clicks(athlete_id, created_at desc);
create index idx_clicks_cookie on public.clicks(cookie_id);
create index idx_clicks_date on public.clicks(created_at desc);

-- =====================================================================
-- 5. SALES (confirmed Stripe sales attributed to an athlete)
-- =====================================================================
create table public.sales (
  id uuid primary key default uuid_generate_v4(),
  athlete_id uuid not null references public.athletes(id) on delete cascade,
  product_id uuid not null references public.products(id),
  click_id uuid references public.clicks(id),

  -- Stripe data
  stripe_session_id text unique,
  stripe_invoice_id text,
  stripe_customer_id text,

  -- Money (everything in EUR cents to avoid float)
  gross_amount_cents integer not null,                   -- 2999 = €29.99
  net_amount_cents integer not null,                     -- after Stripe fee + VAT
  commission_rate numeric(4,2) not null,                 -- 0.35, 0.40, 0.45, 0.50
  commission_cents integer not null,

  status sale_status not null default 'pending',         -- pending → confirmed (after 14d) → paid out
  refund_window_ends_at timestamptz not null,            -- created_at + 14 days
  payout_id uuid,                                        -- references payouts(id) when paid

  customer_email text,
  customer_country text,

  created_at timestamptz not null default now(),
  confirmed_at timestamptz,
  refunded_at timestamptz
);

create index idx_sales_athlete on public.sales(athlete_id, created_at desc);
create index idx_sales_status on public.sales(status);
create index idx_sales_stripe_session on public.sales(stripe_session_id);

-- =====================================================================
-- 6. POSTS (Instagram Reels & Stories tracked daily)
-- =====================================================================
create table public.posts (
  id uuid primary key default uuid_generate_v4(),
  athlete_id uuid not null references public.athletes(id) on delete cascade,
  ig_post_id text,                                       -- Instagram post ID (null if manual)
  post_type text not null,                               -- 'reel' | 'story' | 'post'
  permalink text,
  thumbnail_url text,
  caption text,
  posted_at timestamptz not null,
  like_count integer,
  comment_count integer,
  view_count integer,
  is_manual boolean not null default false,              -- true = athlete pasted link manually
  created_at timestamptz not null default now()
);

create index idx_posts_athlete_date on public.posts(athlete_id, posted_at desc);
create index idx_posts_type on public.posts(post_type);
create unique index idx_posts_ig on public.posts(ig_post_id) where ig_post_id is not null;

-- Daily post counter view (for fast quota checks)
create or replace view public.daily_post_counts as
select
  athlete_id,
  date(posted_at) as post_date,
  count(*) filter (where post_type = 'reel') as reels_count,
  count(*) filter (where post_type = 'story') as stories_count,
  count(*) filter (where post_type = 'post') as posts_count
from public.posts
group by athlete_id, date(posted_at);

-- =====================================================================
-- 7. ACHIEVEMENTS / BADGES
-- =====================================================================
create table public.badges (
  id uuid primary key default uuid_generate_v4(),
  code text unique not null,                             -- 'first_sale', 'streak_30', etc
  name text not null,
  description text,
  emoji text not null,
  rarity badge_rarity not null default 'common',
  xp_reward integer not null default 0,
  is_secret boolean not null default false,
  created_at timestamptz not null default now()
);

-- Seed 32 badges (7 secret)
insert into public.badges (code, name, description, emoji, rarity, xp_reward, is_secret) values
  -- Common
  ('first_sale',       'Prva prodaja',       'Zatvorio si prvu prodaju',                  '🎯', 'common',     300,  false),
  ('streak_7',         'Streak 7',           'Aktivan 7 dana zaredom',                    '🔥', 'common',     500,  false),
  ('first_recruit',    'Pro start',          'Postao si REGRUT atleta',                   '⭐', 'common',     100,  false),
  ('first_post',       'Prvi reel',          'Postavio si prvi Reel',                     '🎬', 'common',     150,  false),
  ('night_owl',        'Nocni sef',          'Prodaja izmedju 22h i 02h',                 '🌙', 'common',     100,  false),
  -- Rare
  ('streak_14',        'Vatra 14',           'Streak 14 dana',                            '🔥', 'rare',       1000, false),
  ('sales_10',         '10 prodaja',         'Ukupno 10 prodaja',                         '💎', 'rare',       1500, false),
  ('daily_5',          '5 u danu',           '5 prodaja u jednom danu',                   '⚡', 'rare',       2000, false),
  ('reel_machine',     'Reel masina',        '20 Reel-ova u 7 dana',                      '🎬', 'rare',       1500, false),
  ('promotion_pro',    'Pro promocija',      'Promocija u PRO ATHLETE',                   '⭐⭐', 'rare',     2500, false),
  -- Epic
  ('streak_30',        'Mesec dana',         'Streak 30 dana',                            '🔥', 'epic',       3000, false),
  ('sales_100',        '100 prodaja',        'Ukupno 100 prodaja',                        '🚀', 'epic',       5000, false),
  ('viral_post',       'Viral',              'Post sa preko 100K view-ova',               '🌟', 'epic',       5000, false),
  ('three_countries',  '3 zemlje',           'Prodaje u 3 razlicite zemlje',              '🌍', 'epic',       3000, false),
  ('promotion_commando','Commando promocija','Promocija u COMMANDO',                      '⭐⭐⭐', 'epic',   5000, false),
  ('month_5k',         '€5K mesec',          'Provizija preko €5.000 u jednom mesecu',    '💰', 'epic',       5000, false),
  -- Legendary
  ('streak_100',       'Sto dana',           'Streak 100 dana',                           '🔥', 'legendary',  15000, false),
  ('sales_500',        '500 prodaja',        'Ukupno 500 prodaja',                        '👑', 'legendary',  20000, false),
  ('promotion_elite',  'Elite Athlete',      'Najvisi rang dostignut',                    '⭐⭐⭐⭐', 'legendary', 25000, false),
  ('month_10k',        '€10K mesec',         'Provizija preko €10.000 u jednom mesecu',   '💎', 'legendary',  20000, false),
  ('mentor_5',         'Mentor',             '5 atleta koje si doveo aktivni',            '🤝', 'legendary',  10000, false),

  -- Hidden / Secret (7)
  ('ghost',            'Ghost',              '???',                                        '👻', 'epic',       3000, true),
  ('lightning',        'Munja',              '???',                                        '⚡', 'rare',       2000, true),
  ('phoenix',          'Feniks',             '???',                                        '🔥', 'epic',       4000, true),
  ('marathon',         'Maraton',            '???',                                        '🏃', 'rare',       2500, true),
  ('all_star',         'All Star',           '???',                                        '⭐', 'legendary',  10000, true),
  ('comeback',         'Povratak',           '???',                                        '💪', 'epic',       3500, true),
  ('iron',             'Ironman',            '???',                                        '🦾', 'legendary',  15000, true);

-- Athlete badge unlocks
create table public.athlete_badges (
  id uuid primary key default uuid_generate_v4(),
  athlete_id uuid not null references public.athletes(id) on delete cascade,
  badge_id uuid not null references public.badges(id),
  unlocked_at timestamptz not null default now(),
  unique(athlete_id, badge_id)
);

create index idx_athlete_badges on public.athlete_badges(athlete_id);

-- =====================================================================
-- 8. CHALLENGES (daily generated)
-- =====================================================================
create table public.challenges (
  id uuid primary key default uuid_generate_v4(),
  challenge_date date not null,                          -- the day the challenge is for
  type challenge_type not null,
  title text not null,
  description text,
  target integer not null,                               -- e.g., 5 (sales) or 1 (post before 14h)
  xp_reward integer not null,
  emoji text not null default '🎯',
  created_at timestamptz not null default now()
);

create index idx_challenges_date on public.challenges(challenge_date);

-- Athlete progress on a challenge
create table public.challenge_progress (
  id uuid primary key default uuid_generate_v4(),
  challenge_id uuid not null references public.challenges(id) on delete cascade,
  athlete_id uuid not null references public.athletes(id) on delete cascade,
  progress integer not null default 0,
  completed boolean not null default false,
  completed_at timestamptz,
  unique(challenge_id, athlete_id)
);

create index idx_chal_prog on public.challenge_progress(athlete_id, challenge_id);

-- =====================================================================
-- 9. PAYOUTS (monthly via Stripe Connect)
-- =====================================================================
create table public.payouts (
  id uuid primary key default uuid_generate_v4(),
  athlete_id uuid not null references public.athletes(id) on delete cascade,
  period_start date not null,                            -- first day of period (1st of month)
  period_end date not null,                              -- last day of period
  total_cents integer not null,
  sales_count integer not null,
  status payout_status not null default 'pending',
  stripe_transfer_id text,
  failure_reason text,
  created_at timestamptz not null default now(),
  paid_at timestamptz
);

create index idx_payouts_athlete on public.payouts(athlete_id, period_start desc);
create index idx_payouts_status on public.payouts(status);

-- =====================================================================
-- 10. ACTIVITY FEED
-- =====================================================================
create table public.activity (
  id uuid primary key default uuid_generate_v4(),
  athlete_id uuid references public.athletes(id) on delete cascade,
  type text not null,                                    -- 'sale', 'levelup', 'badge', 'challenge_done', 'streak'
  title text not null,
  meta jsonb,                                            -- extra data (amount, badge id, etc)
  created_at timestamptz not null default now()
);

create index idx_activity_athlete on public.activity(athlete_id, created_at desc);
create index idx_activity_global on public.activity(created_at desc);

-- =====================================================================
-- 11a. PUSH SUBSCRIPTIONS (Web Push API)
-- =====================================================================
create table public.push_subscriptions (
  id uuid primary key default uuid_generate_v4(),
  athlete_id uuid not null references public.athletes(id) on delete cascade,
  endpoint text not null,
  p256dh text not null,                                  -- key for encryption
  auth text not null,                                    -- auth secret
  user_agent text,
  device_label text,                                     -- e.g. "Chrome on Windows" / "Safari iOS"
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  unique(endpoint)
);

create index idx_push_subs_athlete on public.push_subscriptions(athlete_id);

alter table public.push_subscriptions enable row level security;
create policy own_push_subs on public.push_subscriptions for select
  using (auth.uid() = athlete_id);
create policy own_push_insert on public.push_subscriptions for insert
  with check (auth.uid() = athlete_id);
create policy own_push_delete on public.push_subscriptions for delete
  using (auth.uid() = athlete_id);

-- =====================================================================
-- 11. ADMINS
-- =====================================================================
create table public.admins (
  id uuid primary key references auth.users(id) on delete cascade,
  email text unique not null,
  full_name text not null,
  created_at timestamptz not null default now()
);

-- =====================================================================
-- 12. TRIGGERS — auto promotion logic
-- =====================================================================

-- Tier requirements
create or replace function public.check_promotion(p_athlete_id uuid)
returns void
language plpgsql
security definer
as $$
declare
  v_tier tier_level;
  v_tier_started_at timestamptz;
  v_total_sales integer;
  v_recent_sales integer;
  v_avg_reels numeric;
  v_avg_stories numeric;
  v_months_in_tier numeric;
  v_new_tier tier_level := null;
begin
  select tier, tier_started_at into v_tier, v_tier_started_at
  from public.athletes where id = p_athlete_id;

  v_months_in_tier := extract(epoch from (now() - v_tier_started_at)) / (60*60*24*30);

  -- Total confirmed sales (all time)
  select count(*) into v_total_sales
  from public.sales where athlete_id = p_athlete_id and status in ('confirmed','pending');

  -- Sales in last 30 days
  select count(*) into v_recent_sales
  from public.sales
  where athlete_id = p_athlete_id
    and status in ('confirmed','pending')
    and created_at >= now() - interval '30 days';

  -- Avg reels per day in last 30 days
  select coalesce(avg(c.reels_count),0) into v_avg_reels
  from (
    select count(*) filter (where post_type='reel') as reels_count
    from public.posts
    where athlete_id = p_athlete_id and posted_at >= now() - interval '30 days'
    group by date(posted_at)
  ) c;

  -- Avg stories per day in last 30 days
  select coalesce(avg(c.stories_count),0) into v_avg_stories
  from (
    select count(*) filter (where post_type='story') as stories_count
    from public.posts
    where athlete_id = p_athlete_id and posted_at >= now() - interval '30 days'
    group by date(posted_at)
  ) c;

  -- Promotion logic
  if v_tier = 'recruit'
    and v_months_in_tier >= 2
    and v_total_sales >= 10
    and v_avg_reels >= 1
    and v_avg_stories >= 4 then
      v_new_tier := 'pro';
  elsif v_tier = 'pro'
    and v_months_in_tier >= 3
    and v_total_sales >= 30                              -- 10 (pro req) + 20 (commando req)
    and v_avg_reels >= 2
    and v_avg_stories >= 5 then
      v_new_tier := 'commando';
  elsif v_tier = 'commando'
    and v_months_in_tier >= 3
    and v_recent_sales >= 15
    and v_avg_reels >= 10
    and v_avg_stories >= 10 then
      v_new_tier := 'elite';
  end if;

  if v_new_tier is not null then
    update public.athletes
    set tier = v_new_tier,
        tier_started_at = now(),
        updated_at = now()
    where id = p_athlete_id;

    -- Award promotion XP & badge
    insert into public.activity (athlete_id, type, title, meta)
    values (p_athlete_id, 'levelup', 'Promocija u ' || upper(v_new_tier::text),
            jsonb_build_object('new_tier', v_new_tier));

    -- Unlock corresponding badge
    insert into public.athlete_badges (athlete_id, badge_id)
    select p_athlete_id, b.id
    from public.badges b
    where b.code = case v_new_tier
      when 'pro' then 'promotion_pro'
      when 'commando' then 'promotion_commando'
      when 'elite' then 'promotion_elite'
    end
    on conflict do nothing;
  end if;
end;
$$;

-- =====================================================================
-- 13. HELPER: get commission rate by tier
-- =====================================================================
create or replace function public.commission_rate(p_tier tier_level)
returns numeric
language sql immutable
as $$
  select case p_tier
    when 'recruit' then 0.35
    when 'pro'     then 0.40
    when 'commando' then 0.45
    when 'elite'   then 0.50
  end;
$$;

-- =====================================================================
-- 14. RLS POLICIES (security)
-- =====================================================================
alter table public.athletes enable row level security;
alter table public.applications enable row level security;
alter table public.sales enable row level security;
alter table public.clicks enable row level security;
alter table public.posts enable row level security;
alter table public.athlete_badges enable row level security;
alter table public.challenge_progress enable row level security;
alter table public.payouts enable row level security;
alter table public.activity enable row level security;

-- Athletes can read/update own row
create policy athlete_self_read on public.athletes for select
  using (auth.uid() = id or exists (select 1 from public.admins where id = auth.uid()));
create policy athlete_self_update on public.athletes for update
  using (auth.uid() = id);

-- Athletes read own sales / clicks / posts / badges / payouts
create policy own_sales on public.sales for select
  using (auth.uid() = athlete_id or exists (select 1 from public.admins where id = auth.uid()));
create policy own_clicks on public.clicks for select
  using (auth.uid() = athlete_id or exists (select 1 from public.admins where id = auth.uid()));
create policy own_posts on public.posts for select
  using (auth.uid() = athlete_id or exists (select 1 from public.admins where id = auth.uid()));
create policy own_badges