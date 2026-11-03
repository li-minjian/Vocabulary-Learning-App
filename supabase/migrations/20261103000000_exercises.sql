-- Additive only. Historical initial_schema.sql must never be replayed.
begin;
create table public.exercise_sets (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
 title text not null check(length(title) between 1 and 200),
 collection_id uuid references public.collections(id) on delete set null,
 source_filename text not null default '', source_digest text not null default '',
 created_at timestamptz not null default now(), unique(id,user_id)
);
create table public.exercises (
 id uuid primary key, user_id uuid not null references auth.users(id) on delete cascade,
 set_id uuid not null, source_key text not null, content_hash text not null,
 position integer not null, category text not null default '', unit text not null default '', source_deck text not null default '',
 document jsonb not null check(jsonb_typeof(document)='object'),
 total_attempts integer not null default 0 check(total_attempts>=0), correct_attempts integer not null default 0 check(correct_attempts>=0 and correct_attempts<=total_attempts),
 last_practiced timestamptz, next_review timestamptz, learning_state text not null default 'new',
 created_at timestamptz not null default now(), unique(id,user_id), unique(user_id,source_key),
 foreign key(set_id,user_id) references public.exercise_sets(id,user_id) on delete cascade
);
create table public.exercise_sessions (
 id uuid primary key, user_id uuid not null references auth.users(id) on delete cascade,
 exercise_ids jsonb not null check(jsonb_typeof(exercise_ids)='array' and jsonb_array_length(exercise_ids) between 1 and 200),
 config jsonb not null default '{}', position integer not null default 0 check(position>=0 and position<=jsonb_array_length(exercise_ids)),
 status text not null default 'active' check(status in ('active','finished','ended')),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(id,user_id)
);
create table public.exercise_attempts (
 id uuid primary key, user_id uuid not null references auth.users(id) on delete cascade,
 exercise_id uuid not null, session_id uuid not null,
 answers jsonb not null default '[]', result jsonb not null, correct boolean,
 revealed boolean not null default false, rating text check(rating in ('again','hard','good','easy','skip')),
 created_at timestamptz not null default now(), rated_at timestamptz,
 unique(session_id,exercise_id),
 foreign key(exercise_id,user_id) references public.exercises(id,user_id) on delete cascade,
 foreign key(session_id,user_id) references public.exercise_sessions(id,user_id) on delete cascade
);
create index exercise_sets_owner on public.exercise_sets(user_id,created_at,id);
create index exercise_sets_collection on public.exercise_sets(collection_id);
create index exercises_owner_due on public.exercises(user_id,next_review,id);
create index exercises_set_order on public.exercises(set_id,user_id,position,id);
create index exercise_sessions_owner on public.exercise_sessions(user_id,updated_at,id);
create index exercise_attempts_history on public.exercise_attempts(user_id,exercise_id,created_at);

alter table public.exercise_sets enable row level security;
alter table public.exercises enable row level security;
alter table public.exercise_sessions enable row level security;
alter table public.exercise_attempts enable row level security;
create policy exercise_sets_read on public.exercise_sets for select to authenticated using ((select auth.uid())=user_id);
create policy exercise_sets_insert on public.exercise_sets for insert to authenticated with check ((select auth.uid())=user_id and (collection_id is null or exists(select 1 from public.collections c where c.id=collection_id and c.user_id=(select auth.uid()))));
create policy exercise_sets_update on public.exercise_sets for update to authenticated using ((select auth.uid())=user_id) with check ((select auth.uid())=user_id and (collection_id is null or exists(select 1 from public.collections c where c.id=collection_id and c.user_id=(select auth.uid()))));
create policy exercise_sets_delete on public.exercise_sets for delete to authenticated using ((select auth.uid())=user_id);
create policy exercises_read on public.exercises for select to authenticated using ((select auth.uid())=user_id);
create policy exercises_insert on public.exercises for insert to authenticated with check ((select auth.uid())=user_id);
create policy exercises_update on public.exercises for update to authenticated using ((select auth.uid())=user_id) with check ((select auth.uid())=user_id);
create policy exercises_delete on public.exercises for delete to authenticated using ((select auth.uid())=user_id);
create policy exercise_sessions_read on public.exercise_sessions for select to authenticated using ((select auth.uid())=user_id);
create policy exercise_sessions_insert on public.exercise_sessions for insert to authenticated with check ((select auth.uid())=user_id);
create policy exercise_sessions_update on public.exercise_sessions for update to authenticated using ((select auth.uid())=user_id) with check ((select auth.uid())=user_id);
create policy exercise_sessions_delete on public.exercise_sessions for delete to authenticated using ((select auth.uid())=user_id);
create policy exercise_attempts_read on public.exercise_attempts for select to authenticated using ((select auth.uid())=user_id);
create policy exercise_attempts_insert on public.exercise_attempts for insert to authenticated with check ((select auth.uid())=user_id);
create policy exercise_attempts_update on public.exercise_attempts for update to authenticated using ((select auth.uid())=user_id) with check ((select auth.uid())=user_id);
create policy exercise_attempts_delete on public.exercise_attempts for delete to authenticated using ((select auth.uid())=user_id);
grant select,insert,update,delete on public.exercise_sets,public.exercises,public.exercise_sessions,public.exercise_attempts to authenticated;
revoke all on public.exercise_sets,public.exercises,public.exercise_sessions,public.exercise_attempts from anon;

-- One transaction/row lock owns attempts, progress and session advancement.
-- Invoker privileges keep every underlying operation under the caller's RLS.
create function public.record_exercise_attempt(p_session uuid,p_exercise uuid,p_action text,p_data jsonb)
returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare s public.exercise_sessions; e public.exercises; a public.exercise_attempts; r text; days integer;
begin
 select * into s from public.exercise_sessions where id=p_session and user_id=auth.uid() for update;
 if not found then raise exception 'Session unavailable'; end if;
 select * into e from public.exercises where id=p_exercise and user_id=auth.uid() for update;
 if not found or not s.exercise_ids @> jsonb_build_array(p_exercise::text) then raise exception 'Exercise unavailable'; end if;
 select * into a from public.exercise_attempts where session_id=p_session and exercise_id=p_exercise and user_id=auth.uid();
 if p_action='answer' then
  if a.id is not null then return to_jsonb(a); end if;
  if s.status<>'active' or s.exercise_ids->>s.position <> p_exercise::text then raise exception 'Session position changed'; end if;
  insert into public.exercise_attempts(id,user_id,exercise_id,session_id,answers,result,correct,revealed)
  values((p_data->>'id')::uuid,auth.uid(),p_exercise,p_session,p_data->'answers',p_data->'result',(p_data->>'correct')::boolean,(p_data->>'revealed')::boolean) returning * into a;
  update public.exercise_sessions set updated_at=now() where id=s.id and user_id=auth.uid();
  update public.exercises set total_attempts=total_attempts+1,correct_attempts=correct_attempts+case when a.correct then 1 else 0 end,last_practiced=now(),learning_state='learning',next_review=coalesce(next_review,now()) where id=e.id and user_id=auth.uid();
 elsif p_action='rate' then
  if a.id is null then raise exception 'Check or reveal the answer first'; end if;
  if a.rated_at is not null then return to_jsonb(a); end if;
  r=p_data->>'rating';
  if r not in ('again','hard','good','easy','skip') or r is null then raise exception 'Invalid rating'; end if;
  if s.status<>'active' or s.exercise_ids->>s.position <> p_exercise::text then raise exception 'Session position changed'; end if;
  update public.exercise_attempts set rating=r,rated_at=now() where id=a.id and user_id=auth.uid() returning * into a;
  days=case r when 'hard' then 1 when 'good' then 3 when 'easy' then 5 else 0 end;
  update public.exercises set total_attempts=total_attempts-case when r='skip' then 1 else 0 end,correct_attempts=correct_attempts-case when r='skip' and a.correct then 1 else 0 end,next_review=case when r='skip' then case when total_attempts=1 then null else next_review end when r='again' then now()+interval '10 minutes' else now()+make_interval(days=>days*greatest(total_attempts,1)) end,learning_state=case when r='skip' and total_attempts=1 then 'new' when r in ('skip','again','hard') then 'learning' when r='good' then 'familiar' else 'mastered' end where id=e.id and user_id=auth.uid();
  update public.exercise_sessions set position=position+1,status=case when position+1>=jsonb_array_length(exercise_ids) then 'finished' else 'active' end,updated_at=now() where id=s.id and user_id=auth.uid();
 else raise exception 'Invalid action'; end if;
 return to_jsonb(a);
end $$;
revoke all on function public.record_exercise_attempt(uuid,uuid,text,jsonb) from public,anon;
grant execute on function public.record_exercise_attempt(uuid,uuid,text,jsonb) to authenticated;
notify pgrst,'reload schema';
commit;
