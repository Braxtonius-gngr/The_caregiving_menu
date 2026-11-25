-- A person reads their own reports and data requests only while they are still in that family.
-- (Before this, someone who left could still read the reports they had sent, including what the
-- AI said about the patient.) Owners and the app maker are unchanged.
drop policy if exists reports_read on reports;
create policy reports_read on reports for select using (
  household_id in (select my_owned_household_ids())
  or (user_id = auth.uid() and household_id in (select my_household_ids()))
  or is_app_admin());

drop policy if exists data_requests_read on data_requests;
create policy data_requests_read on data_requests for select using (
  household_id in (select my_owned_household_ids())
  or (user_id = auth.uid() and household_id in (select my_household_ids())));
