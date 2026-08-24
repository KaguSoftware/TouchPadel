-- 0002_enums_domains — every enum in the system (design-data.md §1.0) plus money domains.
-- All enums are created up front, including ones first used by later migrations, so
-- later drops never need to touch this file.

create type staff_role         as enum ('cashier','prep','court_desk','manager','owner');
create type reservation_kind   as enum ('booking','hold','maintenance');
create type reservation_status as enum ('pending','confirmed','arrived','completed','cancelled','no_show','expired');
create type reservation_source as enum ('mobile','desk');
create type tab_status         as enum ('open','awaiting_payment','settled','void');
create type order_source       as enum ('guest_web','till');
create type order_status       as enum ('sent','preparing','ready','served','voided');
create type ticket_status      as enum ('queued','preparing','ready','completed','voided');
create type payment_method     as enum ('cash','card');
create type adjustment_kind    as enum ('discount_percent','discount_amount','price_override');
create type waiter_call_reason as enum ('order','bill','water','assistance');
create type waiter_call_status as enum ('raised','acknowledged','resolved');
create type ingredient_kind    as enum ('purchased','prepared');   -- 'prepared' = sub-recipe output
create type stock_unit         as enum ('g','ml','pc');
create type movement_type      as enum ('goods_in','production_in','sale_consumption','production_consume',
                                        'waste_spill','waste_spoilage','void_after_send','expired_writeoff',
                                        'count_adjustment','refund_reversal');
create type alert_kind         as enum ('negative_stock','low_stock','expiring_soon','replay_conflict');
create type day_status         as enum ('open','closing','closed');

-- Money: INTEGER IQD everywhere. bigint domains — no numeric, no floats on money.
create domain iqd as bigint check (value >= 0);   -- unsigned money
create domain iqd_signed as bigint;               -- deltas / variances
