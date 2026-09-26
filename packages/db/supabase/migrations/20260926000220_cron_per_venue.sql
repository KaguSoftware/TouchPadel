set lock_timeout = '3s';
set statement_timeout = '60s';

-- 0220_cron_per_venue — multi-venue slice 3, step 6.
--
-- Two cron bodies wrote their audit row with no caller and no asserted venue,
-- so app.write_audit's audit_log.venue_id default (current_venue_or_default,
-- 0126) filed it at the default branch whatever branch the rows belonged to:
--   hiring_purge_due (0176)    now asserts the purged run's branch
--   incident_purge_due (0198)  now asserts the branch it is purging
-- (flag_expired_batches was made per branch in 0214; sweep_degraded_periods in
-- 0139; assistant_prewarm_nudge runs on the chain's clock since 0207.)

-- hiring_purge_due: re-issued from 20260925000176_hiring.sql:594
create or replace function app.hiring_purge_due()
returns jsonb
language plpgsql security definer set search_path = public as $hiring_purge_due_0220$
declare
  c_marker     constant text := '[deleted after 90 days]';
  v_run        record;
  v_candidates int := 0;
  v_runs       int := 0;
  v_notes      int;
  v_skips      int;
  v_stops      int;
  v_records    int;
begin
  for v_run in
    select c.run_id, count(*)::int as n
      from hiring_candidates c
     where c.purge_after <= now()
     group by c.run_id
     order by c.run_id
  loop
    -- 0220: the audit row below is filed at the run's branch.
    perform set_config('app.venue_id', (select pr.venue_id from protocol_runs pr where pr.id = v_run.run_id)::text, true);
    delete from hiring_candidates where run_id = v_run.run_id and purge_after <= now();

    update protocol_submissions
       set decision_note = c_marker
     where run_id = v_run.run_id and decision_note is not null and decision_note <> c_marker;
    get diagnostics v_notes = row_count;
    update protocol_run_steps
       set skip_note = c_marker
     where run_id = v_run.run_id and skip_note is not null and skip_note <> c_marker;
    get diagnostics v_skips = row_count;
    update protocol_runs
       set stop_reason = c_marker
     where id = v_run.run_id and stop_reason is not null and stop_reason <> c_marker;
    get diagnostics v_stops = row_count;
    update protocol_submissions x
       set record = x.record - 'note'
      from protocol_run_steps s
     where s.id = x.run_step_id and s.step_key is null
       and x.run_id = v_run.run_id and x.record ? 'note';
    get diagnostics v_records = row_count;
    update protocol_runs
       set data = data || jsonb_build_object('candidates_purged_at', now())
     where id = v_run.run_id;

    perform app.write_audit('protocol.hiring.purge', 'protocol_run', v_run.run_id::text, null,
      jsonb_build_object('candidates', v_run.n, 'decision_notes', v_notes, 'skip_notes', v_skips,
                         'stop_reason', v_stops, 'step_notes', v_records));
    v_candidates := v_candidates + v_run.n;
    v_runs := v_runs + 1;
  end loop;

  return jsonb_build_object('candidates', v_candidates, 'runs', v_runs);
end $hiring_purge_due_0220$;

-- incident_purge_due: re-issued from 20260926000198_incident_reports.sql:537
create or replace function app.incident_purge_due()
returns jsonb
language plpgsql security definer set search_path = public as $incident_purge_due_0220$
declare
  c_marker constant text := '[deleted after 365 days]';
  v        record;
  v_total  int := 0;
begin
  -- A note written after a redaction is still text to remove.
  for v in
    select i.venue_id, count(*)::int as n
      from incident_reports i
     where i.purge_after <= now()
       and (i.text_purged_at is null or i.review_note is not null)
     group by i.venue_id
     order by i.venue_id
  loop
    update incident_reports
       set description     = case when text_purged_at is null then c_marker else description end,
           people_involved = null,
           place_detail    = null,
           review_note     = null,
           text_purged_at  = coalesce(text_purged_at, now())
     where venue_id = v.venue_id
       and purge_after <= now()
       and (text_purged_at is null or review_note is not null);

    perform set_config('app.venue_id', v.venue_id::text, true);   -- 0220
    perform app.write_audit('incident.purge', 'venue', v.venue_id::text, null,
                            jsonb_build_object('incidents', v.n));
    v_total := v_total + v.n;
  end loop;

  return jsonb_build_object('incidents', v_total);
end $incident_purge_due_0220$;

