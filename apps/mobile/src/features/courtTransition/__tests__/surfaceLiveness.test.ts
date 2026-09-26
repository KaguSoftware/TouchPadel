import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { contextAlive, presentFrame, type ProbeableContext } from '../surfaceLiveness';

/**
 * A DEAD GL CONTEXT HAS TO BE ASKED — IT NEVER SAYS SO.
 *
 * The recorded bug (owner, 2026-09-13, Android, Expo Go and the testing build):
 * change tabs, come back, and for a moment the Book tab is all there — header,
 * "check availability" button, footer — except the court. The court's surface
 * had been destroyed while the tab was away, and the frame loop drew its first
 * frame back into the dead context. expo-gl does not throw on one; every call
 * is answered with `undefined`. So the frame "went out", the stage lifted, and
 * the button stood over an empty surface until a replacement context had built
 * a renderer and compiled every shader.
 *
 * These pin the two readings the court now takes instead, first against fakes
 * shaped like each kind of context, then against expo-gl's own source — the
 * readings are expo-gl behaviour, not WebGL spec, so an upgrade is exactly what
 * could break them.
 */

/** A context whose answers we choose, and which records what was asked. */
function fake(answers: { parameter: unknown; endFrame: unknown }) {
  const calls: string[] = [];
  const gl: ProbeableContext = {
    UNPACK_COLORSPACE_CONVERSION_WEBGL: 0x9243,
    getParameter: (pname) => {
      calls.push(`getParameter:${pname}`);
      return answers.parameter;
    },
    endFrameEXP: () => {
      calls.push('endFrameEXP');
      return answers.endFrame;
    },
  };
  return { gl, calls };
}

/** expo-gl on a phone, context alive: a constant `false`, and `nullptr` → null. */
const liveNative = () => fake({ parameter: false, endFrame: null });
/** expo-gl on a phone, context destroyed: the CTX() guard's `undefined`, for everything. */
const deadNative = () => fake({ parameter: undefined, endFrame: undefined });
/** A browser WebGL context under expo-gl's web shim: an empty `endFrameEXP`. */
const web = () => fake({ parameter: 0x9244 /* BROWSER_DEFAULT_WEBGL */, endFrame: undefined });

describe('contextAlive', () => {
  it('is true for a live context and false for a destroyed one', () => {
    expect(contextAlive(liveNative().gl)).toBe(true);
    // THE case: nothing threw, nothing warned — only the answer is different.
    expect(contextAlive(deadNative().gl)).toBe(false);
  });

  it('is true on web, where nothing destroys a context this way', () => {
    expect(contextAlive(web().gl)).toBe(true);
  });

  it('only reads a parameter — it never presents a frame', () => {
    // It runs on a surface nobody is drawing into. A present there would swap
    // whatever is in the back buffer onto the screen.
    const { gl, calls } = liveNative();
    contextAlive(gl);
    expect(calls).toEqual(['getParameter:37443']);
  });
});

describe('presentFrame', () => {
  it('counts a frame a live context took', () => {
    expect(presentFrame(liveNative().gl)).toBe(true);
  });

  it('does NOT count a frame drawn into a destroyed context', () => {
    // The bug in one assertion: this returned, so it looked presented, and the
    // stage lifted over an empty court.
    expect(presentFrame(deadNative().gl)).toBe(false);
  });

  it('counts a web frame, whose endFrameEXP returns nothing even when alive', () => {
    expect(presentFrame(web().gl)).toBe(true);
  });

  it('asks nothing more on the live native path — every frame on a phone', () => {
    const { gl, calls } = liveNative();
    presentFrame(gl);
    expect(calls).toEqual(['endFrameEXP']);
  });
});

describe("expo-gl's side of the contract", () => {
  const root = dirname(createRequire(import.meta.url).resolve('expo-gl/package.json'));
  const source = (path: string) => readFileSync(join(root, path), 'utf8');
  /** The body of one native method, from its declaration to the next one. */
  const method = (file: string, name: string) => {
    const text = source(file);
    const at = text.indexOf(`NATIVE_METHOD(${name})`);
    expect(at, `${name} in ${file}`).toBeGreaterThan(-1);
    const next = text.indexOf('NATIVE_METHOD(', at + name.length + 14);
    return text.slice(at, next === -1 ? undefined : next);
  };

  it('answers every call on a destroyed context with undefined, instead of throwing', () => {
    const macros = source('common/EXWebGLMethodsMacros.h');
    expect(macros).toMatch(
      /#define CTX\(\)[\s\S]*?if \(ctx == nullptr\) \{\s*\\\s*return jsi::Value::undefined\(\);/,
    );
  });

  it('returns null from endFrameEXP on a live context', () => {
    const body = method('common/EXWebGLMethodsDraw.cpp', 'endFrameEXP');
    expect(body).toContain('CTX();');
    expect(body).toContain('return nullptr;');
  });

  it('answers UNPACK_COLORSPACE_CONVERSION_WEBGL with false, without a GL-thread round trip', () => {
    const body = method('common/EXWebGLMethods.cpp', 'getParameter');
    const guard = body.indexOf('CTX();');
    const answer = body.indexOf('case GL_UNPACK_COLORSPACE_CONVERSION_WEBGL:');
    expect(guard).toBeGreaterThan(-1);
    expect(answer).toBeGreaterThan(guard);
    // The case falls straight to a constant: nothing blocking in between.
    const tail = body.slice(answer, body.indexOf('case GL_RASTERIZER_DISCARD:', answer));
    expect(tail).toContain('return false;');
    expect(tail).not.toContain('addBlockingToNextBatch');
  });

  it("presents nothing from web's endFrameEXP — why presentFrame asks again", () => {
    expect(source('src/GLView.web.tsx')).toContain(
      'gl.endFrameEXP = function glEndFrameEXP(): void {};',
    );
  });

  it('re-creates a destroyed Android surface by itself — why the court waits before remounting', () => {
    const view = source('android/src/main/java/expo/modules/gl/GLView.kt');
    const destroyed = view.slice(view.indexOf('override fun onSurfaceTextureDestroyed'));
    expect(destroyed).toContain('glContext.destroy()');
    expect(destroyed).toContain('onSurfaceCreateWasCalled = false');
  });
});
