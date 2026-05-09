// vitest.config.js
//
// Minimal config for the v2.3 test seed (Wave 7 of the v2.3 roadmap).
// Tests live in `tests/` rather than co-located so the dist build stays
// untouched — vitest only picks them up explicitly. The source modules
// under test are pure ESM with no React/JSX dependencies, so we don't
// need vite's React plugin and don't pay the JSX-transform cost.

export default {
  test: {
    include: ['tests/**/*.test.{js,mjs}'],
    environment: 'node',
    globals: false,
    // localStorage is touched by aiCoauthor.js. We provide an in-memory
    // shim in the test files themselves rather than mocking globally,
    // so each test file is self-contained and side-effects between
    // tests never leak.
    setupFiles: ['./tests/setup.js'],
  },
};
