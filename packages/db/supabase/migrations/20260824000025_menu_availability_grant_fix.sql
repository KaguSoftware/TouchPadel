-- 0025_menu_availability_grant_fix — menu_item_availability was unreadable by
-- EVERY client role (found by the e2e suite: the till menu load hard-fails,
-- and web/guest surfaces silently lose ingredient-out greying).
--
-- Root cause: the 0018 view body calls app.item_required_ingredients(...) and
-- app.ingredient_on_hand(...), whose EXECUTE was revoked from anon and
-- authenticated ("internal-only"). A view's *relation* access is checked
-- against the view owner (security_invoker = off), but EXECUTE on functions
-- referenced in the view body is checked against the SESSION user — so every
-- client select on the view raised "permission denied for function
-- item_required_ingredients".
--
-- Fix that keeps the internal helpers revoked: wrap the availability logic in
-- ONE purpose-built SECURITY DEFINER function (runs as owner, so it may call
-- the internal helpers), grant EXECUTE on that alone, and point the view at it.

create or replace function app.menu_availability()
returns table (item_id uuid, orderable boolean)
language sql stable security definer set search_path = public as $$
  select mi.id as item_id,
         mi.is_active and coalesce(mi.unavailable_on <> current_date, true)
           and not exists (
             select 1 from app.item_required_ingredients(mi.id) ri
             where app.ingredient_on_hand(ri.ingredient_id) <= 0
           ) as orderable
    from menu_items mi
$$;

revoke all on function app.menu_availability() from public;
grant execute on function app.menu_availability() to anon, authenticated;

-- Same columns, same name — clients keep selecting the view untouched.
create or replace view menu_item_availability with (security_invoker = off) as
select item_id, orderable from app.menu_availability();

grant select on menu_item_availability to anon, authenticated;
