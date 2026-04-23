// Re-export of the shared C/C++ completion list. Kept as its own
// module so the dispatcher can load it under the `c` extension; the
// actual data is identical to cpp.js because most of the builtins
// overlap and splitting them by standard is more trouble than it's
// worth for autocomplete.

export { default } from './cpp.js';
