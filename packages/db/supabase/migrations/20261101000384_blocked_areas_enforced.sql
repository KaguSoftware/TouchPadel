-- 0384 blocked_areas_enforced — a blocked page is blocked on the server too
-- (launch finding F-16, Majed 2026-11-01: "Blocked pages are always blocked,
-- no exceptions: enforce staff.blocked_areas on the phone AND on the server").
--
-- 0345 made staff.blocked_areas a screen rule: the operator and the phone kept
-- a person out of a page the owner unticked, but every RPC behind that page
-- still answered, so a blocked person could do the page's work by calling the
-- RPC directly. From here the API refuses it.
--
-- HOW. One gate in front of every client call instead of a re-issue of some
-- 440 function bodies: PostgREST's pre-request hook. app.pre_request() runs
-- before each API request (the operator, the phone, and the replay and
-- receipt-scan edge functions, which call RPCs with the caller's JWT). For a
-- call to /rpc/<name> it looks <name> up in app.access_area_rpcs, the pages
-- (packages/core/src/staff/access.ts ACCESS_AREAS keys) whose work the RPC
-- is, and refuses with AREA_BLOCKED (P0001, detail the RPC) when the caller is
-- active staff, not the owner, and has EVERY one of those pages blocked. An
-- RPC two pages share stays open while either page is open (blocking Till
-- leaves the desk's open_tab working); an RPC no page owns (the shell's
-- heartbeat, PINs, shifts, a person's own lists, the guest app's calls) is
-- never refused. Owners have no blocks. Service-role and cron work (no
-- auth.uid()) is never refused.
--
-- THE MAP. app.access_area_rpcs is data: which RPCs each page's screens call,
-- derived on 2026-11-01 from the operator's routes (each route's component
-- tree, by ROUTE_ROLES key, through lib/auth.tsx areaOfRouteKey), the staff
-- phone's area screens (incidents, suggestions, deductions, stock, content)
-- and the offline queue's types (lib/mutate.ts DIRECT_RPC). An RPC is mapped
-- only when no other surface reaches it (the shell, another non-area page, the
-- guest app, the web). A later page or RPC is added by a migration that
-- inserts rows; tests/blocked-areas.test.ts holds the area keys to
-- ACCESS_AREAS, every row to an existing function and every area to at least
-- one RPC.
--
-- Edge functions that write with the service role check the same rule in
-- requireStaffRole (_shared/auth.ts, opts.areas): desk-customer-create
-- (customers) and receipt-scan (receipts: stock and shop; slips: till).
--
-- THE HOOK is the authenticator role's pgrst.db_pre_request setting
-- (Supabase: "Enforce additional rules on each request"), followed by
-- NOTIFY pgrst 'reload config'. If the setting cannot be made the migration
-- fails (F-55: a setup step never fails quietly), and 0386's setup check
-- reports it if it is ever removed. app.pre_request never fails a request
-- for its own sake: a fault inside it lets the request through (the RPC's
-- role and branch guards still apply) rather than taking the whole API down.
--
-- covered by packages/db/tests/blocked-areas.test.ts

set lock_timeout = '3s';
set statement_timeout = '60s';

-- ---------------------------------------------------------------------------
-- 1. The map.
-- ---------------------------------------------------------------------------
create table if not exists app.access_area_rpcs (
  area text not null,
  rpc  text not null,
  primary key (rpc, area),
  constraint access_area_rpcs_area_chk
    check (area in ('till', 'desk', 'customers', 'tournaments', 'kds', 'shop', 'tasks',
                    'insights', 'content', 'incidents', 'ops', 'stock', 'admin', 'reports',
                    'protocols', 'suggestions', 'deductions', 'attendance')),
  constraint access_area_rpcs_rpc_chk check (rpc ~ '^[a-z][a-z0-9_]*$')
);

comment on table app.access_area_rpcs is
  '0384 (F-16). The pages (ACCESS_AREAS keys, packages/core/src/staff/access.ts) whose work each RPC is. app.pre_request refuses an RPC to a non-owner staff member who has every one of its pages in staff.blocked_areas (AREA_BLOCKED). Data, not code: a migration adds rows for a new page or RPC.';

alter table app.access_area_rpcs enable row level security;
revoke all on table app.access_area_rpcs from public, anon, authenticated;

insert into app.access_area_rpcs (area, rpc) values
  -- admin
  ('admin', 'add_coach_time_off'), ('admin', 'cancel_coach_time_off'), ('admin', 'checklist_day_state'),
  ('admin', 'close_day'), ('admin', 'coach_promote'), ('admin', 'coach_statement_detail'),
  ('admin', 'coaches_admin'), ('admin', 'coaching_settings'), ('admin', 'customer_lessons'),
  ('admin', 'customer_record'), ('admin', 'day_close_online'), ('admin', 'day_close_shop'),
  ('admin', 'delete_court'), ('admin', 'desk_coach_schedule'), ('admin', 'desk_lesson_detail'),
  ('admin', 'desk_lessons'), ('admin', 'desk_match_detail'), ('admin', 'desk_match_states'),
  ('admin', 'desk_open_matches'), ('admin', 'generate_promo_code'), ('admin', 'guest_hold_standing'),
  ('admin', 'guest_tickets'), ('admin', 'hold_reviews'), ('admin', 'hold_standing_decide'),
  ('admin', 'lesson_refunds_due'), ('admin', 'link_item_modifier_group'), ('admin', 'main_cash_day_boxes'),
  ('admin', 'main_cash_hand_in_day'), ('admin', 'match_reports_open'), ('admin', 'match_settings'),
  ('admin', 'open_day'), ('admin', 'reorder_courts'), ('admin', 'reorder_menu_categories'),
  ('admin', 'reorder_menu_items'), ('admin', 'reorder_modifiers'), ('admin', 'report_coach_statements'),
  ('admin', 'rotate_table_token'), ('admin', 'set_addon_suggestions'), ('admin', 'set_category_photo'),
  ('admin', 'set_coach_branches'), ('admin', 'set_coach_hours'), ('admin', 'set_coach_lesson_types'),
  ('admin', 'set_coach_price'), ('admin', 'set_coach_status'), ('admin', 'set_coaching_settings'),
  ('admin', 'set_item_availability'), ('admin', 'set_item_cost'), ('admin', 'set_item_photo'),
  ('admin', 'set_item_sold_out'), ('admin', 'set_modifier_reveals'), ('admin', 'set_opening_hours'),
  ('admin', 'set_promotion_enabled'), ('admin', 'set_table_bell'), ('admin', 'storage_path_in_use'),
  ('admin', 'table_qr_tokens'), ('admin', 'unpaid_played_bookings'), ('admin', 'upsert_cafe_table'),
  ('admin', 'upsert_court'), ('admin', 'upsert_court_gender_rule'), ('admin', 'upsert_lesson_type'),
  ('admin', 'upsert_menu_category'), ('admin', 'upsert_menu_item'), ('admin', 'upsert_modifier'),
  ('admin', 'upsert_modifier_group'), ('admin', 'upsert_promotion'), ('admin', 'upsert_rate_rule'),
  ('admin', 'upsert_variant'),
  -- attendance
  ('attendance', 'attendance_month'), ('attendance', 'clear_attendance'), ('attendance', 'record_attendance'),
  -- content
  ('content', 'content_detail'), ('content', 'content_page'), ('content', 'decide_content'),
  ('content', 'decide_marketing_plan'), ('content', 'marketing_plan'), ('content', 'remove_plan_idea'),
  ('content', 'revise_content'), ('content', 'save_plan_idea'), ('content', 'send_marketing_plan'),
  ('content', 'submit_content'), ('content', 'take_back_marketing_plan'), ('content', 'withdraw_content'),
  -- customers
  ('customers', 'add_customer_note'), ('customers', 'apply_customer_court_discount'), ('customers', 'apply_customer_discount'),
  ('customers', 'bill_customer_discount'), ('customers', 'coach_statement_detail'), ('customers', 'coaches_admin'),
  ('customers', 'coaching_settings'), ('customers', 'customer_directory'), ('customers', 'customer_discount'),
  ('customers', 'customer_lessons'), ('customers', 'customer_record'), ('customers', 'desk_coach_schedule'),
  ('customers', 'desk_lesson_detail'), ('customers', 'desk_lessons'), ('customers', 'desk_match_detail'),
  ('customers', 'desk_match_states'), ('customers', 'desk_open_matches'), ('customers', 'edit_customer_note'),
  ('customers', 'guest_hold_standing'), ('customers', 'guest_tickets'), ('customers', 'hold_reviews'),
  ('customers', 'hold_standing_decide'), ('customers', 'lesson_refunds_due'), ('customers', 'lesson_settle'),
  ('customers', 'loyalty_adjust'), ('customers', 'loyalty_admin'), ('customers', 'loyalty_customer'),
  ('customers', 'loyalty_identify'), ('customers', 'loyalty_redeem'), ('customers', 'loyalty_till_terms'),
  ('customers', 'loyalty_unredeem'), ('customers', 'match_reports_open'), ('customers', 'match_settings'),
  ('customers', 'report_coach_statements'), ('customers', 'set_customer_discount'), ('customers', 'set_customer_flags'),
  ('customers', 'set_match_ban'), ('customers', 'set_tab_customer'), ('customers', 'staff_set_customer_gender'),
  ('customers', 'ticket_cashout'),
  -- deductions
  ('deductions', 'cancel_deduction'), ('deductions', 'decide_deduction'), ('deductions', 'deduction_targets'),
  ('deductions', 'deductions_month'), ('deductions', 'deductions_page'), ('deductions', 'my_deduction_proposals'),
  ('deductions', 'propose_deduction'), ('deductions', 'withdraw_deduction'),
  -- desk
  ('desk', 'apply_customer_court_discount'), ('desk', 'apply_customer_discount'), ('desk', 'apply_discount'),
  ('desk', 'bill_customer_discount'), ('desk', 'block_courts_for_event'), ('desk', 'booking_bill'),
  ('desk', 'booking_bill_states'), ('desk', 'cancel_series'), ('desk', 'coach_statement_detail'),
  ('desk', 'coaches_admin'), ('desk', 'coaching_settings'), ('desk', 'create_series'),
  ('desk', 'customer_discount'), ('desk', 'customer_lessons'), ('desk', 'customer_record'),
  ('desk', 'desk_add_seat'), ('desk', 'desk_add_student'), ('desk', 'desk_book_lesson'),
  ('desk', 'desk_call_off_short'), ('desk', 'desk_cancel_course'), ('desk', 'desk_cancel_enrolment'),
  ('desk', 'desk_cancel_lesson'), ('desk', 'desk_cancel_match'), ('desk', 'desk_coach_schedule'),
  ('desk', 'desk_create_course'), ('desk', 'desk_create_group'), ('desk', 'desk_decide_request'),
  ('desk', 'desk_lesson_detail'), ('desk', 'desk_lessons'), ('desk', 'desk_mark_attendance'),
  ('desk', 'desk_match_detail'), ('desk', 'desk_match_states'), ('desk', 'desk_move_lesson_court'),
  ('desk', 'desk_open_matches'), ('desk', 'desk_remove_seat'), ('desk', 'desk_reschedule_session'),
  ('desk', 'desk_start_match'), ('desk', 'desk_tournament_detail'), ('desk', 'desk_tournaments'),
  ('desk', 'extend_reservation'), ('desk', 'guest_tickets'), ('desk', 'lesson_blocked_refund_record'),
  ('desk', 'lesson_refunds_due'), ('desk', 'lesson_settle'), ('desk', 'loyalty_adjust'),
  ('desk', 'loyalty_admin'), ('desk', 'loyalty_customer'), ('desk', 'loyalty_identify'),
  ('desk', 'loyalty_redeem'), ('desk', 'loyalty_till_terms'), ('desk', 'loyalty_unredeem'),
  ('desk', 'mark_match_seats'), ('desk', 'mark_reservation'), ('desk', 'match_link_payment'),
  ('desk', 'match_reports_open'), ('desk', 'match_seat_settle'), ('desk', 'match_seat_write_off'),
  ('desk', 'match_settings'), ('desk', 'merge_tabs'), ('desk', 'move_reservation'),
  ('desk', 'open_tab'), ('desk', 'override_price'), ('desk', 'preview_series'),
  ('desk', 'price_slot'), ('desk', 'protocol_step_detail'), ('desk', 'report_coach_statements'),
  ('desk', 'series_detail'), ('desk', 'set_customer_discount'), ('desk', 'set_tab_customer'),
  ('desk', 'settle_tab'), ('desk', 'staff_create_reservation'), ('desk', 'staff_set_customer_gender'),
  ('desk', 'submit_step'), ('desk', 'tournament_context'),
  -- incidents
  ('incidents', 'incidents_page'), ('incidents', 'my_incidents'), ('incidents', 'redact_incident'),
  ('incidents', 'review_incident'), ('incidents', 'submit_incident'),
  -- insights
  ('insights', 'analytics_best_sellers'), ('insights', 'analytics_bought_together'), ('insights', 'analytics_daily_sales'),
  ('insights', 'analytics_hourly'), ('insights', 'analytics_item_margins'), ('insights', 'analytics_menu_snapshot'),
  ('insights', 'analytics_price_bands'), ('insights', 'analytics_promo'), ('insights', 'analytics_sold_items'),
  ('insights', 'marketing_insights'), ('insights', 'save_analytics_insights'), ('insights', 'save_analytics_patterns'),
  ('insights', 'unreject_insight'),
  -- kds
  ('kds', 'kitchen_board'), ('kds', 'set_order_item_ready'), ('kds', 'set_ticket_status'),
  ('kds', 'staff_stock_view'), ('kds', 'stock_today'),
  -- ops
  ('ops', 'acknowledge_purchase_line'), ('ops', 'apply_discount'), ('ops', 'coach_statement_detail'),
  ('ops', 'coaches_admin'), ('ops', 'coaching_settings'), ('ops', 'customer_lessons'),
  ('ops', 'deposit_attention'), ('ops', 'deposit_refund_manual'), ('ops', 'deposit_refund_request'),
  ('ops', 'deposit_refund_retry'), ('ops', 'deposit_settings'), ('ops', 'desk_coach_schedule'),
  ('ops', 'desk_lesson_detail'), ('ops', 'desk_lessons'), ('ops', 'desk_match_detail'),
  ('ops', 'desk_match_states'), ('ops', 'desk_open_matches'), ('ops', 'guest_tickets'),
  ('ops', 'lesson_blocked_refund_record'), ('ops', 'lesson_refunds_due'), ('ops', 'match_reports_open'),
  ('ops', 'match_settings'), ('ops', 'merge_tabs'), ('ops', 'ops_overview'),
  ('ops', 'override_price'), ('ops', 'purchases_to_receive'), ('ops', 'receive_purchase'),
  ('ops', 'report_coach_statements'), ('ops', 'resolve_match_report'), ('ops', 'set_deposit_settings'),
  ('ops', 'ticket_cashout'),
  -- protocols
  ('protocols', 'add_run_step'), ('protocols', 'archive_checklist'), ('protocols', 'cancel_schedule'),
  ('protocols', 'checklist_board'), ('protocols', 'checklist_day_state'), ('protocols', 'checklist_staff_options'),
  ('protocols', 'decide_step'), ('protocols', 'delete_hiring_candidate'), ('protocols', 'desk_tournament_detail'),
  ('protocols', 'desk_tournaments'), ('protocols', 'edit_run_items'), ('protocols', 'hiring_candidates'),
  ('protocols', 'marketing_notes_for'), ('protocols', 'price_promo_numbers'), ('protocols', 'price_promo_targets'),
  ('protocols', 'protocol_run_detail'), ('protocols', 'protocol_step_detail'), ('protocols', 'protocol_template_detail'),
  ('protocols', 'protocols_overview'), ('protocols', 'release_cost'), ('protocols', 'release_readiness'),
  ('protocols', 'release_review'), ('protocols', 'release_test_context'), ('protocols', 'save_checklist'),
  ('protocols', 'save_hiring_candidate'), ('protocols', 'save_protocol_template'), ('protocols', 'skip_step'),
  ('protocols', 'start_protocol'), ('protocols', 'stop_protocol'), ('protocols', 'submit_step'),
  ('protocols', 'tick_run_item'), ('protocols', 'tournament_context'), ('protocols', 'tournament_feasibility'),
  ('protocols', 'tournament_publish'), ('protocols', 'withdraw_protocol'), ('protocols', 'withdraw_step'),
  -- reports
  ('reports', 'coach_statement_approve'), ('reports', 'coach_statement_detail'), ('reports', 'coach_statement_mark_paid'),
  ('reports', 'coach_statement_refresh'), ('reports', 'coach_statement_void'), ('reports', 'coaches_admin'),
  ('reports', 'coaching_settings'), ('reports', 'customer_lessons'), ('reports', 'desk_coach_schedule'),
  ('reports', 'desk_lesson_detail'), ('reports', 'desk_lessons'), ('reports', 'lesson_refunds_due'),
  ('reports', 'list_staff'), ('reports', 'report_cafe'), ('reports', 'report_coach_statements'),
  ('reports', 'report_compare'), ('reports', 'report_courts'), ('reports', 'report_drill'),
  ('reports', 'report_lessons'), ('reports', 'report_matches'), ('reports', 'report_revenue'),
  ('reports', 'report_staff_activity'),
  -- shop
  ('shop', 'acknowledge_purchase_line'), ('shop', 'apply_customer_court_discount'), ('shop', 'apply_customer_discount'),
  ('shop', 'bill_customer_discount'), ('shop', 'confirm_receipt'), ('shop', 'customer_discount'),
  ('shop', 'discard_count'), ('shop', 'finalize_count'), ('shop', 'loyalty_adjust'),
  ('shop', 'loyalty_admin'), ('shop', 'loyalty_customer'), ('shop', 'loyalty_identify'),
  ('shop', 'loyalty_redeem'), ('shop', 'loyalty_till_terms'), ('shop', 'loyalty_unredeem'),
  ('shop', 'open_tab'), ('shop', 'price_logged_stock'), ('shop', 'purchases_to_receive'),
  ('shop', 'receipt_detail'), ('shop', 'receipts_to_review'), ('shop', 'receive_delivery'),
  ('shop', 'receive_purchase'), ('shop', 'record_drawer_open'), ('shop', 'reject_receipt'),
  ('shop', 'set_customer_discount'), ('shop', 'set_shop_price_watch'), ('shop', 'set_tab_customer'),
  ('shop', 'settle_tab'), ('shop', 'shop_reward_info'), ('shop', 'start_count'),
  ('shop', 'till_add_items'), ('shop', 'upsert_menu_item'), ('shop', 'upsert_retail_variant'),
  ('shop', 'upsert_shop_category'), ('shop', 'upsert_supplier'),
  -- stock
  ('stock', 'acknowledge_alert'), ('stock', 'acknowledge_purchase_line'), ('stock', 'confirm_receipt'),
  ('stock', 'discard_count'), ('stock', 'finalize_count'), ('stock', 'log_stock'),
  ('stock', 'price_logged_stock'), ('stock', 'purchases_to_receive'), ('stock', 'receipt_detail'),
  ('stock', 'receipts_to_review'), ('stock', 'receive_delivery'), ('stock', 'receive_purchase'),
  ('stock', 'record_production'), ('stock', 'record_waste'), ('stock', 'reject_receipt'),
  ('stock', 'set_batch_yield'), ('stock', 'set_recipe'), ('stock', 'staff_stock_view'),
  ('stock', 'start_count'), ('stock', 'stock_pick_list'), ('stock', 'stock_today'),
  ('stock', 'submit_stock_count'), ('stock', 'transfer_stock'), ('stock', 'upsert_ingredient'),
  ('stock', 'write_off_expired'),
  -- suggestions
  ('suggestions', 'add_suggestion'), ('suggestions', 'mark_suggestion_seen'), ('suggestions', 'suggestions_page'),
  -- tasks
  ('tasks', 'price_promo_numbers'), ('tasks', 'price_promo_targets'), ('tasks', 'protocol_run_detail'),
  ('tasks', 'protocol_step_detail'), ('tasks', 'protocol_template_detail'), ('tasks', 'protocols_overview'),
  ('tasks', 'release_cost'), ('tasks', 'release_readiness'), ('tasks', 'release_test_context'),
  ('tasks', 'staff_stock_view'), ('tasks', 'start_protocol'), ('tasks', 'stock_today'),
  ('tasks', 'submit_step'), ('tasks', 'tick_run_item'), ('tasks', 'tournament_context'),
  ('tasks', 'tournament_feasibility'), ('tasks', 'withdraw_protocol'), ('tasks', 'withdraw_step'),
  -- till
  ('till', 'apply_best_promotion'), ('till', 'apply_customer_court_discount'), ('till', 'apply_customer_discount'),
  ('till', 'apply_discount'), ('till', 'bill_customer_discount'), ('till', 'booking_bill'),
  ('till', 'cancel_tab'), ('till', 'customer_discount'), ('till', 'loyalty_adjust'),
  ('till', 'loyalty_admin'), ('till', 'loyalty_customer'), ('till', 'loyalty_identify'),
  ('till', 'loyalty_redeem'), ('till', 'loyalty_till_terms'), ('till', 'loyalty_unredeem'),
  ('till', 'merge_tabs'), ('till', 'open_tab'), ('till', 'order_set_delivery'),
  ('till', 'override_price'), ('till', 'record_drawer_open'), ('till', 'reject_order_slip'),
  ('till', 'send_order_slip'), ('till', 'set_customer_discount'), ('till', 'set_tab_customer'),
  ('till', 'settle_tab'), ('till', 'slip_detail'), ('till', 'slips_to_send'),
  ('till', 'split_by_item'), ('till', 'split_evenly'), ('till', 'till_add_items'),
  -- tournaments
  ('tournaments', 'desk_tournament_detail'), ('tournaments', 'desk_tournaments'), ('tournaments', 'staff_set_customer_gender'),
  ('tournaments', 'tournament_add_entry'), ('tournaments', 'tournament_cancel'), ('tournaments', 'tournament_close'),
  ('tournaments', 'tournament_finish'), ('tournaments', 'tournament_mark_no_show'), ('tournaments', 'tournament_remove_entry'),
  ('tournaments', 'tournament_score'), ('tournaments', 'tournament_set_rounds'), ('tournaments', 'tournament_settle')
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- 2. The rule, and the hook.
-- ---------------------------------------------------------------------------
create or replace function app.area_blocked_rpc(p_rpc text) returns boolean
language sql stable security definer set search_path = public as $area_blocked_rpc_0384$
  select coalesce(
    (select cardinality(s.blocked_areas) > 0
            and exists (select 1 from app.access_area_rpcs m where m.rpc = p_rpc)
            and not exists (select 1 from app.access_area_rpcs m
                             where m.rpc = p_rpc
                               and not (m.area = any(s.blocked_areas)))
       from staff s
      where s.id = auth.uid()
        and s.is_active
        and s.role <> 'owner'),
    false)
$area_blocked_rpc_0384$;

comment on function app.area_blocked_rpc(text) is
  '0384 (F-16). True when the caller is active staff, not the owner, and every page (app.access_area_rpcs) that p_rpc belongs to is in their staff.blocked_areas. False for an RPC no page owns, for guests, for service-role calls.';

revoke all on function app.area_blocked_rpc(text) from public;
grant execute on function app.area_blocked_rpc(text) to anon, authenticated, service_role;

create or replace function app.pre_request() returns void
language plpgsql stable security definer set search_path = public as $pre_request_0384$
declare
  v_path text;
  v_rpc  text;
  v_no   boolean := false;
begin
  v_path := current_setting('request.path', true);
  if v_path is null or left(v_path, 5) <> '/rpc/' or auth.uid() is null then
    return;
  end if;
  v_rpc := split_part(substr(v_path, 6), '/', 1);
  begin
    v_no := app.area_blocked_rpc(v_rpc);
  exception when others then
    -- Never take the API down for the hook's own fault: the RPC's role and
    -- branch guards still stand.
    v_no := false;
  end;
  if v_no then
    raise exception 'AREA_BLOCKED' using errcode = 'P0001', detail = v_rpc,
      hint = 'the owner blocked this page for this person (Staff > Access)';
  end if;
end $pre_request_0384$;

comment on function app.pre_request() is
  '0384 (F-16). PostgREST pre-request hook (authenticator pgrst.db_pre_request): refuses /rpc/<name> with AREA_BLOCKED (detail <name>) when app.area_blocked_rpc(<name>) is true. Does nothing for table reads, guests and service-role calls; a fault inside it lets the request through.';

revoke all on function app.pre_request() from public;
grant execute on function app.pre_request() to anon, authenticated, service_role;

do $pre_request_hook_0384$
begin
  begin
    execute 'alter role authenticator set pgrst.db_pre_request = ''app.pre_request''';
  exception when others then
    raise exception 'SETUP_FAILED' using errcode = 'P0001',
      detail = 'pgrst.db_pre_request could not be set on the authenticator role: ' || sqlerrm,
      hint = 'without it staff.blocked_areas is not enforced on the server (F-16)';
  end;
  perform pg_notify('pgrst', 'reload config');
end $pre_request_hook_0384$;
