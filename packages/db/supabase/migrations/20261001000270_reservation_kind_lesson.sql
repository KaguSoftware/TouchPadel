set lock_timeout = '3s';
set statement_timeout = '60s';

-- 0270 reservation_kind_lesson — coaching, lane DB (docs/design/coaching/db.md
-- §4.1; build contracts §1.1, §1.2).
--
-- reservation_kind gains 'lesson': the court row of one lesson session
-- (guest_id NULL, guest_name 'Lesson', reservations.lesson_id set, 0275).
-- Alone in its file, as 0143 and 0155 were: a new enum value cannot be used in
-- the transaction that adds it, and nothing here uses it. Nothing writes a
-- lesson row before 0280; 0277 teaches the reservation bodies that a lesson is
-- firm, masked as a booking in court_availability, and changed only through
-- the coaching RPCs (LESSON_VIA_COACHING).

alter type reservation_kind add value if not exists 'lesson';
