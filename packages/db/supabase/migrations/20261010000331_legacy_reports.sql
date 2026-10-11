-- 0331 legacy_reports — the club's monthly reports from before the system,
-- kept exactly as they were written (owner call 2026-10-10: "absolutely 0
-- made-up numbers, everything 100% accurate, every piece of info attached").
--
-- What arrived. Hussein al-Sarraf's monthly padel-desk reports (قسم البدل),
-- June to September 2026: four Word files, each a header table (employee,
-- period), a summary paragraph, a count table and a chart image, two of them
-- with an amount of money. They are counts for a whole month. They name no
-- court, no hour, no guest and no price, so they cannot become reservations
-- or tabs without inventing all of that; they are stored as what they are.
--
-- What. Two tables, both empty here (the rows are client data, loaded by
-- scripts/db-legacy-reports.mjs from client-data/padel-monthly-2026/reports.json,
-- which tests/legacy-reports-source.test.ts proves against the original files):
--   * legacy_reports         one row per report: the period as written and as
--                            dates, the report number, the employee, the
--                            summary text, the amount of money if the report
--                            gives one (with its words, its currency only if
--                            written, and whether it says "approximately"),
--                            the chart's own text, the original file's name
--                            and sha256, and the review notes (where one part
--                            of a report disagrees with another).
--   * legacy_report_figures  one row per figure, per part of the report it
--                            appears in: the count table, the summary
--                            paragraph and the chart. A figure keeps the label
--                            its own part gives it, so a report whose table
--                            and summary disagree keeps both; a blank table
--                            cell is a null count, never zero.
-- Nothing is computed: no percentage, no total, no derived rate is stored.
--
-- Who. The owner reads both (the analytics rule: reports are the owner's), at
-- the branches in scope. No client writes: the service role loads them. The
-- owner assistant reads them through table_read (rows below in
-- app.assistant_readable_columns).
--
-- Re-runnable: create table if not exists, drop/create policy and trigger,
-- on conflict do nothing.

set lock_timeout = '3s';
set statement_timeout = '60s';

-- ---------------------------------------------------------------------------
-- 1. legacy_reports
-- ---------------------------------------------------------------------------
create table if not exists legacy_reports (
  id                      uuid primary key,
  venue_id                uuid not null references venues(id),
  department              text not null,
  period_from             date not null,
  period_to               date not null,
  period_stated           text not null,
  title_stated            text not null,
  report_no               int,
  report_no_stated        text not null,
  employee_name           text not null,
  section_heading_stated  text not null,
  summary_stated          text not null,
  revenue_amount          bigint,
  revenue_stated          text,
  revenue_words_stated    text,
  revenue_currency_stated text,
  revenue_approximate     boolean not null default false,
  chart_language          text,
  chart_title             text,
  chart_subtitle          text,
  chart_total_line        text,
  chart_caption           text,
  review_notes_en         text not null default '',
  review_notes_ar         text not null default '',
  source_file             text not null,
  source_sha256           text not null,
  source_created_at       timestamptz,
  imported_at             timestamptz not null default now(),
  constraint legacy_reports_department_chk check (department in ('padel')),
  constraint legacy_reports_period_chk check (period_to >= period_from),
  constraint legacy_reports_revenue_chk check (
    (revenue_amount is null) = (revenue_stated is null)
    and (revenue_amount is null or revenue_amount >= 0)
    and (revenue_amount is not null or (revenue_words_stated is null
                                        and revenue_currency_stated is null
                                        and not revenue_approximate))),
  constraint legacy_reports_chart_chk check (chart_language is null or chart_language in ('en', 'ar')),
  constraint legacy_reports_sha_chk check (source_sha256 ~ '^[0-9a-f]{64}$'),
  constraint legacy_reports_month_key unique (venue_id, department, period_from)
);

comment on table legacy_reports is
  'legacy_reports (0331): a monthly report written before the system, stored exactly as written; one row per report. Today: Hussein al-Sarraf''s padel-desk reports for June to September 2026 (client-data/padel-monthly-2026). Counts are for the whole period and name no court, hour, guest or price; they are not reservations and never enter a live report''s figures. The figures are in legacy_report_figures. Where one part of a report disagrees with another, review_notes_en/ar say so. Read by the owner; written only by the service role (scripts/db-legacy-reports.mjs).';
comment on column legacy_reports.id is 'The report (a 70c4 client-data id).';
comment on column legacy_reports.venue_id is 'The branch the report is about.';
comment on column legacy_reports.department is 'Which part of the club: padel (قسم البدل, the court desk).';
comment on column legacy_reports.period_from is 'The first day of the period, as the report writes it.';
comment on column legacy_reports.period_to is 'The last day of the period, as the report writes it (July''s report says 30/7, so it is 2026-07-30, not the 31st).';
comment on column legacy_reports.period_stated is 'The period exactly as written in the report, e.g. ١/٦/2026_٣٠/٦/2026.';
comment on column legacy_reports.title_stated is 'The report''s title line, exactly as written.';
comment on column legacy_reports.report_no is 'The report number as a number. Not a sequence: June is 4, July and August are both 5, September is 3.';
comment on column legacy_reports.report_no_stated is 'The report-number line exactly as written.';
comment on column legacy_reports.employee_name is 'Who wrote the report, as written.';
comment on column legacy_reports.section_heading_stated is 'The heading above the summary, exactly as written.';
comment on column legacy_reports.summary_stated is 'The summary paragraph(s), exactly as written; several paragraphs are joined by a newline.';
comment on column legacy_reports.revenue_amount is 'The amount of money the report gives, as a number; null when the report gives none (June, September). The report does not say what it covers beyond the month.';
comment on column legacy_reports.revenue_stated is 'The line carrying the amount, exactly as written.';
comment on column legacy_reports.revenue_words_stated is 'The amount written in words, when the report writes it.';
comment on column legacy_reports.revenue_currency_stated is 'The currency only when the report names it (July: دينار عراقي); null when it does not (August).';
comment on column legacy_reports.revenue_approximate is 'True when the report itself calls the amount approximate (August: تقريبا).';
comment on column legacy_reports.chart_language is 'The language of the chart image: en or ar.';
comment on column legacy_reports.chart_title is 'The chart image''s title, typed from the image.';
comment on column legacy_reports.chart_subtitle is 'The chart image''s subtitle, typed from the image.';
comment on column legacy_reports.chart_total_line is 'The chart image''s total line, typed from the image.';
comment on column legacy_reports.chart_caption is 'The chart image''s footer, typed from the image.';
comment on column legacy_reports.review_notes_en is 'Where the report disagrees with itself or leaves something out, one note per line, in English. Read these before quoting a figure.';
comment on column legacy_reports.review_notes_ar is 'The same notes in Arabic.';
comment on column legacy_reports.source_file is 'The original Word file''s name as received.';
comment on column legacy_reports.source_sha256 is 'sha256 of the original Word file (client-data/padel-monthly-2026/originals).';
comment on column legacy_reports.source_created_at is 'When the Word file was created, from its own properties.';
comment on column legacy_reports.imported_at is 'When the row was loaded.';

alter table legacy_reports enable row level security;
revoke all on legacy_reports from anon, authenticated;

drop policy if exists legacy_reports_owner_read on legacy_reports;
create policy legacy_reports_owner_read on legacy_reports
  for select to authenticated
  using ((select app.is_staff('owner'))
         and venue_id = any((select app.visible_venue_ids())::uuid[]));

grant select on legacy_reports to authenticated;
grant all on legacy_reports to service_role;

drop trigger if exists zz_branch_guard on public.legacy_reports;
create trigger zz_branch_guard before insert or update or delete on public.legacy_reports
  for each row execute function app.trg_branch_guard('scoped');

-- ---------------------------------------------------------------------------
-- 2. legacy_report_figures
-- ---------------------------------------------------------------------------
create table if not exists legacy_report_figures (
  report_id      uuid not null references legacy_reports(id) on delete cascade,
  venue_id       uuid not null references venues(id),
  source         text not null,
  position       smallint not null,
  category       text not null,
  label_stated   text not null,
  count          int,
  count_stated   text,
  percent_stated text,
  note_stated    text,
  primary key (report_id, source, position),
  constraint legacy_report_figures_source_chk check (source in ('table', 'summary', 'chart')),
  constraint legacy_report_figures_position_chk check (position > 0),
  constraint legacy_report_figures_category_chk check (category in (
    'total', 'completed', 'not_completed', 'cancelled', 'training', 'not_booked', 'free', 'no_show')),
  constraint legacy_report_figures_count_chk check (
    (count is null or count >= 0)
    and (source = 'table' or count is not null)
    and ((source = 'table') = (count_stated is not null)))
);

comment on table legacy_report_figures is
  'legacy_report_figures (0331): every figure of a legacy_reports row, once per part of the report it appears in: source table (the count table), summary (the summary paragraph) or chart (the chart image). A figure keeps the label its own part gives it, so when a report''s parts disagree (August: the table says cancelled 207, the summary and chart say not completed 207 and cancelled 105) both stand, and legacy_reports.review_notes_en says so. A blank table cell is a null count, never zero. The rows of a report''s total category are what the report calls its total; whether that is bookings or court slots the reports do not say. Read by the owner; written only by the service role.';
comment on column legacy_report_figures.report_id is 'The report (legacy_reports).';
comment on column legacy_report_figures.venue_id is 'The branch: the report''s.';
comment on column legacy_report_figures.source is 'Which part of the report: table, summary or chart.';
comment on column legacy_report_figures.position is 'Its order within that part, from 1.';
comment on column legacy_report_figures.category is 'What the label says, as one key: total, completed (منجز), not_completed (غير منجز), cancelled (ملغاة), training (تدريب), not_booked (لم يحجز), free (مجاني), no_show (لم يحضر). From the label only, never from the number.';
comment on column legacy_report_figures.label_stated is 'The label exactly as written: the table''s row label, the summary''s phrase that carries the figure, or the chart''s label.';
comment on column legacy_report_figures.count is 'The figure as a number; null only for a blank table cell.';
comment on column legacy_report_figures.count_stated is 'The table cell exactly as written (table rows only), e.g. ٢٨٥ حجز.';
comment on column legacy_report_figures.percent_stated is 'The percentage exactly as written beside it, if any; never computed.';
comment on column legacy_report_figures.note_stated is 'The table''s note beside it, exactly as written, if any.';

alter table legacy_report_figures enable row level security;
revoke all on legacy_report_figures from anon, authenticated;

drop policy if exists legacy_report_figures_owner_read on legacy_report_figures;
create policy legacy_report_figures_owner_read on legacy_report_figures
  for select to authenticated
  using ((select app.is_staff('owner'))
         and venue_id = any((select app.visible_venue_ids())::uuid[]));

grant select on legacy_report_figures to authenticated;
grant all on legacy_report_figures to service_role;

-- 'scoped': the row carries venue_id, which must be its report's.
drop trigger if exists zz_branch_guard on public.legacy_report_figures;
create trigger zz_branch_guard before insert or update or delete on public.legacy_report_figures
  for each row execute function app.trg_branch_guard('scoped', 'legacy_reports', 'report_id');

-- ---------------------------------------------------------------------------
-- 3. The owner assistant may read both (table_read), as 0109 seeds any table.
-- ---------------------------------------------------------------------------
insert into app.assistant_readable_columns (table_name, column_name, kind, is_default, data_type, ordinal, note)
select c.table_name,
       c.column_name,
       case when t.table_type = 'VIEW' then 'view' else 'table' end,
       not (c.column_name in ('before', 'after', 'payload', 'idempotency_key', 'device_id',
                              'client_ref', 'photo_path', 'photo_blur')
            or c.data_type = 'jsonb'),
       c.data_type,
       c.ordinal_position,
       col_description(format('public.%I', c.table_name)::regclass, c.ordinal_position)
  from information_schema.columns c
  join information_schema.tables t
    on t.table_schema = c.table_schema and t.table_name = c.table_name
 where c.table_schema = 'public'
   and t.table_type in ('BASE TABLE', 'VIEW')
   and c.table_name in ('legacy_reports', 'legacy_report_figures')
on conflict (table_name, column_name) do nothing;
