/**
 * Zero-dependency test helper shim for node:test with vitest/jest-style expect syntax.
 */

import { describe as nodeDescribe, it as nodeIt, beforeEach as nodeBeforeEach, afterEach as nodeAfterEach } from "node:test";
import assert from "node:assert/strict";

export const describe = nodeDescribe;
export const it = nodeIt;
export const test = nodeIt;
export const beforeEach = nodeBeforeEach;
export const afterEach = nodeAfterEach;

export function expect(actual: unknown) {
  return {
    toBe(expected: unknown) {
      assert.strictEqual(actual, expected);
    },
    toEqual(expected: unknown) {
      assert.deepStrictEqual(actual, expected);
    },
    toBeDefined() {
      assert.notStrictEqual(actual, undefined);
    },
    toBeUndefined() {
      assert.strictEqual(actual, undefined);
    },
    toBeTruthy() {
      assert.ok(actual);
    },
    toBeFalsy() {
      assert.ok(!actual);
    },
    toMatch(regex: RegExp) {
      assert.match(String(actual), regex);
    },
    toThrow(regexOrMsg?: string | RegExp) {
      if (typeof actual !== "function") {
        throw new Error("expect(fn).toThrow() requires a function");
      }
      assert.throws(actual as () => unknown, regexOrMsg ? new RegExp(regexOrMsg) : undefined);
    },
    rejects: {
      async toThrow(regexOrMsg?: string | RegExp) {
        let threw = false;
        try {
          await (actual as Promise<unknown>);
        } catch (err: any) {
          threw = true;
          if (regexOrMsg) {
            const re = typeof regexOrMsg === "string" ? new RegExp(regexOrMsg) : regexOrMsg;
            assert.match(err?.message || String(err), re);
          }
        }
        if (!threw) {
          throw new Error("Expected promise to reject, but it resolved successfully");
        }
      },
    },
    toHaveLength(expected: number) {
      assert.strictEqual((actual as any)?.length, expected);
    },
    toContain(expected: unknown) {
      if (typeof actual === "string") {
        assert.ok(actual.includes(String(expected)));
      } else if (Array.isArray(actual)) {
        assert.ok(actual.includes(expected));
      }
    },
  };
}
