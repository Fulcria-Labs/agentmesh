import { defineConfig, type Plugin } from 'vitest/config';

/**
 * Find the matching closing bracket for an opening bracket at position `start`.
 * Handles nested brackets and string literals.
 */
function findMatchingClose(code: string, start: number): number {
  const open = code[start]!;
  const close = open === '(' ? ')' : open === '[' ? ']' : '}';
  let depth = 1;
  let i = start + 1;
  while (i < code.length && depth > 0) {
    const ch = code[i]!;
    if (ch === open) {
      depth++;
    } else if (ch === close) {
      depth--;
    } else if (ch === "'" || ch === '"' || ch === '`') {
      // Skip string literals
      i++;
      while (i < code.length && code[i] !== ch) {
        if (code[i] === '\\') i++;
        i++;
      }
    }
    i++;
  }
  return i - 1; // position of closing bracket
}

/**
 * Convert arrow functions to regular functions specifically in vi.fn() and
 * .mockImplementation() calls. Handles TypeScript type annotations correctly
 * by leaving them intact (the TS compiler will strip them later).
 */
function convertArrowsInFnCalls(code: string): string {
  // Patterns to look for
  const patterns = ['vi.fn(', '.mockImplementation('];
  let result = '';
  let i = 0;

  while (i < code.length) {
    let matched = false;
    for (const pattern of patterns) {
      if (code.startsWith(pattern, i)) {
        result += pattern;
        i += pattern.length;

        // Skip whitespace
        while (i < code.length && /\s/.test(code[i]!)) {
          result += code[i]!;
          i++;
        }

        // Check if next thing is a parenthesized parameter list
        if (i < code.length && code[i] === '(') {
          // Find the matching closing paren of the parameter list
          const paramClose = findMatchingClose(code, i);
          const paramContent = code.slice(i + 1, paramClose);

          // Look for => after the closing paren (with optional whitespace)
          let k = paramClose + 1;
          while (k < code.length && /\s/.test(code[k]!)) k++;

          if (code.startsWith('=>', k)) {
            // It IS an arrow function. Convert to regular function.
            k += 2; // skip =>
            while (k < code.length && /\s/.test(code[k]!)) k++;

            if (code[k] === '{') {
              // Block body: (params) => { ... } -> function(params) { ... }
              result += `function(${paramContent}) {`;
              i = k + 1;
            } else {
              // Expression body: (params) => expr -> function(params) { return expr; }
              // Find the end of the expression by finding the closing paren of the
              // outer vi.fn() or .mockImplementation() call.
              // The outer call starts with the `(` that is the last char of the pattern.
              // We need to find its matching `)`.
              // However, since we've already consumed the pattern and are inside it,
              // we need to count from here. We know we're 1 level deep (inside the outer `(`).
              let depth = 1;
              let m = k;
              while (m < code.length && depth > 0) {
                const ch = code[m]!;
                if (ch === '(' || ch === '[' || ch === '{') depth++;
                else if (ch === ')' || ch === ']' || ch === '}') depth--;
                if (depth > 0) {
                  if (ch === "'" || ch === '"' || ch === '`') {
                    m++;
                    while (m < code.length && code[m] !== ch) {
                      if (code[m] === '\\') m++;
                      m++;
                    }
                  }
                  m++;
                }
              }
              // m points to the closing ')' of vi.fn() or .mockImplementation()
              const expr = code.slice(k, m);
              result += `function(${paramContent}) { return ${expr}; })`;
              i = m + 1; // skip past ')'
            }
            matched = true;
            break;
          }
          // Not an arrow function, fall through to normal processing
        }
        matched = true;
        break;
      }
    }

    if (!matched) {
      result += code[i]!;
      i++;
    }
  }

  return result;
}

/**
 * Vite plugin that rewrites Jest-style test code to work with Vitest:
 * 1. Replaces `jest.*` with `vi.*` so vi.mock() gets properly hoisted
 * 2. Converts arrow functions in vi.fn() and .mockImplementation() to regular
 *    functions so they can be used as constructors (Vitest v4 requirement)
 */
function jestToViPlugin(): Plugin {
  return {
    name: 'jest-to-vi',
    enforce: 'pre',
    transform(code: string, id: string) {
      if (!id.includes('__tests__') && !id.includes('.test.')) return;
      if (!code.includes('jest.')) return;

      let transformed = code;

      // Step 1: Replace jest.* with vi.*
      transformed = transformed.replace(/\bjest\./g, 'vi.');

      // Step 2: Convert arrow functions in vi.fn() and .mockImplementation()
      // to regular functions for constructor compatibility
      transformed = convertArrowsInFnCalls(transformed);

      if (transformed === code) return;
      return { code: transformed, map: null };
    },
  };
}

export default defineConfig({
  plugins: [jestToViPlugin()],
  test: {
    globals: true,
    environment: 'node',
    include: ['src/__tests__/**/*.test.ts'],
    setupFiles: ['./vitest.setup.ts'],
    testTimeout: 30000,
  },
});
