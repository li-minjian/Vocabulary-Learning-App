-- Additive: vocabulary receipts supply retry safety and actual activity, not a second SRS.
begin;
create table public.vocabulary_attempts (
 id uuid primary key, user_id uuid not null references auth.users(id) on delete cascade,
 session_id uuid not null, word_id uuid not null references public.words(id) on delete cascade,
 mode text not null check(mode in ('review','practice')),
 format text not null check(format in ('flashcard','multipleChoice','spelling')),
 rating text not null check(rating in ('again','hard','good','easy')),
 correct boolean, revealed boolean not null, created_at timestamptz not null default now(),
 unique(user_id,session_id,word_id)
);
create index vocabulary_attempts_activity on public.vocabulary_attempts(user_id,created_at);
create index vocabulary_attempts_word on public.vocabulary_attempts(user_id,word_id);
alter table public.vocabulary_attempts enable row level security;
create policy vocabulary_attempts_read on public.vocabulary_attempts for select to authenticated using(user_id=(select auth.uid()));
create policy vocabulary_attempts_insert on public.vocabulary_attempts for insert to authenticated with check(user_id=(select auth.uid()) and exists(select 1 from public.words w where w.id=word_id and w.user_id=(select auth.uid())));
create policy vocabulary_attempts_delete on public.vocabulary_attempts for delete to authenticated using(user_id=(select auth.uid()));
revoke all on public.vocabulary_attempts from public,anon,authenticated;
grant select,insert,delete on public.vocabulary_attempts to authenticated;

create function public.learning_scope(p_collection text default 'all') returns text
language plpgsql stable security invoker set search_path=public,pg_temp as $$
begin
 if auth.uid() is null then raise exception 'Authentication required'; end if;
 if p_collection in ('all','unassigned') then return p_collection; end if;
 if not exists(select 1 from public.collections where id::text=p_collection and user_id=auth.uid()) then raise exception 'Collection unavailable'; end if;
 return p_collection;
end $$;

create function public.record_vocabulary_attempt(p_id uuid,p_session uuid,p_word uuid,p_mode text,p_format text,p_rating text,p_response text default null,p_revealed boolean default true)
returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare w public.words; a public.vocabulary_attempts; n integer; days integer; result boolean;
begin
 select * into w from public.words where id=p_word and user_id=auth.uid() for update;
 if not found then raise exception 'Word unavailable'; end if;
 select * into a from public.vocabulary_attempts where user_id=auth.uid() and session_id=p_session and word_id=p_word;
 if found then return to_jsonb(a); end if;
 if p_mode not in ('review','practice') or p_format not in ('flashcard','multipleChoice','spelling') or p_rating not in ('again','hard','good','easy') then raise exception 'Invalid study configuration'; end if;
 result=case when p_format='flashcard' or p_revealed then null else lower(trim(p_response))=lower(trim(w.word)) end;
 insert into public.vocabulary_attempts(id,user_id,session_id,word_id,mode,format,rating,correct,revealed)
 values(p_id,auth.uid(),p_session,p_word,p_mode,p_format,p_rating,result,p_revealed) returning * into a;
 if p_mode='review' then
  n=coalesce(w.review_count,0)+1;
  days=case p_rating when 'again' then 0 when 'hard' then n when 'good' then 3*n else 5*n end;
  update public.words set review_count=n,mastery=case p_rating when 'good' then 'Familiar' when 'easy' then 'Mastered' else 'Learning' end,next_review=now()+make_interval(days=>days) where id=w.id and user_id=auth.uid();
 end if;
 return to_jsonb(a);
end $$;

create function public.vocabulary_queue(p_collection text default 'all',p_limit integer default 20,p_mode text default 'review',p_include_unscheduled boolean default true)
returns jsonb language plpgsql stable security invoker set search_path=public,pg_temp as $$
begin
 perform public.learning_scope(p_collection);
 if p_limit not between 1 and 200 or p_mode not in ('review','practice') then raise exception 'Invalid queue'; end if;
 return coalesce((select jsonb_agg(to_jsonb(q)) from (
  select w.* from public.words w where user_id=auth.uid()
  and (p_collection='all' or (p_collection='unassigned' and collection_id is null) or collection_id::text=p_collection)
  and (p_mode='practice' or (coalesce(review_count,0)>0 and (next_review is null or next_review<=now())) or (p_include_unscheduled and coalesce(review_count,0)=0 and (next_review is null or next_review<=now())))
  order by next_review nulls first,id limit p_limit
 ) q),'[]'::jsonb);
end $$;

create function public.exercise_set_summaries() returns jsonb language sql stable security invoker set search_path=public,pg_temp as $$
 select coalesce(jsonb_agg(to_jsonb(q) order by q.created_at desc,q.id),'[]'::jsonb) from (
 select s.*,count(e.id) as count,count(e.id) filter(where e.total_attempts>0) as completed,
 count(e.id) filter(where e.total_attempts>0 and (e.next_review is null or e.next_review<=now())) as due,
 max(e.last_practiced) as last_practiced,coalesce(jsonb_agg(distinct e.document->>'kind') filter(where e.id is not null),'[]'::jsonb) as content_types
 from public.exercise_sets s left join public.exercises e on e.set_id=s.id and e.user_id=auth.uid()
 where s.user_id=auth.uid() group by s.id
 ) q;
$$;

create function public.learning_summary(p_collection text default 'all',p_set uuid default null,p_category text default '',p_unit text default '',p_deck text default '',p_timezone text default 'UTC')
returns jsonb language plpgsql stable security invoker set search_path=public,pg_temp as $$
declare result jsonb; tz text;
begin
 perform public.learning_scope(p_collection);
 if p_set is not null and not exists(select 1 from public.exercise_sets where id=p_set and user_id=auth.uid() and (p_collection='all' or (p_collection='unassigned' and collection_id is null) or collection_id::text=p_collection)) then raise exception 'Exercise Set unavailable in this Collection'; end if;
 select name into tz from pg_timezone_names where name=p_timezone;
 if tz is null then raise exception 'Invalid time zone'; end if;
 with w as (
 select * from public.words where user_id=auth.uid() and (p_collection='all' or (p_collection='unassigned' and collection_id is null) or collection_id::text=p_collection)
 ), e as (
 select e.* from public.exercises e join public.exercise_sets s on s.id=e.set_id and s.user_id=auth.uid()
 where e.user_id=auth.uid() and (p_collection='all' or (p_collection='unassigned' and s.collection_id is null) or s.collection_id::text=p_collection)
 and (p_set is null or s.id=p_set) and (p_category='' or e.category=p_category) and (p_unit='' or e.unit=p_unit) and (p_deck='' or e.source_deck=p_deck)
 ), va as (select a.* from public.vocabulary_attempts a join w on w.id=a.word_id where a.user_id=auth.uid()),
 ea as (select a.* from public.exercise_attempts a join e on e.id=a.exercise_id where a.user_id=auth.uid() and a.rating is distinct from 'skip')
 select jsonb_build_object(
 'vocabulary',jsonb_build_object('total',(select count(*) from w),'new',(select count(*) from w where coalesce(review_count,0)=0 and not exists(select 1 from va where va.word_id=w.id)),
 'due',(select count(*) from w where coalesce(review_count,0)>0 and (next_review is null or next_review<=now())),
 'unscheduled',(select count(*) from w where coalesce(review_count,0)=0 and (next_review is null or next_review<=now())),
 'mastered',(select count(*) from w where mastery='Mastered'),'learning',(select count(*) from w where mastery in ('Learning','Familiar')),
 'reviews',(select coalesce(sum(review_count),0) from w),'attempts',(select count(*) from va),'correct',(select count(*) from va where correct is true),'incorrect',(select count(*) from va where correct is false),
 'self_assessed',(select count(*) from va where correct is null),'added_today',(select count(*) from w where (created_at at time zone tz)::date=(now() at time zone tz)::date),'added_this_week',(select count(*) from w where created_at>=now()-interval '7 days')),
 'exercises',jsonb_build_object('total',(select count(*) from e),'new',(select count(*) from e where total_attempts=0),'practiced',(select count(*) from e where total_attempts>0),
 'due',(select count(*) from e where total_attempts>0 and (next_review is null or next_review<=now())),
 'attempts',(select count(*) from ea),'correct',(select count(*) from ea where correct is true),'incorrect',(select count(*) from ea where correct is false),'self_assessed',(select count(*) from ea where correct is null)),
 'languages',(select coalesce(jsonb_agg(to_jsonb(l)),'[]'::jsonb) from (select language as name,count(*) as count from w group by language order by count(*) desc) l),
 'activity',(select jsonb_agg(jsonb_build_object('day',to_char(d,'Dy'),'date',d::date,'vocabulary',(select count(*) from va where (created_at at time zone tz)::date=d::date),'exercises',(select count(*) from ea where (created_at at time zone tz)::date=d::date))) from generate_series((now() at time zone tz)::date-6,(now() at time zone tz)::date,interval '1 day') d),
 'timezone',tz,'as_of',now()) into result;
 return result;
end $$;

create function public.exercise_queue(p_collection text default 'all',p_set uuid default null,p_mode text default 'all',p_limit integer default 20,p_category text default '',p_unit text default '',p_deck text default '')
returns jsonb language plpgsql stable security invoker set search_path=public,pg_temp as $$
begin
 perform public.learning_scope(p_collection);
 if p_mode not in ('all','new','due') or p_limit not between 1 and 200 then raise exception 'Invalid queue'; end if;
 if p_set is not null and not exists(select 1 from public.exercise_sets where id=p_set and user_id=auth.uid() and (p_collection='all' or (p_collection='unassigned' and collection_id is null) or collection_id::text=p_collection)) then raise exception 'Exercise Set unavailable in this Collection'; end if;
 return coalesce((select jsonb_agg(id::text) from (select e.id from public.exercises e join public.exercise_sets s on s.id=e.set_id and s.user_id=auth.uid()
 where e.user_id=auth.uid() and (p_collection='all' or (p_collection='unassigned' and s.collection_id is null) or s.collection_id::text=p_collection)
 and (p_set is null or s.id=p_set) and (p_category='' or e.category=p_category) and (p_unit='' or e.unit=p_unit) and (p_deck='' or e.source_deck=p_deck)
 and (p_mode='all' or (p_mode='new' and e.total_attempts=0) or (p_mode='due' and e.total_attempts>0 and (e.next_review is null or e.next_review<=now())))
 order by e.next_review nulls first,e.position,e.id limit p_limit) q),'[]'::jsonb);
end $$;
revoke all on function public.exercise_queue(text,uuid,text,integer,text,text,text) from public,anon;
grant execute on function public.exercise_queue(text,uuid,text,integer,text,text,text) to authenticated;

revoke all on function public.learning_scope(text),public.record_vocabulary_attempt(uuid,uuid,uuid,text,text,text,text,boolean),public.vocabulary_queue(text,integer,text,boolean),public.exercise_set_summaries(),public.learning_summary(text,uuid,text,text,text,text) from public,anon;
grant execute on function public.learning_scope(text),public.record_vocabulary_attempt(uuid,uuid,uuid,text,text,text,text,boolean),public.vocabulary_queue(text,integer,text,boolean),public.exercise_set_summaries(),public.learning_summary(text,uuid,text,text,text,text) to authenticated;
notify pgrst,'reload schema';
commit;
