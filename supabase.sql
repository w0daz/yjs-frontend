-- Rooms table
create table if not exists public.rooms (
  id uuid primary key default gen_random_uuid(),
  key text unique not null,
  owner_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

-- Room membership table
create table if not exists public.room_members (
  room_id uuid not null references public.rooms(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text default 'editor',
  created_at timestamptz not null default now(),
  primary key (room_id, user_id)
);

alter table public.rooms enable row level security;
alter table public.room_members enable row level security;

-- Rooms can be created by the authenticated owner.
create policy "Rooms: insert own" on public.rooms
  for insert
  with check (auth.uid() = owner_id);

-- Owners and members can read room metadata.
create policy "Rooms: select member" on public.rooms
  for select
  using (
    auth.uid() = owner_id
    or exists (
      select 1 from public.room_members rm
      where rm.room_id = rooms.id
        and rm.user_id = auth.uid()
    )
  );

-- Members can read their own membership rows.
create policy "Room members: select own" on public.room_members
  for select
  using (auth.uid() = user_id);

-- Members can join themselves.
create policy "Room members: insert self" on public.room_members
  for insert
  with check (auth.uid() = user_id);

-- Join by key using an RPC to avoid exposing all rooms.
create or replace function public.join_room_by_key(p_key text)
returns uuid
language plpgsql
security definer
as $$
declare
  v_room_id uuid;
begin
  select id into v_room_id from public.rooms where key = p_key;
  if v_room_id is null then
    raise exception 'room-not-found';
  end if;

  insert into public.room_members (room_id, user_id)
  values (v_room_id, auth.uid())
  on conflict do nothing;

  return v_room_id;
end;
$$;

grant execute on function public.join_room_by_key(text) to authenticated;
