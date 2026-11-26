-- Consent records: the AI notice, Scribe recording consent, the patient-permission answer.
-- A member can add their own records and the family can read them; nobody edits or deletes them.
create table if not exists consents (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references households(id) on delete cascade,
  user_id uuid not null default auth.uid(),
  type text not null check (type in ('ai_notice', 'scribe_visit', 'patient_authority', 'terms')),
  version text not null default '1',
  detail jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index if not exists consents_household on consents (household_id, created_at);
alter table consents enable row level security;
create policy consents_read on consents for select using (household_id in (select my_household_ids()));
create policy consents_add on consents for insert with check (household_id in (select my_household_ids()) and user_id = auth.uid());
