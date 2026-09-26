set lock_timeout = '3s';
set statement_timeout = '60s';

-- 0234 (multi-venue audit, 2026-09-26): the staff role checks in RLS run once
-- per statement, not once per row.
--
-- app.is_staff(...) and app.staff_role() are SECURITY DEFINER SQL functions,
-- so the planner cannot inline them, and in a policy they were called for every
-- row a staff read touched (audit_log, orders, payments, tickets, …). Their
-- arguments are constants, so each is wrapped in a scalar sub-select, the form
-- 0226 gave app.visible_venue_ids(): Postgres evaluates it once as an InitPlan
-- and reuses the answer. Nothing else in any policy changes.
--
-- Generated on 2026-09-26 from the live pg_policies (public and storage) at
-- 0233: every policy whose USING or WITH CHECK called either function outside
-- a sub-select, re-created with the same name, command, roles and mode.

drop policy if exists analytics_insight_rejections_owner_read on public.analytics_insight_rejections;
create policy analytics_insight_rejections_owner_read on public.analytics_insight_rejections as permissive for select to authenticated
  using (( SELECT app.is_staff(VARIADIC ARRAY['owner'::staff_role]) AS is_staff));

drop policy if exists analytics_insights_owner_read on public.analytics_insights;
create policy analytics_insights_owner_read on public.analytics_insights as permissive for select to authenticated
  using (( SELECT app.is_staff(VARIADIC ARRAY['owner'::staff_role]) AS is_staff));

drop policy if exists analytics_patterns_owner_read on public.analytics_patterns;
create policy analytics_patterns_owner_read on public.analytics_patterns as permissive for select to authenticated
  using (( SELECT app.is_staff(VARIADIC ARRAY['owner'::staff_role]) AS is_staff));

drop policy if exists assistant_calls_insert_owner on public.assistant_calls;
create policy assistant_calls_insert_owner on public.assistant_calls as permissive for insert to authenticated
  with check (( SELECT app.is_staff(VARIADIC ARRAY['owner'::staff_role]) AS is_staff));

drop policy if exists assistant_calls_select_owner on public.assistant_calls;
create policy assistant_calls_select_owner on public.assistant_calls as permissive for select to authenticated
  using (( SELECT app.is_staff(VARIADIC ARRAY['owner'::staff_role]) AS is_staff));

drop policy if exists assistant_chunks_select_owner on public.assistant_chunks;
create policy assistant_chunks_select_owner on public.assistant_chunks as permissive for select to authenticated
  using (( SELECT app.is_staff(VARIADIC ARRAY['owner'::staff_role]) AS is_staff));

drop policy if exists assistant_component_cache_select_owner on public.assistant_component_cache;
create policy assistant_component_cache_select_owner on public.assistant_component_cache as permissive for select to authenticated
  using (( SELECT app.is_staff(VARIADIC ARRAY['owner'::staff_role]) AS is_staff));

drop policy if exists assistant_components_select_owner on public.assistant_components;
create policy assistant_components_select_owner on public.assistant_components as permissive for select to authenticated
  using (( SELECT app.is_staff(VARIADIC ARRAY['owner'::staff_role]) AS is_staff));

drop policy if exists assistant_conversations_insert_owner on public.assistant_conversations;
create policy assistant_conversations_insert_owner on public.assistant_conversations as permissive for insert to authenticated
  with check ((( SELECT app.is_staff(VARIADIC ARRAY['owner'::staff_role]) AS is_staff) AND (owner_id = auth.uid())));

drop policy if exists assistant_conversations_select_owner on public.assistant_conversations;
create policy assistant_conversations_select_owner on public.assistant_conversations as permissive for select to authenticated
  using (( SELECT app.is_staff(VARIADIC ARRAY['owner'::staff_role]) AS is_staff));

drop policy if exists assistant_conversations_update_owner on public.assistant_conversations;
create policy assistant_conversations_update_owner on public.assistant_conversations as permissive for update to authenticated
  using (( SELECT app.is_staff(VARIADIC ARRAY['owner'::staff_role]) AS is_staff))
  with check (( SELECT app.is_staff(VARIADIC ARRAY['owner'::staff_role]) AS is_staff));

drop policy if exists assistant_index_queue_select_owner on public.assistant_index_queue;
create policy assistant_index_queue_select_owner on public.assistant_index_queue as permissive for select to authenticated
  using (( SELECT app.is_staff(VARIADIC ARRAY['owner'::staff_role]) AS is_staff));

drop policy if exists assistant_jobs_select_owner on public.assistant_jobs;
create policy assistant_jobs_select_owner on public.assistant_jobs as permissive for select to authenticated
  using (( SELECT app.is_staff(VARIADIC ARRAY['owner'::staff_role]) AS is_staff));

drop policy if exists assistant_messages_insert_owner on public.assistant_messages;
create policy assistant_messages_insert_owner on public.assistant_messages as permissive for insert to authenticated
  with check (( SELECT app.is_staff(VARIADIC ARRAY['owner'::staff_role]) AS is_staff));

drop policy if exists assistant_messages_select_owner on public.assistant_messages;
create policy assistant_messages_select_owner on public.assistant_messages as permissive for select to authenticated
  using (( SELECT app.is_staff(VARIADIC ARRAY['owner'::staff_role]) AS is_staff));

drop policy if exists audit_log_select_mgmt on public.audit_log;
create policy audit_log_select_mgmt on public.audit_log as permissive for select to authenticated
  using ((( SELECT app.is_staff(VARIADIC ARRAY['manager'::staff_role, 'owner'::staff_role]) AS is_staff) AND (venue_id = ANY (( SELECT app.visible_venue_ids() AS visible_venue_ids)::uuid[]))));

drop policy if exists cafe_settings_staff_read on public.cafe_settings;
create policy cafe_settings_staff_read on public.cafe_settings as permissive for select to authenticated
  using ((( SELECT app.is_staff(VARIADIC ARRAY['manager'::staff_role, 'owner'::staff_role]) AS is_staff) AND (venue_id = ANY (( SELECT app.visible_venue_ids() AS visible_venue_ids)::uuid[]))));

drop policy if exists cafe_tables_staff_read on public.cafe_tables;
create policy cafe_tables_staff_read on public.cafe_tables as permissive for select to authenticated
  using (((( SELECT app.staff_role() AS staff_role) IS NOT NULL) AND (venue_id = ANY (( SELECT app.visible_venue_ids() AS visible_venue_ids)::uuid[]))));

drop policy if exists checklist_run_items_mgmt_read on public.checklist_run_items;
create policy checklist_run_items_mgmt_read on public.checklist_run_items as permissive for select to authenticated
  using ((( SELECT app.is_staff(VARIADIC ARRAY['manager'::staff_role, 'owner'::staff_role]) AS is_staff) AND (EXISTS ( SELECT 1
   FROM checklist_runs r
  WHERE ((r.id = checklist_run_items.run_id) AND (r.venue_id = ANY (( SELECT app.visible_venue_ids() AS visible_venue_ids)::uuid[])))))));

drop policy if exists checklist_runs_mgmt_read on public.checklist_runs;
create policy checklist_runs_mgmt_read on public.checklist_runs as permissive for select to authenticated
  using ((( SELECT app.is_staff(VARIADIC ARRAY['manager'::staff_role, 'owner'::staff_role]) AS is_staff) AND (venue_id = ANY (( SELECT app.visible_venue_ids() AS visible_venue_ids)::uuid[]))));

drop policy if exists checklist_template_items_mgmt_read on public.checklist_template_items;
create policy checklist_template_items_mgmt_read on public.checklist_template_items as permissive for select to authenticated
  using ((( SELECT app.is_staff(VARIADIC ARRAY['manager'::staff_role, 'owner'::staff_role]) AS is_staff) AND (EXISTS ( SELECT 1
   FROM checklist_templates t
  WHERE ((t.id = checklist_template_items.template_id) AND (t.venue_id = ANY (( SELECT app.visible_venue_ids() AS visible_venue_ids)::uuid[])))))));

drop policy if exists checklist_templates_mgmt_read on public.checklist_templates;
create policy checklist_templates_mgmt_read on public.checklist_templates as permissive for select to authenticated
  using ((( SELECT app.is_staff(VARIADIC ARRAY['manager'::staff_role, 'owner'::staff_role]) AS is_staff) AND (venue_id = ANY (( SELECT app.visible_venue_ids() AS visible_venue_ids)::uuid[]))));

drop policy if exists courts_read on public.courts;
create policy courts_read on public.courts as permissive for select to anon, authenticated
  using (((is_active AND (( SELECT app.staff_role() AS staff_role) IS NULL) AND (venue_id = ANY (( SELECT app.open_venue_ids() AS open_venue_ids)::uuid[]))) OR ((( SELECT app.staff_role() AS staff_role) IS NOT NULL) AND (venue_id = ANY (( SELECT app.visible_venue_ids() AS visible_venue_ids)::uuid[])))));

drop policy if exists customer_flags_select_staff on public.customer_flags;
create policy customer_flags_select_staff on public.customer_flags as permissive for select to authenticated
  using (( SELECT app.is_staff(VARIADIC ARRAY['court_desk'::staff_role, 'cashier'::staff_role, 'manager'::staff_role, 'owner'::staff_role]) AS is_staff));

drop policy if exists customer_notes_select_staff on public.customer_notes;
create policy customer_notes_select_staff on public.customer_notes as permissive for select to authenticated
  using (( SELECT app.is_staff(VARIADIC ARRAY['court_desk'::staff_role, 'cashier'::staff_role, 'manager'::staff_role, 'owner'::staff_role]) AS is_staff));

drop policy if exists day_sessions_staff_read on public.day_sessions;
create policy day_sessions_staff_read on public.day_sessions as permissive for select to authenticated
  using ((( SELECT app.is_staff(VARIADIC ARRAY['cashier'::staff_role, 'court_desk'::staff_role, 'manager'::staff_role, 'owner'::staff_role]) AS is_staff) AND (venue_id = ANY (( SELECT app.visible_venue_ids() AS visible_venue_ids)::uuid[]))));

drop policy if exists degraded_periods_mgmt_read on public.degraded_periods;
create policy degraded_periods_mgmt_read on public.degraded_periods as permissive for select to authenticated
  using ((( SELECT app.is_staff(VARIADIC ARRAY['manager'::staff_role, 'owner'::staff_role]) AS is_staff) AND (venue_id = ANY (( SELECT app.visible_venue_ids() AS visible_venue_ids)::uuid[]))));

drop policy if exists deliveries_mgmt_read on public.deliveries;
create policy deliveries_mgmt_read on public.deliveries as permissive for select to authenticated
  using ((( SELECT app.is_staff(VARIADIC ARRAY['manager'::staff_role, 'owner'::staff_role]) AS is_staff) AND (venue_id = ANY (( SELECT app.visible_venue_ids() AS visible_venue_ids)::uuid[]))));

drop policy if exists device_heartbeats_mgmt_read on public.device_heartbeats;
create policy device_heartbeats_mgmt_read on public.device_heartbeats as permissive for select to authenticated
  using ((( SELECT app.is_staff(VARIADIC ARRAY['manager'::staff_role, 'owner'::staff_role]) AS is_staff) AND (venue_id = ANY (( SELECT app.visible_venue_ids() AS visible_venue_ids)::uuid[]))));

drop policy if exists guest_sessions_staff_read on public.guest_sessions;
create policy guest_sessions_staff_read on public.guest_sessions as permissive for select to authenticated
  using ((( SELECT app.is_staff(VARIADIC ARRAY['cashier'::staff_role, 'manager'::staff_role, 'owner'::staff_role]) AS is_staff) AND (venue_id = ANY (( SELECT app.visible_venue_ids() AS visible_venue_ids)::uuid[]))));

drop policy if exists hiring_candidates_mgmt_read on public.hiring_candidates;
create policy hiring_candidates_mgmt_read on public.hiring_candidates as permissive for select to authenticated
  using ((( SELECT app.is_staff(VARIADIC ARRAY['manager'::staff_role, 'owner'::staff_role]) AS is_staff) AND (venue_id = ANY (( SELECT app.visible_venue_ids() AS visible_venue_ids)::uuid[]))));

drop policy if exists incident_reports_mgmt_read on public.incident_reports;
create policy incident_reports_mgmt_read on public.incident_reports as permissive for select to authenticated
  using ((( SELECT app.is_staff(VARIADIC ARRAY['manager'::staff_role, 'owner'::staff_role]) AS is_staff) AND (venue_id = ANY (( SELECT app.visible_venue_ids() AS visible_venue_ids)::uuid[]))));

drop policy if exists ingredients_mgmt_read on public.ingredients;
create policy ingredients_mgmt_read on public.ingredients as permissive for select to authenticated
  using ((( SELECT app.is_staff(VARIADIC ARRAY['manager'::staff_role, 'owner'::staff_role]) AS is_staff) AND (venue_id = ANY (( SELECT app.visible_venue_ids() AS visible_venue_ids)::uuid[]))));

drop policy if exists llm_usage_select_owner on public.llm_usage;
create policy llm_usage_select_owner on public.llm_usage as permissive for select to authenticated
  using (( SELECT app.is_staff(VARIADIC ARRAY['owner'::staff_role]) AS is_staff));

drop policy if exists manager_alerts_mgmt_read on public.manager_alerts;
create policy manager_alerts_mgmt_read on public.manager_alerts as permissive for select to authenticated
  using ((( SELECT app.is_staff(VARIADIC ARRAY['manager'::staff_role, 'owner'::staff_role]) AS is_staff) AND (venue_id = ANY (( SELECT app.visible_venue_ids() AS visible_venue_ids)::uuid[]))));

drop policy if exists marketing_audiences_read on public.marketing_audiences;
create policy marketing_audiences_read on public.marketing_audiences as permissive for select to authenticated
  using ((( SELECT app.is_staff(VARIADIC ARRAY['manager'::staff_role, 'owner'::staff_role]) AS is_staff) AND (venue_id = ANY (( SELECT app.visible_venue_ids() AS visible_venue_ids)::uuid[]))));

drop policy if exists marketing_campaigns_read on public.marketing_campaigns;
create policy marketing_campaigns_read on public.marketing_campaigns as permissive for select to authenticated
  using ((( SELECT app.is_staff(VARIADIC ARRAY['manager'::staff_role, 'owner'::staff_role]) AS is_staff) AND (venue_id = ANY (( SELECT app.visible_venue_ids() AS visible_venue_ids)::uuid[]))));

drop policy if exists marketing_content_owner_read on public.marketing_content;
create policy marketing_content_owner_read on public.marketing_content as permissive for select to authenticated
  using ((( SELECT app.is_staff(VARIADIC ARRAY['owner'::staff_role]) AS is_staff) AND (venue_id = ANY (( SELECT app.visible_venue_ids() AS visible_venue_ids)::uuid[]))));

drop policy if exists marketing_content_versions_owner_read on public.marketing_content_versions;
create policy marketing_content_versions_owner_read on public.marketing_content_versions as permissive for select to authenticated
  using ((( SELECT app.is_staff(VARIADIC ARRAY['owner'::staff_role]) AS is_staff) AND (EXISTS ( SELECT 1
   FROM marketing_content c
  WHERE ((c.id = marketing_content_versions.content_id) AND (c.venue_id = ANY (( SELECT app.visible_venue_ids() AS visible_venue_ids)::uuid[])))))));

drop policy if exists marketing_notes_mgmt_read on public.marketing_notes;
create policy marketing_notes_mgmt_read on public.marketing_notes as permissive for select to authenticated
  using ((( SELECT app.is_staff(VARIADIC ARRAY['manager'::staff_role, 'owner'::staff_role]) AS is_staff) AND (venue_id = ANY (( SELECT app.visible_venue_ids() AS visible_venue_ids)::uuid[]))));

drop policy if exists marketing_requests_mgmt_read on public.marketing_requests;
create policy marketing_requests_mgmt_read on public.marketing_requests as permissive for select to authenticated
  using ((( SELECT app.is_staff(VARIADIC ARRAY['manager'::staff_role, 'owner'::staff_role]) AS is_staff) AND (venue_id = ANY (( SELECT app.visible_venue_ids() AS visible_venue_ids)::uuid[]))));

drop policy if exists menu_categories_read on public.menu_categories;
create policy menu_categories_read on public.menu_categories as permissive for select to anon, authenticated
  using (((is_active AND (( SELECT app.staff_role() AS staff_role) IS NULL) AND (venue_id = ANY (( SELECT app.open_venue_ids() AS open_venue_ids)::uuid[]))) OR ((( SELECT app.staff_role() AS staff_role) IS NOT NULL) AND (venue_id = ANY (( SELECT app.visible_venue_ids() AS visible_venue_ids)::uuid[])))));

drop policy if exists menu_item_variants_read on public.menu_item_variants;
create policy menu_item_variants_read on public.menu_item_variants as permissive for select to anon, authenticated
  using ((EXISTS ( SELECT 1
   FROM menu_items mi
  WHERE ((mi.id = menu_item_variants.item_id) AND (mi.is_active OR (( SELECT app.staff_role() AS staff_role) IS NOT NULL))))));

drop policy if exists menu_items_read on public.menu_items;
create policy menu_items_read on public.menu_items as permissive for select to anon, authenticated
  using (((is_active AND (( SELECT app.staff_role() AS staff_role) IS NULL) AND (venue_id = ANY (( SELECT app.open_venue_ids() AS open_venue_ids)::uuid[]))) OR ((( SELECT app.staff_role() AS staff_role) IS NOT NULL) AND (venue_id = ANY (( SELECT app.visible_venue_ids() AS visible_venue_ids)::uuid[])))));

drop policy if exists modifiers_read on public.modifiers;
create policy modifiers_read on public.modifiers as permissive for select to anon, authenticated
  using ((is_active OR (( SELECT app.staff_role() AS staff_role) IS NOT NULL)));

drop policy if exists order_item_modifiers_staff_read on public.order_item_modifiers;
create policy order_item_modifiers_staff_read on public.order_item_modifiers as permissive for select to authenticated
  using ((( SELECT app.is_staff(VARIADIC ARRAY['cashier'::staff_role, 'court_desk'::staff_role, 'manager'::staff_role, 'owner'::staff_role]) AS is_staff) AND (EXISTS ( SELECT 1
   FROM (order_items oi
     JOIN orders o ON ((o.id = oi.order_id)))
  WHERE ((oi.id = order_item_modifiers.order_item_id) AND (o.venue_id = ANY (( SELECT app.visible_venue_ids() AS visible_venue_ids)::uuid[])))))));

drop policy if exists order_items_staff_read on public.order_items;
create policy order_items_staff_read on public.order_items as permissive for select to authenticated
  using ((( SELECT app.is_staff(VARIADIC ARRAY['cashier'::staff_role, 'court_desk'::staff_role, 'manager'::staff_role, 'owner'::staff_role]) AS is_staff) AND (EXISTS ( SELECT 1
   FROM orders o
  WHERE ((o.id = order_items.order_id) AND (o.venue_id = ANY (( SELECT app.visible_venue_ids() AS visible_venue_ids)::uuid[])))))));

drop policy if exists orders_staff_read on public.orders;
create policy orders_staff_read on public.orders as permissive for select to authenticated
  using ((( SELECT app.is_staff(VARIADIC ARRAY['cashier'::staff_role, 'court_desk'::staff_role, 'manager'::staff_role, 'owner'::staff_role]) AS is_staff) AND (venue_id = ANY (( SELECT app.visible_venue_ids() AS visible_venue_ids)::uuid[]))));

drop policy if exists payments_staff_read on public.payments;
create policy payments_staff_read on public.payments as permissive for select to authenticated
  using ((( SELECT app.is_staff(VARIADIC ARRAY['cashier'::staff_role, 'manager'::staff_role, 'owner'::staff_role]) AS is_staff) AND (venue_id = ANY (( SELECT app.visible_venue_ids() AS visible_venue_ids)::uuid[]))));

drop policy if exists platform_settings_staff_read on public.platform_settings;
create policy platform_settings_staff_read on public.platform_settings as permissive for select to authenticated
  using ((( SELECT app.staff_role() AS staff_role) IS NOT NULL));

drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles as permissive for select to authenticated
  using (((id = auth.uid()) OR ( SELECT app.is_staff(VARIADIC ARRAY['court_desk'::staff_role, 'manager'::staff_role, 'owner'::staff_role]) AS is_staff)));

drop policy if exists promotions_staff_read on public.promotions;
create policy promotions_staff_read on public.promotions as permissive for select to authenticated
  using (((( SELECT app.staff_role() AS staff_role) IS NOT NULL) AND ((venue_id IS NULL) OR (venue_id = ANY (( SELECT app.visible_venue_ids() AS visible_venue_ids)::uuid[])))));

drop policy if exists protocol_run_items_mgmt_read on public.protocol_run_items;
create policy protocol_run_items_mgmt_read on public.protocol_run_items as permissive for select to authenticated
  using ((( SELECT app.is_staff(VARIADIC ARRAY['manager'::staff_role, 'owner'::staff_role]) AS is_staff) AND (EXISTS ( SELECT 1
   FROM (protocol_run_steps s
     JOIN protocol_runs r ON ((r.id = s.run_id)))
  WHERE ((s.id = protocol_run_items.run_step_id) AND (r.venue_id = ANY (( SELECT app.visible_venue_ids() AS visible_venue_ids)::uuid[])))))));

drop policy if exists protocol_run_steps_mgmt_read on public.protocol_run_steps;
create policy protocol_run_steps_mgmt_read on public.protocol_run_steps as permissive for select to authenticated
  using ((( SELECT app.is_staff(VARIADIC ARRAY['manager'::staff_role, 'owner'::staff_role]) AS is_staff) AND (EXISTS ( SELECT 1
   FROM protocol_runs r
  WHERE ((r.id = protocol_run_steps.run_id) AND (r.venue_id = ANY (( SELECT app.visible_venue_ids() AS visible_venue_ids)::uuid[])))))));

drop policy if exists protocol_runs_mgmt_read on public.protocol_runs;
create policy protocol_runs_mgmt_read on public.protocol_runs as permissive for select to authenticated
  using ((( SELECT app.is_staff(VARIADIC ARRAY['manager'::staff_role, 'owner'::staff_role]) AS is_staff) AND (venue_id = ANY (( SELECT app.visible_venue_ids() AS visible_venue_ids)::uuid[]))));

drop policy if exists protocol_submissions_mgmt_read on public.protocol_submissions;
create policy protocol_submissions_mgmt_read on public.protocol_submissions as permissive for select to authenticated
  using ((( SELECT app.is_staff(VARIADIC ARRAY['manager'::staff_role, 'owner'::staff_role]) AS is_staff) AND (EXISTS ( SELECT 1
   FROM protocol_runs r
  WHERE ((r.id = protocol_submissions.run_id) AND (r.venue_id = ANY (( SELECT app.visible_venue_ids() AS visible_venue_ids)::uuid[])))))));

drop policy if exists protocol_template_items_mgmt_read on public.protocol_template_items;
create policy protocol_template_items_mgmt_read on public.protocol_template_items as permissive for select to authenticated
  using ((( SELECT app.is_staff(VARIADIC ARRAY['manager'::staff_role, 'owner'::staff_role]) AS is_staff) AND (EXISTS ( SELECT 1
   FROM (protocol_template_steps s
     JOIN protocol_templates t ON ((t.id = s.template_id)))
  WHERE ((s.id = protocol_template_items.step_id) AND (t.venue_id = ANY (( SELECT app.visible_venue_ids() AS visible_venue_ids)::uuid[])))))));

drop policy if exists protocol_template_steps_mgmt_read on public.protocol_template_steps;
create policy protocol_template_steps_mgmt_read on public.protocol_template_steps as permissive for select to authenticated
  using ((( SELECT app.is_staff(VARIADIC ARRAY['manager'::staff_role, 'owner'::staff_role]) AS is_staff) AND (EXISTS ( SELECT 1
   FROM protocol_templates t
  WHERE ((t.id = protocol_template_steps.template_id) AND (t.venue_id = ANY (( SELECT app.visible_venue_ids() AS visible_venue_ids)::uuid[])))))));

drop policy if exists protocol_templates_mgmt_read on public.protocol_templates;
create policy protocol_templates_mgmt_read on public.protocol_templates as permissive for select to authenticated
  using ((( SELECT app.is_staff(VARIADIC ARRAY['manager'::staff_role, 'owner'::staff_role]) AS is_staff) AND (venue_id = ANY (( SELECT app.visible_venue_ids() AS visible_venue_ids)::uuid[]))));

drop policy if exists purchase_lines_read on public.purchase_lines;
create policy purchase_lines_read on public.purchase_lines as permissive for select to authenticated
  using ((EXISTS ( SELECT 1
   FROM purchases p
  WHERE ((p.id = purchase_lines.purchase_id) AND ((p.staff_id = auth.uid()) OR (( SELECT app.is_staff(VARIADIC ARRAY['manager'::staff_role, 'owner'::staff_role]) AS is_staff) AND (p.venue_id = ANY (( SELECT app.visible_venue_ids() AS visible_venue_ids)::uuid[]))))))));

drop policy if exists purchases_mgmt_read on public.purchases;
create policy purchases_mgmt_read on public.purchases as permissive for select to authenticated
  using ((( SELECT app.is_staff(VARIADIC ARRAY['manager'::staff_role, 'owner'::staff_role]) AS is_staff) AND (venue_id = ANY (( SELECT app.visible_venue_ids() AS visible_venue_ids)::uuid[]))));

drop policy if exists rate_rule_prices_read on public.rate_rule_prices;
create policy rate_rule_prices_read on public.rate_rule_prices as permissive for select to anon, authenticated
  using ((EXISTS ( SELECT 1
   FROM rate_rules r
  WHERE ((r.id = rate_rule_prices.rule_id) AND (r.is_active OR (( SELECT app.staff_role() AS staff_role) IS NOT NULL))))));

drop policy if exists rate_rules_read on public.rate_rules;
create policy rate_rules_read on public.rate_rules as permissive for select to anon, authenticated
  using (((is_active AND (( SELECT app.staff_role() AS staff_role) IS NULL) AND (venue_id = ANY (( SELECT app.open_venue_ids() AS open_venue_ids)::uuid[]))) OR ((( SELECT app.staff_role() AS staff_role) IS NOT NULL) AND (venue_id = ANY (( SELECT app.visible_venue_ids() AS visible_venue_ids)::uuid[])))));

drop policy if exists recipe_change_requests_mgmt_read on public.recipe_change_requests;
create policy recipe_change_requests_mgmt_read on public.recipe_change_requests as permissive for select to authenticated
  using ((( SELECT app.is_staff(VARIADIC ARRAY['manager'::staff_role, 'owner'::staff_role]) AS is_staff) AND (venue_id = ANY (( SELECT app.visible_venue_ids() AS visible_venue_ids)::uuid[]))));

drop policy if exists refunds_staff_read on public.refunds;
create policy refunds_staff_read on public.refunds as permissive for select to authenticated
  using ((( SELECT app.is_staff(VARIADIC ARRAY['cashier'::staff_role, 'manager'::staff_role, 'owner'::staff_role]) AS is_staff) AND (venue_id = ANY (( SELECT app.visible_venue_ids() AS visible_venue_ids)::uuid[]))));

drop policy if exists release_ideas_mgmt_read on public.release_ideas;
create policy release_ideas_mgmt_read on public.release_ideas as permissive for select to authenticated
  using ((( SELECT app.is_staff(VARIADIC ARRAY['manager'::staff_role, 'owner'::staff_role]) AS is_staff) AND (venue_id = ANY (( SELECT app.visible_venue_ids() AS visible_venue_ids)::uuid[]))));

drop policy if exists release_notes_mgmt_read on public.release_notes;
create policy release_notes_mgmt_read on public.release_notes as permissive for select to authenticated
  using ((( SELECT app.is_staff(VARIADIC ARRAY['manager'::staff_role, 'owner'::staff_role]) AS is_staff) AND (venue_id = ANY (( SELECT app.visible_venue_ids() AS visible_venue_ids)::uuid[]))));

drop policy if exists release_reviews_mgmt_read on public.release_reviews;
create policy release_reviews_mgmt_read on public.release_reviews as permissive for select to authenticated
  using ((( SELECT app.is_staff(VARIADIC ARRAY['manager'::staff_role, 'owner'::staff_role]) AS is_staff) AND (venue_id = ANY (( SELECT app.visible_venue_ids() AS visible_venue_ids)::uuid[]))));

drop policy if exists reservation_series_staff_read on public.reservation_series;
create policy reservation_series_staff_read on public.reservation_series as permissive for select to authenticated
  using ((( SELECT app.is_staff(VARIADIC ARRAY['court_desk'::staff_role, 'cashier'::staff_role, 'manager'::staff_role, 'owner'::staff_role]) AS is_staff) AND (venue_id = ANY (( SELECT app.visible_venue_ids() AS visible_venue_ids)::uuid[]))));

drop policy if exists reservations_cashier_read on public.reservations;
create policy reservations_cashier_read on public.reservations as permissive for select to authenticated
  using ((( SELECT app.is_staff(VARIADIC ARRAY['cashier'::staff_role]) AS is_staff) AND (((start_at >= (now() - '1 day'::interval)) AND (start_at < (now() + '1 day'::interval))) OR (EXISTS ( SELECT 1
   FROM tabs t
  WHERE (t.reservation_id = reservations.id)))) AND (venue_id = ANY (( SELECT app.visible_venue_ids() AS visible_venue_ids)::uuid[]))));

drop policy if exists reservations_staff_read on public.reservations;
create policy reservations_staff_read on public.reservations as permissive for select to authenticated
  using ((( SELECT app.is_staff(VARIADIC ARRAY['court_desk'::staff_role, 'manager'::staff_role, 'owner'::staff_role]) AS is_staff) AND (venue_id = ANY (( SELECT app.visible_venue_ids() AS visible_venue_ids)::uuid[]))));

drop policy if exists salary_deductions_mgmt_read on public.salary_deductions;
create policy salary_deductions_mgmt_read on public.salary_deductions as permissive for select to authenticated
  using ((( SELECT app.is_staff(VARIADIC ARRAY['manager'::staff_role, 'owner'::staff_role]) AS is_staff) AND (venue_id = ANY (( SELECT app.visible_venue_ids() AS visible_venue_ids)::uuid[])) AND (staff_id IS DISTINCT FROM auth.uid())));

drop policy if exists shopping_items_mgmt_read on public.shopping_items;
create policy shopping_items_mgmt_read on public.shopping_items as permissive for select to authenticated
  using ((( SELECT app.is_staff(VARIADIC ARRAY['manager'::staff_role, 'owner'::staff_role]) AS is_staff) AND (venue_id = ANY (( SELECT app.visible_venue_ids() AS visible_venue_ids)::uuid[]))));

drop policy if exists staff_select on public.staff;
create policy staff_select on public.staff as permissive for select to authenticated
  using (((id = auth.uid()) OR ( SELECT app.is_staff(VARIADIC ARRAY['manager'::staff_role, 'owner'::staff_role]) AS is_staff)));

drop policy if exists staff_breaks_read_mgmt on public.staff_breaks;
create policy staff_breaks_read_mgmt on public.staff_breaks as permissive for select to authenticated
  using ((( SELECT app.is_staff(VARIADIC ARRAY['manager'::staff_role, 'owner'::staff_role]) AS is_staff) AND (venue_id = ANY (( SELECT app.visible_venue_ids() AS visible_venue_ids)::uuid[]))));

drop policy if exists staff_requests_read_mgmt on public.staff_requests;
create policy staff_requests_read_mgmt on public.staff_requests as permissive for select to authenticated
  using (( SELECT app.is_staff(VARIADIC ARRAY['manager'::staff_role, 'owner'::staff_role]) AS is_staff));

drop policy if exists staff_suggestions_mgmt_read on public.staff_suggestions;
create policy staff_suggestions_mgmt_read on public.staff_suggestions as permissive for select to authenticated
  using ((( SELECT app.is_staff(VARIADIC ARRAY['manager'::staff_role, 'owner'::staff_role]) AS is_staff) AND (venue_id = ANY (( SELECT app.visible_venue_ids() AS visible_venue_ids)::uuid[]))));

drop policy if exists staff_venues_read_mgmt on public.staff_venues;
create policy staff_venues_read_mgmt on public.staff_venues as permissive for select to authenticated
  using ((( SELECT app.is_staff(VARIADIC ARRAY['manager'::staff_role, 'owner'::staff_role]) AS is_staff) AND (venue_id = ANY (( SELECT app.visible_venue_ids() AS visible_venue_ids)::uuid[]))));

drop policy if exists station_staff_read_mgmt on public.station_staff;
create policy station_staff_read_mgmt on public.station_staff as permissive for select to authenticated
  using ((( SELECT app.is_staff(VARIADIC ARRAY['manager'::staff_role, 'owner'::staff_role]) AS is_staff) AND (venue_id = ANY (( SELECT app.visible_venue_ids() AS visible_venue_ids)::uuid[]))));

drop policy if exists stations_read_staff on public.stations;
create policy stations_read_staff on public.stations as permissive for select to authenticated
  using (((( SELECT app.staff_role() AS staff_role) IS NOT NULL) AND (venue_id = ANY (( SELECT app.visible_venue_ids() AS visible_venue_ids)::uuid[]))));

drop policy if exists stock_batches_mgmt_read on public.stock_batches;
create policy stock_batches_mgmt_read on public.stock_batches as permissive for select to authenticated
  using ((( SELECT app.is_staff(VARIADIC ARRAY['manager'::staff_role, 'owner'::staff_role]) AS is_staff) AND (venue_id = ANY (( SELECT app.visible_venue_ids() AS visible_venue_ids)::uuid[]))));

drop policy if exists stock_counts_mgmt_read on public.stock_counts;
create policy stock_counts_mgmt_read on public.stock_counts as permissive for select to authenticated
  using ((( SELECT app.is_staff(VARIADIC ARRAY['manager'::staff_role, 'owner'::staff_role]) AS is_staff) AND (venue_id = ANY (( SELECT app.visible_venue_ids() AS visible_venue_ids)::uuid[]))));

drop policy if exists stock_movements_mgmt_read on public.stock_movements;
create policy stock_movements_mgmt_read on public.stock_movements as permissive for select to authenticated
  using ((( SELECT app.is_staff(VARIADIC ARRAY['manager'::staff_role, 'owner'::staff_role]) AS is_staff) AND (venue_id = ANY (( SELECT app.visible_venue_ids() AS visible_venue_ids)::uuid[]))));

drop policy if exists stock_transfer_lines_mgmt_read on public.stock_transfer_lines;
create policy stock_transfer_lines_mgmt_read on public.stock_transfer_lines as permissive for select to authenticated
  using ((( SELECT app.is_staff(VARIADIC ARRAY['manager'::staff_role, 'owner'::staff_role]) AS is_staff) AND (EXISTS ( SELECT 1
   FROM stock_transfers t
  WHERE ((t.id = stock_transfer_lines.transfer_id) AND (t.venue_id = ANY (( SELECT app.visible_venue_ids() AS visible_venue_ids)::uuid[])))))));

drop policy if exists stock_transfers_mgmt_read on public.stock_transfers;
create policy stock_transfers_mgmt_read on public.stock_transfers as permissive for select to authenticated
  using ((( SELECT app.is_staff(VARIADIC ARRAY['manager'::staff_role, 'owner'::staff_role]) AS is_staff) AND (venue_id = ANY (( SELECT app.visible_venue_ids() AS visible_venue_ids)::uuid[]))));

drop policy if exists suppliers_mgmt_read on public.suppliers;
create policy suppliers_mgmt_read on public.suppliers as permissive for select to authenticated
  using ((( SELECT app.is_staff(VARIADIC ARRAY['manager'::staff_role, 'owner'::staff_role]) AS is_staff) AND (venue_id = ANY (( SELECT app.visible_venue_ids() AS visible_venue_ids)::uuid[]))));

drop policy if exists sync_replays_mgmt_read on public.sync_replays;
create policy sync_replays_mgmt_read on public.sync_replays as permissive for select to authenticated
  using (( SELECT app.is_staff(VARIADIC ARRAY['manager'::staff_role, 'owner'::staff_role]) AS is_staff));

drop policy if exists tabs_staff_read on public.tabs;
create policy tabs_staff_read on public.tabs as permissive for select to authenticated
  using ((( SELECT app.is_staff(VARIADIC ARRAY['cashier'::staff_role, 'court_desk'::staff_role, 'manager'::staff_role, 'owner'::staff_role]) AS is_staff) AND (venue_id = ANY (( SELECT app.visible_venue_ids() AS visible_venue_ids)::uuid[]))));

drop policy if exists tax_groups_read on public.tax_groups;
create policy tax_groups_read on public.tax_groups as permissive for select to anon, authenticated
  using (((is_active AND (( SELECT app.staff_role() AS staff_role) IS NULL) AND (venue_id = ANY (( SELECT app.open_venue_ids() AS open_venue_ids)::uuid[]))) OR ((( SELECT app.staff_role() AS staff_role) IS NOT NULL) AND (venue_id = ANY (( SELECT app.visible_venue_ids() AS visible_venue_ids)::uuid[])))));

drop policy if exists teachings_mgmt_read on public.teachings;
create policy teachings_mgmt_read on public.teachings as permissive for select to authenticated
  using ((( SELECT app.is_staff(VARIADIC ARRAY['manager'::staff_role, 'owner'::staff_role]) AS is_staff) AND (venue_id = ANY (( SELECT app.visible_venue_ids() AS visible_venue_ids)::uuid[]))));

drop policy if exists telegram_actions_mgmt_read on public.telegram_actions;
create policy telegram_actions_mgmt_read on public.telegram_actions as permissive for select to authenticated
  using ((( SELECT app.is_staff(VARIADIC ARRAY['manager'::staff_role, 'owner'::staff_role]) AS is_staff) AND (venue_id = ANY (( SELECT app.visible_venue_ids() AS visible_venue_ids)::uuid[]))));

drop policy if exists telegram_chats_mgmt_read on public.telegram_chats;
create policy telegram_chats_mgmt_read on public.telegram_chats as permissive for select to authenticated
  using (( SELECT app.is_staff(VARIADIC ARRAY['manager'::staff_role, 'owner'::staff_role]) AS is_staff));

drop policy if exists telegram_outbox_mgmt_read on public.telegram_outbox;
create policy telegram_outbox_mgmt_read on public.telegram_outbox as permissive for select to authenticated
  using ((( SELECT app.is_staff(VARIADIC ARRAY['manager'::staff_role, 'owner'::staff_role]) AS is_staff) AND (venue_id = ANY (( SELECT app.visible_venue_ids() AS visible_venue_ids)::uuid[]))));

drop policy if exists telegram_staff_mgmt_read on public.telegram_staff;
create policy telegram_staff_mgmt_read on public.telegram_staff as permissive for select to authenticated
  using (( SELECT app.is_staff(VARIADIC ARRAY['manager'::staff_role, 'owner'::staff_role]) AS is_staff));

drop policy if exists tickets_staff_read on public.tickets;
create policy tickets_staff_read on public.tickets as permissive for select to authenticated
  using ((( SELECT app.is_staff(VARIADIC ARRAY['prep'::staff_role, 'cashier'::staff_role, 'manager'::staff_role, 'owner'::staff_role, 'head_barista'::staff_role, 'barista'::staff_role, 'assistant_barista'::staff_role, 'head_chef'::staff_role, 'chef'::staff_role]) AS is_staff) AND (venue_id = ANY (( SELECT app.visible_venue_ids() AS visible_venue_ids)::uuid[]))));

drop policy if exists till_shifts_mgmt_read on public.till_shifts;
create policy till_shifts_mgmt_read on public.till_shifts as permissive for select to authenticated
  using ((( SELECT app.is_staff(VARIADIC ARRAY['manager'::staff_role, 'owner'::staff_role]) AS is_staff) AND (venue_id = ANY (( SELECT app.visible_venue_ids() AS visible_venue_ids)::uuid[]))));

drop policy if exists venue_settings_staff_read on public.venue_settings;
create policy venue_settings_staff_read on public.venue_settings as permissive for select to authenticated
  using (((( SELECT app.staff_role() AS staff_role) IS NOT NULL) AND (venue_id = ANY (( SELECT app.visible_venue_ids() AS visible_venue_ids)::uuid[]))));

drop policy if exists venues_read on public.venues;
create policy venues_read on public.venues as permissive for select to anon, authenticated
  using ((is_active OR (( SELECT app.staff_role() AS staff_role) IS NOT NULL)));

drop policy if exists waiter_calls_staff_read on public.waiter_calls;
create policy waiter_calls_staff_read on public.waiter_calls as permissive for select to authenticated
  using ((( SELECT app.is_staff(VARIADIC ARRAY['cashier'::staff_role, 'manager'::staff_role, 'owner'::staff_role, 'waiter'::staff_role]) AS is_staff) AND (venue_id = ANY (( SELECT app.visible_venue_ids() AS visible_venue_ids)::uuid[]))));

drop policy if exists menu_media_staff_delete on storage.objects;
create policy menu_media_staff_delete on storage.objects as permissive for delete to authenticated
  using (((bucket_id = 'menu-media'::text) AND ( SELECT app.is_staff(VARIADIC ARRAY['manager'::staff_role, 'owner'::staff_role]) AS is_staff)));

drop policy if exists menu_media_staff_insert on storage.objects;
create policy menu_media_staff_insert on storage.objects as permissive for insert to authenticated
  with check (((bucket_id = 'menu-media'::text) AND ( SELECT app.is_staff(VARIADIC ARRAY['manager'::staff_role, 'owner'::staff_role]) AS is_staff) AND ((storage.foldername(name))[1] = ANY (ARRAY['items'::text, 'categories'::text, 'hero'::text, 'courts'::text]))));

drop policy if exists menu_media_staff_update on storage.objects;
create policy menu_media_staff_update on storage.objects as permissive for update to authenticated
  using (((bucket_id = 'menu-media'::text) AND ( SELECT app.is_staff(VARIADIC ARRAY['manager'::staff_role, 'owner'::staff_role]) AS is_staff)))
  with check (((bucket_id = 'menu-media'::text) AND ( SELECT app.is_staff(VARIADIC ARRAY['manager'::staff_role, 'owner'::staff_role]) AS is_staff)));

drop policy if exists staff_media_delete on storage.objects;
create policy staff_media_delete on storage.objects as permissive for delete to authenticated
  using (((bucket_id = 'staff-media'::text) AND ( SELECT app.is_staff(VARIADIC ARRAY['manager'::staff_role, 'owner'::staff_role]) AS is_staff) AND (app.staff_media_venue(name) = ANY (app.staff_venue_ids())) AND (app.staff_media_folder(name) IS DISTINCT FROM 'incidents'::text)));

