// Setup file for Vitest - Jest compatibility
// Handles runtime compatibility for tests originally written for Jest.
import { vi } from 'vitest';

// Patch vi.fn() to wrap arrow function implementations so they're constructable.
// In Jest, jest.fn().mockImplementation(() => obj) works with `new`.
// In Vitest v4, arrow functions throw "is not a constructor" when called with `new`.
const originalFn = vi.fn.bind(vi);

vi.fn = function patchedFn(impl?: (...args: any[]) => any) {
  const mock = originalFn(impl);
  const originalMockImplementation = mock.mockImplementation.bind(mock);

  mock.mockImplementation = function patchedMockImplementation(fn: (...args: any[]) => any) {
    // Check if fn is an arrow function (no prototype property)
    // Arrow functions don't have .prototype, regular functions do.
    if (fn && !fn.prototype && typeof fn === 'function') {
      // Wrap it in a regular function so it can be used with `new`
      const wrapper = function(this: any, ...args: any[]) {
        return fn.apply(this, args);
      };
      return originalMockImplementation(wrapper);
    }
    return originalMockImplementation(fn);
  };

  return mock;
} as typeof vi.fn;

// Also expose jest global for any remaining references
(globalThis as any).jest = vi;
