-- 0191 staff_roles_assistant_waiter — two staff roles: the assistant barista
-- (Hussein) and the waiter (Hasan).
--
-- Feature: protocols and the staff phone, wave 5, lane R
-- (docs/design/protocols/wave5-addendum-2026-09-25.md §2.1.3, §2.1.5, §2.11;
-- Majed's answer #1).
-- Depends on: nothing.
-- Re-runnable: add value if not exists.
--
-- Enum widening is its own file, strictly before its first use
-- (packages/db/CLAUDE.md, Migrations; 0143, 0155 and 0171 are the
-- precedents): assistant_barista_waiter_access, the next R file, opens the
-- guards to the new values. A value can never be dropped, which is why the
-- two roles waited for Majed's yes.
--
-- Both are appended after marketing: staff-roles-parity.test.ts compares
-- enum_range(null::staff_role) with @touch/core STAFF_ROLES in order.
--
-- On their own the two values get what 0156 made role-agnostic (the
-- any-staff baseline) and nothing else: every explicit list names the roles
-- it admits.
--
-- covered by packages/db/tests/staff-roles-parity.test.ts and
-- packages/db/tests/assistant-barista-waiter.test.ts

set lock_timeout = '3s';
set statement_timeout = '60s';

alter type staff_role add value if not exists 'assistant_barista';
alter type staff_role add value if not exists 'waiter';
