-- 0243 shop_desk_enums — Touch Shop as its own desk: the shop assistant role
-- and the shop store.
--
-- Feature: Touch Shop, own desk (Parsa, 2026-09-27: "the touch shop has its
-- own desk, its own stock, its own items"; plan: docs/design/shop/
-- shop-desk-2026-09-27.md). Replaces the café-hybrid of 0143–0146, where a
-- shop product was sold on the café till and kept in the café store.
-- Depends on: nothing.
-- Re-runnable: add value if not exists.
--
-- Enum widening is its own file, strictly before its first use
-- (packages/db/CLAUDE.md, Migrations; 0143, 0155, 0191 are the precedents):
-- shop_desk_access and shop_store, the next files, use both values.
--
-- shop_staff is appended after waiter: staff-roles-parity.test.ts compares
-- enum_range(null::staff_role) with @touch/core STAFF_ROLES in order. On its
-- own the value gets the any-staff baseline 0156 made role-agnostic and
-- nothing else; every till, money and stock guard names the roles it admits.
--
-- 'shop' is appended after bakery (0200:24 planned "a third store is an add
-- value in its own file"). From shop_store on, retail stock lives only there.
--
-- covered by packages/db/tests/staff-roles-parity.test.ts and
-- packages/db/tests/shop-desk.test.ts

set lock_timeout = '3s';
set statement_timeout = '60s';

alter type staff_role add value if not exists 'shop_staff';
alter type stock_location add value if not exists 'shop';
