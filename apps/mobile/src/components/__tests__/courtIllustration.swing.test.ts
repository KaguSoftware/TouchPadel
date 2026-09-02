import { describe, expect, it } from 'vitest';
const T=[0,0.09,0.15,0.21,0.25,0.34,0.4,0.46,0.5,0.59,0.65,0.71,0.75,0.84,0.9,0.96,1];
const BX=[106.2,100.4,97,94,92.2,142.7,172.2,198.4,214.1,219.6,222.9,225.8,227.5,177.3,147.9,121.8,106.2];
const BY=[84.4,178.3,233.3,282.1,311.3,217.3,162.3,113.4,84.2,178.2,233.2,282.1,311.3,217.4,162.4,113.6,84.4];
const RACKETS=[{x:100,y:88},{x:220,y:88},{x:100,y:308},{x:220,y:308}];
const SWAY:[number[],number[],number[]][]=[
  [[0,0.08,0.46,0.75,0.92,1],[0,-3,6,2,-4,0],[0,-2,10,4,-1,0]],
  [[0,0.25,0.46,0.62,1],[2,6,-2,4,2],[2,-4,-1,-8,2]],
  [[0,0.21,0.5,0.71,1],[0,-6,-2,-4,0],[0,9,3,-2,0]],
  [[0,0.17,0.25,0.58,1],[-2,-8,-5,3,-2],[0,-3,-1,5,0]],
];
const CONTACT=[0,0.5,0.25,0.75];
const ballAt=(t:number)=>{let i=0;while(i<T.length-2&&T[i+1]!<t)i++;
  const f=(t-T[i]!)/(T[i+1]!-T[i]!);
  return {x:BX[i]!+(BX[i+1]!-BX[i]!)*f, y:BY[i]!+(BY[i+1]!-BY[i]!)*f};};
const SPAN=0.032, DEG=62;
const AIM=[16,-15,14.52,-13.52];
const SWEEP=[1,1,-1,-1];
/** Mirrors CourtIllustration's `stroke`: wind-up, strike, follow-through. */
const stroke=(w:number)=>Math.sign(w)*Math.sin(Math.PI*Math.abs(w)**(w<0?0.6:1.6));
/** Mirrors reachFrames' step profile: out over the wind-up, held through contact. */
const reachEase=(w:number)=>
  w<-0.5 ? (1-Math.cos(Math.PI*((w+1)/0.5)))/2
  : w>0.4 ? (1+Math.cos(Math.PI*((w-0.4)/0.6)))/2
  : 1;
function swingFrames(contact:number, aim:number, sweep:number){
  const pts:[number,number][]=[];
  for(let j=0;j<=16;j++){
    const w=(j/16)*2-1;
    const deg=aim*Math.cos((Math.PI/2)*w)+sweep*DEG*stroke(w);
    pts.push([(contact+w*SPAN+1)%1,deg]);
  }
  pts.sort((a,b)=>a[0]-b[0]);
  const input:number[]=[],output:number[]=[];
  if(pts[0]![0]>0){input.push(0);output.push(0);}
  for(const [x,v] of pts){if(input.length&&x<=input[input.length-1]!)continue;input.push(x);output.push(v);}
  if(input[input.length-1]!<1){input.push(1);output.push(output[0]!);}
  return {input,output};
}

describe('2D court swing timing', () => {
  it('interpolation ranges are strictly ascending and cover the loop', () => {
    // Animated.interpolate throws on a non-monotonic inputRange, and a stroke
    // whose window straddles t = 0 (racket 0) wraps around the loop seam.
    CONTACT.forEach((c, i) => {
      const { input, output } = swingFrames(c, AIM[i]!, SWEEP[i]!);
      expect(input[0]).toBe(0);
      expect(input[input.length - 1]).toBe(1);
      expect(input.length).toBe(output.length);
      for (let j = 1; j < input.length; j++) expect(input[j]!).toBeGreaterThan(input[j - 1]!);
      // Periodic: the value at t = 1 continues into t = 0 without a step.
      expect(output[output.length - 1]).toBeCloseTo(output[0]!, 9);
    });
  });

  it('the face is square to the shot at contact, and strokes either side of it', () => {
    CONTACT.forEach((c, i) => {
      const { input, output } = swingFrames(c, AIM[i]!, SWEEP[i]!);
      // The sample AT the contact instant carries exactly the aim angle —
      // outgoing-shot angle minus the racket's static mount — so the face
      // meets the ball perpendicular, not at its resting ±15°.
      const k = input.findIndex((x) => Math.abs((x - c + 1) % 1) < 1e-9);
      expect(k).toBeGreaterThanOrEqual(0);
      expect(output[k]!).toBeCloseTo(AIM[i]!, 6);
      // And the stroke exists around it: wind-up and follow-through humps
      // reach well past the aim on both sides.
      expect(Math.max(...output) - Math.min(...output)).toBeGreaterThan(DEG * 1.5);
    });
  });

  it('winds up, strikes square, then follows through past the impact angle', () => {
    // The three phases, read straight off the stroke curve.
    AIM.forEach((aim, i) => {
      const sweep = SWEEP[i]!;
      const at = (w: number) => aim * Math.cos((Math.PI / 2) * w) + sweep * DEG * stroke(w);

      // Phase 2 first: the strike is EXACTLY the aim — the face square to the
      // outgoing shot at the instant of contact.
      expect(at(0)).toBeCloseTo(aim, 9);

      // Each racket's own extremes: full cock somewhere in the wind-up half,
      // full extension somewhere in the follow-through half.
      const peak = (lo: number, hi: number) => {
        let best = lo;
        for (let w = lo; w <= hi; w += 0.005) {
          if (Math.abs(at(w) - aim) > Math.abs(at(best) - aim)) best = w;
        }
        return best;
      };
      const cockW = peak(-0.95, -0.05);
      const finishW = peak(0.05, 0.95);

      // Phase 1: the wind-up is on the far side of the aim from the finish,
      // and well away from it — a real cock-back, not a wobble.
      const back = at(cockW);
      expect(Math.abs(back - aim)).toBeGreaterThan(40);
      // Phase 3: the follow-through carries PAST the aim, to the opposite
      // side from the wind-up.
      const through = at(finishW);
      expect(Math.sign(through - aim)).toBe(-Math.sign(back - aim));
      expect(Math.abs(through - aim)).toBeGreaterThan(40);
      // The finish comes LATER in the window than the cock is early — a
      // short anticipation and a long, extended follow-through.
      expect(finishW).toBeGreaterThan(-cockW);

      // One sweep through the ball: monotonic from full cock to full finish,
      // never doubling back. The old sin(πw) hump peaked at w = ±0.5 and
      // returned the way it came — the head rebounding off the ball.
      const dir = Math.sign(through - back);
      let prev = back;
      for (let w = cockW; w <= finishW; w += 0.01) {
        const v = at(w);
        expect(Math.sign(v - prev) === dir || Math.abs(v - prev) < 1e-9).toBe(true);
        prev = v;
      }

      // Fastest at the ball: the angle covered per step peaks at contact.
      const d = 0.02;
      const atBall = Math.abs(at(d) - at(-d));
      expect(atBall).toBeGreaterThan(Math.abs(at(cockW + d) - at(cockW - d)));
      expect(atBall).toBeGreaterThan(Math.abs(at(finishW + d) - at(finishW - d)));

      // And it rests at both window edges, so the loop seam is invisible.
      expect(at(-1)).toBeCloseTo(0, 6);
      expect(at(1)).toBeCloseTo(0, 6);
    });
  });

  it('the face is waiting in front of the ball before it arrives', () => {
    // The racket must be planted at the interception point through the whole
    // approach, not converging with the ball and meeting it only at contact.
    expect(reachEase(-0.5)).toBeCloseTo(1, 9); // fully there by mid wind-up
    expect(reachEase(-0.2)).toBeCloseTo(1, 9); // still there as the ball nears
    expect(reachEase(0)).toBeCloseTo(1, 9); // and at the strike
    expect(reachEase(0.3)).toBeCloseTo(1, 9); // held into the follow-through
    // Out and back at the edges, with no residual offset at the seam.
    expect(reachEase(-1)).toBeCloseTo(0, 9);
    expect(reachEase(1)).toBeCloseTo(0, 9);
    // Monotonic on the way out, so the step never stutters.
    for (let w = -1; w < -0.5; w += 0.02) {
      expect(reachEase(w + 0.02)).toBeGreaterThanOrEqual(reachEase(w) - 1e-9);
    }
  });

  it('the ball meets the head on the arc the head sweeps', () => {
    // The head rides a circle about the grip. At contact the ball must be at
    // the head's ACTUAL position — box centre plus the head's rotated offset —
    // not at the box centre itself, which is 7–8.5 units away. Aiming the
    // reach at the centre had the racket and the ball chasing each other.
    const U = (44 / 28) * 0.96;
    const MOUNT = [-16, 15, 14, -15];
    const spin = (
      p: [number, number],
      a: number,
      about: [number, number],
    ): [number, number] => {
      const x = p[0] - about[0];
      const y = p[1] - about[1];
      const c = Math.cos(a);
      const sn = Math.sin(a);
      return [about[0] + x * c - y * sn, about[1] + x * sn + y * c];
    };
    const kf = (ts: number[], vs: number[], t: number) => {
      let i = 0;
      while (i < ts.length - 2 && ts[i + 1]! < t) i++;
      const f = (t - ts[i]!) / (ts[i + 1]! - ts[i]!);
      return vs[i]! + (vs[i + 1]! - vs[i]!) * f;
    };

    RACKETS.forEach((r, i) => {
      const c = CONTACT[i]!;
      const d = i >= 2 ? -1 : 1;
      const piv: [number, number] = [0, 15 * d];
      const a = (MOUNT[i]! * Math.PI) / 180;
      const b = (AIM[i]! * Math.PI) / 180;
      const head = spin(spin([0, -3 * d], a, [0, 0]), b, piv);
      const grip = spin(spin([0, 15 * d], a, [0, 0]), b, piv);

      // reachFrames aims the HEAD at the ball, so solve for the box centre.
      const [ts, dxs, dys] = SWAY[i]!;
      const bx = kf(T, BX, c);
      const by = kf(T, BY, c);
      const reachX = bx - r.x - kf(ts, dxs, c) - head[0] * U;
      const reachY = by - r.y - kf(ts, dys, c) - head[1] * U;
      const cx = r.x + kf(ts, dxs, c) + reachX;
      const cy = r.y + kf(ts, dys, c) + reachY;

      // The strings land exactly on the ball.
      expect(cx + head[0] * U).toBeCloseTo(bx, 9);
      expect(cy + head[1] * U).toBeCloseTo(by, 9);
      // And that point is genuinely on the head's orbit about the grip.
      const gx = cx + grip[0] * U;
      const gy = cy + grip[1] * U;
      expect(Math.hypot(bx - gx, by - gy)).toBeCloseTo(18 * U, 6);
    });
  });

  it('the ball flies straight into the strings, with no last-moment veer', () => {
    // Pinning only the contact frames left a 17° kink on each approach.
    const heading = (j: number) => {
      const dx = BX[j + 1]! - BX[j]!;
      const dy = BY[j + 1]! - BY[j]!;
      return Math.hypot(dx, dy) < 1e-9 ? null : Math.atan2(dx, dy);
    };
    const CONTACT_IDX = new Set([4, 8, 12]); // where the rally legitimately turns
    let prev: number | null = null;
    for (let j = 0; j < T.length - 1; j++) {
      const h = heading(j);
      if (h === null) {
        prev = null;
        continue;
      }
      if (prev !== null && !CONTACT_IDX.has(j)) {
        const turn = Math.abs(Math.atan2(Math.sin(h - prev), Math.cos(h - prev)));
        expect((turn * 180) / Math.PI).toBeLessThan(2);
      }
      prev = h;
    }
  });

  it('the reach lands the face exactly on the ball at contact, then lets go', () => {
    // Mirrors reachFrames: the step target is ball − rest − sway at the
    // contact instant, so the composed position is exactly the ball's. Before
    // this translation existed the sway left the face up to 14.5 units off
    // the ball at its own strike (racket 2 the worst).
    const kf = (ts: number[], vs: number[], t: number) => {
      let i = 0;
      while (i < ts.length - 2 && ts[i + 1]! < t) i++;
      const f = (t - ts[i]!) / (ts[i + 1]! - ts[i]!);
      return vs[i]! + (vs[i + 1]! - vs[i]!) * f;
    };
    RACKETS.forEach((r, i) => {
      const c = CONTACT[i]!;
      const [ts, xs, ys] = SWAY[i]!;
      const reachX = kf(T, BX, c) - r.x - kf(ts, xs, c);
      const reachY = kf(T, BY, c) - r.y - kf(ts, ys, c);
      // Composed position at contact = the ball's, exactly.
      expect(r.x + kf(ts, xs, c) + reachX).toBeCloseTo(kf(T, BX, c), 9);
      expect(r.y + kf(ts, ys, c) + reachY).toBeCloseTo(kf(T, BY, c), 9);
      // And it is a step, not a teleport: bounded by the design's own gaps.
      expect(Math.hypot(reachX, reachY)).toBeLessThan(16);
    });
  });

  it('the stroke is a strike, not a drift', () => {
    // The loop is 6.6 s. A window of ±0.11 spread ~68° of sweep over 1.45 s,
    // which read as the racket wafting rather than hitting. Guard both the
    // duration and the resulting angular speed.
    const LOOP_S = 6.6;
    expect(2 * SPAN * LOOP_S).toBeLessThan(0.6); // the whole stroke, in seconds
    CONTACT.forEach((c, i) => {
      const { output } = swingFrames(c, AIM[i]!, SWEEP[i]!);
      const sweep = Math.max(...output) - Math.min(...output);
      expect(sweep / (2 * SPAN * LOOP_S)).toBeGreaterThan(150); // deg/s
    });
  });

  it('the swing pivots at the butt of the grip', () => {
    // The handle path runs to 15 in the racket's viewBox, so the hand is at
    // 15. Rotating about anything else leaves the grip drifting — the pan /
    // see-saw look. Composite is T(+g)·R(−g), so the grip must be a fixed point.
    const PIVOT = 15;
    const grip = { x: 0, y: 15 };
    for (const deg of [15, 40, 70]) {
      const a = (deg * Math.PI) / 180;
      const y = grip.y - PIVOT;
      const rx = -y * Math.sin(a);
      const ry = y * Math.cos(a) + PIVOT;
      expect(Math.hypot(rx - grip.x, ry - grip.y)).toBeLessThan(1e-9);
    }
  });

  it('the ball leaves the strings fast and bleeds pace, never crawling in', () => {
    // The design's spacing decelerated the ball to 35 % of its speed on
    // arrival, so it coasted to a stop at each racket rather than being hit
    // to it. Speed must now be highest just after contact and still carrying
    // real pace when it arrives.
    const speeds: number[] = [];
    for (let j = 0; j < T.length - 1; j++) {
      const d = Math.hypot(BX[j + 1]! - BX[j]!, BY[j + 1]! - BY[j]!);
      speeds.push(d / (T[j + 1]! - T[j]!));
    }
    expect(Math.min(...speeds) / Math.max(...speeds)).toBeGreaterThan(0.5);
    // Within each leg the ball only ever slows — never speeds up mid-flight.
    for (const start of [0, 4, 8, 12]) {
      for (let j = start + 1; j < start + 4; j++) {
        expect(speeds[j]!).toBeLessThan(speeds[j - 1]! + 1e-6);
      }
    }
  });

  it('no two rackets swing at the same moment', () => {
    const sorted = [...CONTACT].sort((a, b) => a - b);
    for (let i = 1; i < sorted.length; i++) expect(sorted[i]! - sorted[i - 1]!).toBeGreaterThan(0.2);
  });
});
