// src/extensions/yjsBinding.js
//
// Wraps `y-codemirror.next` so Editor.jsx can drop a single
// "Live Share binding" extension into its array when a collab session
// is active for the active file. Pure passthrough today — kept as a
// thin module so the y-codemirror.next dep is lazy-imported by callers
// (the binding is only constructed when the user actually shares a
// file, so its 80 KiB never enters the entrypoint).
//
// Usage:
//   const ext = await buildYjsBinding({ ytext, awareness, undoManager });
//   editor.dispatch({ effects: addExtension(ext) });
//
// Or as a static extension passed at editor creation time.

export async function buildYjsBinding({ ytext, awareness, undoManager }) {
  if (!ytext) return null;
  const { yCollab } = await import(/* webpackChunkName: "yjs-binding" */ 'y-codemirror.next');
  return yCollab(ytext, awareness, { undoManager });
}
