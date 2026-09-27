-- 0151_out_of_stock_alert — an empty shelf raises its own alert, and stops
-- raising the wrong one (manager report, 2026-09-23).
--
-- Two things were wrong on /stock/alerts. An ingredient used past what was on
-- record raised BOTH negative_stock ("Sold past what was on record") and
-- low_stock ("Running low") — the second is not true and not useful: there is
-- nothing left to run low on, and it is a second row to dismiss for one event.
-- And an ingredient that simply emptied raised nothing at all unless it had a
-- reorder point, because app.trg_low_stock_alert returned early when
-- low_stock_threshold was null. Most ingredients here have no threshold set,
-- so "almost everything is out of stock and there is no alert for any of it".
--
-- No new enum value. An empty shelf is a low_stock alert carrying "out": true,
-- the same shape expiring_soon already uses for "expired": true (0018), and
-- the alerts screen splits the two into their own groups. Widening alert_kind
-- would cost an enum migration of its own, a regenerated types.gen.ts and a
-- rewrite of every reader, to say what the payload already says.
--
-- "Drawn past the records" is the ledger sum (sum of qty_delta, overdrafts
-- included — the "theoretical" of v_ingredient_on_hand, 0019) being below
-- zero, not the shape of the row that fired the trigger: a count shortage
-- writes a batch-less negative movement too (0019:150), and an ingredient
-- counted down to zero SHOULD hear that it is out.
--
-- Read on the out-of-stock path only, so an ordinary sale that leaves stock
-- above zero does no extra work. Covered by stock_movements_ingredient_at.
--
-- No schema change; one trigger function, plus a correction to the alerts
-- already sitting open on the screen.

set lock_timeout = '3s';
set statement_timeout = '60s';

-- Latest body: 0018:506. Changes are the out-of-stock branch, the severity in
-- the dedupe, and "out" in the payload.
create or replace function app.trg_low_stock_alert() returns trigger
language plpgsql security definer set search_path = public as $trg_low_stock_alert_0151$
declare
  v_threshold numeric;
  v_on_hand   numeric;
  v_out       boolean;
begin
  v_on_hand := app.ingredient_on_hand(new.ingredient_id);
  v_out     := v_on_hand <= 0;
  select low_stock_threshold into v_threshold from ingredients where id = new.ingredient_id;

  if v_out then
    -- One event, one alert: consume_fefo is raising negative_stock for this
    -- shortfall in the same statement (0018:119), and that alert is the truer
    -- one — it carries how much was taken beyond the record and sends the
    -- manager to a count, which is the only thing that fixes it.
    if (select coalesce(sum(qty_delta), 0) from stock_movements
         where ingredient_id = new.ingredient_id) < 0 then
      return new;
    end if;
  elsif v_threshold is null or v_on_hand > v_threshold then
    return new;                                    -- still above the reorder point
  end if;

  -- One open alert per ingredient PER SEVERITY. Deduping on the ingredient
  -- alone (the 0018 rule) meant an ingredient that had already raised
  -- "running low" went quiet when it later emptied, which is the moment worth
  -- hearing about.
  if exists (select 1 from manager_alerts
              where kind = 'low_stock' and acknowledged_at is null
                and payload->>'ingredient_id' = new.ingredient_id::text
                and coalesce((payload->>'out')::boolean, false) = v_out) then
    return new;
  end if;

  insert into manager_alerts (kind, payload)
  values ('low_stock', jsonb_build_object('ingredient_id', new.ingredient_id,
          'on_hand', v_on_hand, 'threshold', v_threshold, 'out', v_out));
  return new;
end $trg_low_stock_alert_0151$;

-- ---------------------------------------------------------------------------
-- The alerts already open on the screen. The trigger only fires on the next
-- movement, and an ingredient that is empty has nothing left to move — without
-- this the wrong rows stay on /stock/alerts until someone dismisses them one
-- by one.
-- ---------------------------------------------------------------------------

-- Drawn past the records: negative_stock says this already.
update manager_alerts a
   set acknowledged_at = now()
 where a.kind = 'low_stock'
   and a.acknowledged_at is null
   and a.payload->>'ingredient_id' is not null
   and (select coalesce(sum(m.qty_delta), 0) from stock_movements m
         where m.ingredient_id = (a.payload->>'ingredient_id')::uuid) < 0;

-- Simply empty: the same alert, relabelled. Re-raising would move it to the
-- top of the list as though it had just happened.
update manager_alerts a
   set payload = a.payload || jsonb_build_object('out', true, 'on_hand', 0)
 where a.kind = 'low_stock'
   and a.acknowledged_at is null
   and a.payload->>'ingredient_id' is not null
   and coalesce((a.payload->>'out')::boolean, false) = false
   and app.ingredient_on_hand((a.payload->>'ingredient_id')::uuid) <= 0;
