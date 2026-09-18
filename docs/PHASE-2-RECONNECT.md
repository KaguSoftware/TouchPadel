# Reconnecting the Live floor plan

The operator's **Live floor** — the venue drawn as a three-dimensional plan, on
the owner's landing screen and on Observe's home — is switched off behind a
Phase 2 gate. This page is how you switch it back on.

## Reconnect it

Open [apps/operator/src/features/floor/phaseGate.ts](../apps/operator/src/features/floor/phaseGate.ts)
and change one word:

```ts
export const HELD_FOR_PHASE_2: boolean = false;
```

That is the whole revert. Save, and Vite's hot reload brings the plan back in
place: the two realtime subscriptions open, the first read lands, the three.js
chunk is fetched and the scene draws. Nothing else is edited, nothing is
uncommented, and there is no second switch anywhere.

If you prefer it as a command, from the repository root:

```bash
sed -i '' 's/HELD_FOR_PHASE_2: boolean = true/HELD_FOR_PHASE_2: boolean = false/' \
  apps/operator/src/features/floor/phaseGate.ts
```

Then check it took:

```bash
grep -n 'HELD_FOR_PHASE_2: boolean' apps/operator/src/features/floor/phaseGate.ts
```

## What the gate turns off

The feature is switched off, not removed. Every file it is built from is
untouched and every code path below the flag is the real one.

| Off while gated | Where | Back on when the flag flips |
| --- | --- | --- |
| The `floor` realtime subscription (private, staff) | `floorData.ts` | Yes |
| The `courts` realtime subscription (private) | `floorData.ts` | Yes |
| The eight-table read, and its 30 s poll | `floorData.ts` | Yes |
| The plan's live layer: courts in play, the rally, open tabs, staff pins | `LiveFloor.tsx` → `floorScene.ts` | Yes |
| Zoom, full screen and the drag hint | `LiveFloor.tsx` | Yes |

The sockets are **never opened**, rather than opened and closed. Both
subscriptions are created with `enabled: false`, so `useBroadcast` returns
before it reaches `supabase.channel(...)`: no WebSocket frame is sent, realtime
auth is not set, and the 4–7 second reconnect timer never starts. The same is
true of the read — the query is disabled, so the gate costs the venue nothing
every thirty seconds.

The plan itself is still drawn, and only its architecture. The scene builds the
venue once and paints the live layer onto it, so handed an empty floor it draws
the building, the courts and the cage and paints nothing on them: no court in
play, no rally, no open tab, no staff pin. It is motionless by construction
rather than by a pause flag, because the rally loop runs only on a court the
server calls in play and the server is not being asked.

## What you see instead

The panel still mounts and still lays itself out. It is fed an empty floor and
reports its connection as disconnected, which is the honest picture of a plan
with no feed: every count reads zero of zero, the venue stands there empty and
still, and the whole body is blurred behind the words **COMING IN PHASE 2**
(**قريباً في المرحلة الثانية** in Arabic).

The blur is deliberately light. The plan should still read as the venue — the
courts, the building, the shape of the place — while nothing written or marked
on it can be read. Zoom, full screen and the drag hint are not offered at all:
there is no state to explore, and a control behind a blur only looks broken.

The blurred half is marked `inert` and `aria-hidden`, so nobody reaches it by
keyboard, mouse or screen reader while it is closed.

## The wording

The notice says **coming in phase 2**, not *restricted*. "Restricted" reads as
a door somebody locked, and invites the question of who is allowed through it.
This is a roadmap note, and that is the whole story anyone outside the build
needs.

It is held in `phaseGate.ts` in both languages rather than in the i18n
catalogues, because it should leave with the flag. A catalogue key would
outlive it — a string still being translated long after the plan came back on.

## Why it is built this way

Deleting the plan would mean writing it again. Commenting it out would mean a
merge conflict for whoever touches those files first. A gate keeps the feature
compiling, type-checked and covered by its own tests the whole time it is off,
so flipping it back is a change of one character rather than a piece of
archaeology.

The flag is annotated `: boolean` on purpose. Left to infer the literal `true`,
TypeScript would narrow the live branches to dead code and reject the flip as a
compile error — the opposite of a one-character revert.

The label itself is a plain constant rather than a translation key. It is a
build-state notice for the people building this, not venue copy, and it should
leave with the flag instead of leaving a string behind in the catalogues.

## When you have reconnected it

1. Delete `apps/operator/src/features/floor/phaseGate.ts`.
2. Remove its references in `floorData.ts` and `LiveFloor.tsx`, which
   `grep -rn PHASE_2 apps/operator/src` will list, and delete
   `phaseGate.test.tsx` with them.
3. Delete this page.
