create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null unique,
  full_name text not null check (char_length(full_name) <= 80),
  role text not null default 'customer' check (role in ('customer', 'owner', 'admin')),
  created_at timestamptz not null default now()
);

create table if not exists public.studios (
  id uuid primary key default gen_random_uuid(),
  singleton boolean not null default true unique check (singleton),
  name text not null check (char_length(name) <= 80),
  city text not null check (char_length(city) <= 60),
  address text not null check (char_length(address) <= 120),
  blurb text not null default '' check (char_length(blurb) <= 300),
  tags text[] not null default '{}' check (cardinality(tags) <= 10),
  owner_id uuid references public.profiles(id) on delete set null,
  version integer not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.rooms (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references public.studios(id) on delete cascade,
  name text not null check (char_length(name) <= 60),
  description text not null default '' check (char_length(description) <= 100),
  hourly_rate numeric(10, 2) not null check (hourly_rate > 0),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (id, studio_id)
);

create table if not exists public.bookings (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references public.studios(id) on delete restrict,
  room_id uuid not null,
  user_id uuid references public.profiles(id) on delete set null,
  booking_date date not null,
  start_hour smallint not null,
  end_hour smallint not null,
  hourly_rate numeric(10, 2) not null check (hourly_rate > 0),
  total numeric(12, 2) generated always as (hourly_rate * (end_hour - start_hour)) stored,
  notes text not null default '' check (char_length(notes) <= 300),
  status text not null default 'confirmed' check (status in ('confirmed', 'cancelled')),
  created_at timestamptz not null default now(),
  cancelled_at timestamptz,
  cancelled_by uuid references public.profiles(id) on delete set null,
  constraint bookings_room_studio_fkey foreign key (room_id, studio_id)
    references public.rooms(id, studio_id) on delete restrict,
  constraint bookings_valid_hours check (start_hour >= 9 and end_hour <= 23 and end_hour > start_hour)
);

create table if not exists public.gigs (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references public.studios(id) on delete cascade,
  room_id uuid not null,
  title text not null check (char_length(title) <= 100),
  act text not null check (char_length(act) <= 150),
  genre text not null check (char_length(genre) <= 40),
  price numeric(10, 2) not null default 0 check (price >= 0),
  event_date date not null,
  start_hour smallint not null,
  end_hour smallint not null,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint gigs_room_studio_fkey foreign key (room_id, studio_id)
    references public.rooms(id, studio_id) on delete restrict,
  constraint gigs_valid_hours check (start_hour >= 9 and end_hour <= 23 and end_hour > start_hour)
);

create index if not exists bookings_room_date_idx on public.bookings (room_id, booking_date);
create index if not exists bookings_user_date_idx on public.bookings (user_id, booking_date desc);
create index if not exists gigs_room_date_idx on public.gigs (room_id, event_date);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.profiles (id, email, full_name)
  values (
    new.id,
    lower(new.email),
    coalesce(nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''), split_part(new.email, '@', 1))
  )
  on conflict (id) do update
    set email = excluded.email, full_name = excluded.full_name;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert or update of email on auth.users
  for each row execute function public.handle_new_user();

create or replace function public.user_is_admin()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.profiles
    where id = (select auth.uid()) and role = 'admin'
  );
$$;

create or replace function public.user_manages_studio(p_studio_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.studios s
    join public.profiles p on p.id = (select auth.uid())
    where s.id = p_studio_id
      and (s.owner_id = p.id or p.role = 'admin')
      and p.role in ('owner', 'admin')
  );
$$;

alter table public.profiles enable row level security;
alter table public.studios enable row level security;
alter table public.rooms enable row level security;
alter table public.bookings enable row level security;
alter table public.gigs enable row level security;

drop policy if exists "Profiles are visible to their user and studio managers" on public.profiles;
create policy "Profiles are visible to their user and studio managers"
  on public.profiles for select to authenticated
  using (
    id = (select auth.uid())
    or (select public.user_is_admin())
    or exists (
      select 1 from public.bookings b
      where b.user_id = profiles.id and (select public.user_manages_studio(b.studio_id))
    )
  );

drop policy if exists "Users can update their own name" on public.profiles;
create policy "Users can update their own name"
  on public.profiles for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

drop policy if exists "Studios are public" on public.studios;
create policy "Studios are public"
  on public.studios for select to anon, authenticated
  using (true);

drop policy if exists "Managers can update their studio" on public.studios;
create policy "Managers can update their studio"
  on public.studios for update to authenticated
  using ((select public.user_manages_studio(id)))
  with check ((select public.user_manages_studio(id)));

drop policy if exists "Active rooms are public and managers can see all rooms" on public.rooms;
create policy "Active rooms are public and managers can see all rooms"
  on public.rooms for select to anon, authenticated
  using (is_active or (select public.user_manages_studio(studio_id)));

drop policy if exists "Managers can add rooms" on public.rooms;
create policy "Managers can add rooms"
  on public.rooms for insert to authenticated
  with check ((select public.user_manages_studio(studio_id)));

drop policy if exists "Managers can update rooms" on public.rooms;
create policy "Managers can update rooms"
  on public.rooms for update to authenticated
  using ((select public.user_manages_studio(studio_id)))
  with check ((select public.user_manages_studio(studio_id)));

drop policy if exists "Events are public" on public.gigs;
create policy "Events are public"
  on public.gigs for select to anon, authenticated
  using (true);

drop policy if exists "Managers can delete events" on public.gigs;
create policy "Managers can delete events"
  on public.gigs for delete to authenticated
  using ((select public.user_manages_studio(studio_id)));

drop policy if exists "Customers and managers can view relevant bookings" on public.bookings;
create policy "Customers and managers can view relevant bookings"
  on public.bookings for select to authenticated
  using (
    user_id = (select auth.uid())
    or (select public.user_manages_studio(studio_id))
  );

grant usage on schema public to anon, authenticated;
grant select on public.studios, public.rooms, public.gigs to anon, authenticated;
grant select on public.bookings, public.profiles to authenticated;
grant update (full_name) on public.profiles to authenticated;
grant update (name, city, address, blurb, tags, version) on public.studios to authenticated;
grant insert (studio_id, name, description, hourly_rate) on public.rooms to authenticated;
grant update (name, description, hourly_rate, is_active) on public.rooms to authenticated;
grant delete on public.gigs to authenticated;

create or replace function public.get_room_schedule(p_studio_id uuid, p_date date)
returns table (
  kind text,
  id uuid,
  room_id uuid,
  start_hour smallint,
  end_hour smallint,
  title text,
  act text,
  genre text,
  price numeric,
  mine boolean,
  can_cancel boolean
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_now timestamp := now() at time zone 'Asia/Manila';
begin
  if not exists (select 1 from public.studios where studios.id = p_studio_id and singleton) then
    raise exception 'Studio not found.';
  end if;

  return query
  select
    'booking'::text, b.id, b.room_id, b.start_hour, b.end_hour,
    case when b.user_id = (select auth.uid()) then 'You' else 'Booked' end::text,
    null::text, null::text, null::numeric,
    b.user_id = (select auth.uid()),
    (b.user_id = (select auth.uid()) or public.user_manages_studio(b.studio_id))
      and (b.booking_date > v_now::date or (b.booking_date = v_now::date and b.start_hour > extract(hour from v_now)))
  from public.bookings b
  where b.studio_id = p_studio_id and b.booking_date = p_date and b.status = 'confirmed'
  union all
  select
    'gig'::text, g.id, g.room_id, g.start_hour, g.end_hour, g.title, g.act, g.genre, g.price,
    false, false
  from public.gigs g
  where g.studio_id = p_studio_id and g.event_date = p_date;
end;
$$;

create or replace function public.create_booking(
  p_room_id uuid,
  p_date date,
  p_start_hour smallint,
  p_end_hour smallint,
  p_notes text default ''
)
returns public.bookings
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_room public.rooms%rowtype;
  v_now timestamp := now() at time zone 'Asia/Manila';
  v_booking public.bookings%rowtype;
begin
  if v_user_id is null then raise exception 'Log in to continue.'; end if;
  if p_date < v_now::date then raise exception 'That date has already passed.'; end if;
  if p_date > v_now::date + 90 then raise exception 'You can book up to 90 days ahead.'; end if;
  if p_start_hour < 9 or p_end_hour > 23 or p_end_hour <= p_start_hour then
    raise exception 'Choose a valid time between 09:00 and 23:00.';
  end if;
  if p_end_hour - p_start_hour > 8 then raise exception 'Bookings are limited to 8 hours.'; end if;
  if p_date = v_now::date and p_start_hour <= extract(hour from v_now) then
    raise exception 'That time has already started.';
  end if;
  if char_length(coalesce(p_notes, '')) > 300 then raise exception 'Notes must be 300 characters or fewer.'; end if;

  select * into v_room from public.rooms
  where id = p_room_id and is_active
  for update;
  if not found then raise exception 'Room not found or unavailable.'; end if;
  if not exists (select 1 from public.studios where id = v_room.studio_id and singleton) then
    raise exception 'Studio not found.';
  end if;

  if exists (
    select 1 from public.bookings b
    where b.room_id = p_room_id and b.booking_date = p_date and b.status = 'confirmed'
      and p_start_hour < b.end_hour and b.start_hour < p_end_hour
  ) or exists (
    select 1 from public.gigs g
    where g.room_id = p_room_id and g.event_date = p_date
      and p_start_hour < g.end_hour and g.start_hour < p_end_hour
  ) then
    raise exception 'Part of that time is already taken. Pick another range.';
  end if;

  insert into public.bookings (studio_id, room_id, user_id, booking_date, start_hour, end_hour, hourly_rate, notes)
  values (v_room.studio_id, v_room.id, v_user_id, p_date, p_start_hour, p_end_hour, v_room.hourly_rate, coalesce(p_notes, ''))
  returning * into v_booking;
  return v_booking;
end;
$$;

create or replace function public.cancel_booking(p_booking_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_booking public.bookings%rowtype;
  v_now timestamp := now() at time zone 'Asia/Manila';
begin
  if auth.uid() is null then raise exception 'Log in to continue.'; end if;
  select * into v_booking from public.bookings where id = p_booking_id for update;
  if not found then raise exception 'Booking not found.'; end if;
  if v_booking.user_id is distinct from auth.uid() and not public.user_manages_studio(v_booking.studio_id) then
    raise exception 'You cannot cancel this booking.';
  end if;
  if v_booking.status <> 'confirmed' then raise exception 'That booking is already cancelled.'; end if;
  if v_booking.booking_date < v_now::date
    or (v_booking.booking_date = v_now::date and v_booking.start_hour <= extract(hour from v_now)) then
    raise exception 'Bookings that have already started cannot be cancelled.';
  end if;

  update public.bookings
  set status = 'cancelled', cancelled_at = now(), cancelled_by = auth.uid()
  where id = p_booking_id;
end;
$$;

create or replace function public.create_gig(
  p_room_id uuid,
  p_title text,
  p_act text,
  p_genre text,
  p_price numeric,
  p_date date,
  p_start_hour smallint,
  p_end_hour smallint
)
returns public.gigs
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_room public.rooms%rowtype;
  v_gig public.gigs%rowtype;
  v_studio public.studios%rowtype;
  v_now timestamp := now() at time zone 'Asia/Manila';
begin
  if auth.uid() is null then raise exception 'Log in to continue.'; end if;
  select * into v_room from public.rooms where id = p_room_id and is_active for update;
  if not found then raise exception 'Room not found or unavailable.'; end if;
  if not public.user_manages_studio(v_room.studio_id) then raise exception 'You do not manage this studio.'; end if;
  select * into v_studio from public.studios where id = v_room.studio_id and singleton;
  if not found then raise exception 'Studio not found.'; end if;
  if p_date < v_now::date then raise exception 'That date has already passed.'; end if;
  if p_start_hour < 9 or p_end_hour > 23 or p_end_hour <= p_start_hour then
    raise exception 'Choose a valid time between 09:00 and 23:00.';
  end if;
  if p_price < 0 then raise exception 'Ticket price cannot be negative.'; end if;
  if char_length(p_title) > 100 or char_length(p_act) > 150 or char_length(p_genre) > 40 then
    raise exception 'One or more event fields are too long.';
  end if;

  if exists (
    select 1 from public.bookings b
    where b.room_id = p_room_id and b.booking_date = p_date and b.status = 'confirmed'
      and p_start_hour < b.end_hour and b.start_hour < p_end_hour
  ) or exists (
    select 1 from public.gigs g
    where g.room_id = p_room_id and g.event_date = p_date
      and p_start_hour < g.end_hour and g.start_hour < p_end_hour
  ) then
    raise exception 'Part of that time is already taken. Pick another range.';
  end if;

  insert into public.gigs (studio_id, room_id, title, act, genre, price, event_date, start_hour, end_hour, created_by)
  values (v_studio.id, v_room.id, trim(p_title), trim(p_act), trim(p_genre), p_price, p_date, p_start_hour, p_end_hour, auth.uid())
  returning * into v_gig;
  return v_gig;
end;
$$;

create or replace function public.deactivate_room(p_room_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_room public.rooms%rowtype;
  v_today date := (now() at time zone 'Asia/Manila')::date;
begin
  select * into v_room from public.rooms where id = p_room_id for update;
  if not found then raise exception 'Room not found.'; end if;
  if not public.user_manages_studio(v_room.studio_id) then raise exception 'You do not manage this studio.'; end if;
  if exists (select 1 from public.bookings where room_id = p_room_id and status = 'confirmed' and booking_date >= v_today)
    or exists (select 1 from public.gigs where room_id = p_room_id and event_date >= v_today) then
    raise exception 'This room has upcoming bookings or events. Cancel them first.';
  end if;
  update public.rooms set is_active = false where id = p_room_id;
end;
$$;

create or replace function public.admin_set_profile_role(p_user_id uuid, p_role text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.user_is_admin() then raise exception 'You do not have permission to change user roles.'; end if;
  if p_user_id = auth.uid() then raise exception 'You cannot change your own role.'; end if;
  if p_role not in ('customer', 'owner', 'admin') then raise exception 'Invalid user role.'; end if;
  update public.profiles set role = p_role where id = p_user_id;
  if not found then raise exception 'User not found.'; end if;
end;
$$;

revoke all on function public.handle_new_user() from public, anon, authenticated;
revoke all on function public.user_is_admin() from public, anon;
revoke all on function public.user_manages_studio(uuid) from public, anon;
revoke all on function public.create_booking(uuid, date, smallint, smallint, text) from public, anon;
revoke all on function public.cancel_booking(uuid) from public, anon;
revoke all on function public.create_gig(uuid, text, text, text, numeric, date, smallint, smallint) from public, anon;
revoke all on function public.deactivate_room(uuid) from public, anon;
revoke all on function public.admin_set_profile_role(uuid, text) from public, anon;
grant execute on function public.user_is_admin() to authenticated;
grant execute on function public.user_manages_studio(uuid) to authenticated;
grant execute on function public.user_manages_studio(uuid) to anon;
grant execute on function public.get_room_schedule(uuid, date) to anon, authenticated;
grant execute on function public.create_booking(uuid, date, smallint, smallint, text) to authenticated;
grant execute on function public.cancel_booking(uuid) to authenticated;
grant execute on function public.create_gig(uuid, text, text, text, numeric, date, smallint, smallint) to authenticated;
grant execute on function public.deactivate_room(uuid) to authenticated;
grant execute on function public.admin_set_profile_role(uuid, text) to authenticated;

insert into public.studios (id, name, city, address, blurb, tags)
values (
  '20000000-0000-4000-8000-000000000001',
  'Studizz1',
  'Davao City',
  '18 Acacia Lane, Calinan',
  'A welcoming, thoughtfully equipped space for rehearsals, recording, and good ideas.',
  array['Sound-treated rooms', 'Backline included', 'Air-conditioned']
)
on conflict (id) do nothing;

insert into public.rooms (id, studio_id, name, description, hourly_rate)
values
  ('20000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000001', 'The Live Room', 'Full-band rehearsal · up to 8 people', 550),
  ('20000000-0000-4000-8000-000000000003', '20000000-0000-4000-8000-000000000001', 'The Writing Room', 'Acoustic sets · up to 4 people', 350),
  ('20000000-0000-4000-8000-000000000004', '20000000-0000-4000-8000-000000000001', 'The Booth', 'Vocals, voice-over, and demos', 400)
on conflict (id) do nothing;

insert into public.gigs (studio_id, room_id, title, act, genre, price, event_date, start_hour, end_hour)
select s.id, r.id, 'Studizz1 Open Mic', 'A friendly night for local voices', 'Mixed', 150, current_date + 2, 19, 22
from public.studios s join public.rooms r on r.studio_id = s.id and r.name = 'The Live Room'
where s.id = '20000000-0000-4000-8000-000000000001'
  and not exists (select 1 from public.gigs where title = 'Studizz1 Open Mic' and studio_id = s.id);

insert into public.gigs (studio_id, room_id, title, act, genre, price, event_date, start_hour, end_hour)
select s.id, r.id, 'Acoustic Room Sessions', 'Mara Quinn and guests', 'Acoustic', 250, current_date + 6, 18, 21
from public.studios s join public.rooms r on r.studio_id = s.id and r.name = 'The Writing Room'
where s.id = '20000000-0000-4000-8000-000000000001'
  and not exists (select 1 from public.gigs where title = 'Acoustic Room Sessions' and studio_id = s.id);

select table_name
from information_schema.tables
where table_schema = 'public'
  and table_name in ('profiles', 'studios', 'rooms', 'bookings', 'gigs')
order by table_name;
