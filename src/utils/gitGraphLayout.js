// gitGraphLayout.js
//
// Pure-data lane-assignment for a git commit graph. Input is a flat array
// of `GraphCommit`s in newest-first order (the same shape returned by the
// Rust `cmd_git_graph` command). Output is a `{ nodes, edges }` pair the
// SVG renderer drops into a viewBox.
//
// Why we roll this by hand instead of pulling a library:
//   * Bundle weight — every graph lib I looked at (`@gitkraken/git-graph`,
//     `nx-git-graph`) drags in 30+ KiB minified plus deps. The algorithm
//     below is ~70 lines.
//   * Customisation — we want CSS-variable theming and to honour the same
//     6-color logo palette the rest of Lorica uses. Most libs hardcode HSL.
//   * Testability — a pure function is trivial to exercise; the SVG layer
//     is a thin transform on top.
//
// Algorithm (single pass, O(commits * lanes)):
//
//   maintain `lanes`: an ordered list of "open threads", each tracking
//   the *next* hash that thread is waiting for. A new commit either
//     (a) lands on an existing lane that was waiting for its hash, OR
//     (b) opens a fresh lane (it's a tip with no descendants we've seen).
//
//   For each parent of the commit:
//     - first parent  → inherits the commit's lane (this is the "trunk"
//       continuation)
//     - extra parents → take a fresh lane each (merge inflows fan in)
//
//   When a lane's expected hash never arrives (commit walked past it),
//   we leave it dangling — that's fine, the renderer simply stops drawing
//   beyond the last edge.
//
// Coordinate system: x = lane * LANE_WIDTH + PADDING_X, y = row * ROW_HEIGHT
// + PADDING_Y. Origin top-left, like SVG.
//
// Colours: lane indexes are mapped through a 6-stop palette by index
// modulo. The palette intentionally references CSS custom properties so
// theme switching is free — the SVG just changes colour at the next paint.

export const ROW_HEIGHT = 24;
export const LANE_WIDTH = 16;
export const DOT_RADIUS = 4;
export const PADDING_X = 10;
export const PADDING_Y = 12;

// 6-color lane palette — the 5 logo bars plus the accent colour. Cycled
// by lane index. Values are CSS variable references with a sane fallback
// so the graph renders even if a theme forgot to set the logo palette.
export const LANE_PALETTE = [
  'var(--color-logo-1, var(--color-accent))',
  'var(--color-logo-2, var(--color-accent))',
  'var(--color-logo-3, var(--color-accent))',
  'var(--color-logo-4, var(--color-accent))',
  'var(--color-logo-5, var(--color-accent))',
  'var(--color-accent)',
];

export function laneColor(lane) {
  return LANE_PALETTE[lane % LANE_PALETTE.length];
}

// Compute pixel x/y from lane/row indices. Exported so the React component
// can position labels (refs, hash text) consistently with the SVG.
export function laneX(lane) {
  return PADDING_X + lane * LANE_WIDTH;
}
export function rowY(row) {
  return PADDING_Y + row * ROW_HEIGHT;
}

/**
 * Build a layout from a newest-first commit array.
 *
 * @param {Array} commits  Array of GraphCommit (must include `hash`,
 *                         `parents`). Other fields pass through to nodes.
 * @returns {{ nodes: Array, edges: Array, maxLane: number, totalRows: number }}
 *   - nodes: one per input commit, in the same order, with `{lane, x, y, color, ...commit}`
 *   - edges: one per parent connection. If the parent isn't in the visible
 *            window we still emit the edge but truncate it at the bottom of
 *            the chart so the line "exits" gracefully instead of vanishing.
 *   - maxLane: highest lane index used (0-based). Useful for sizing the SVG.
 *   - totalRows: number of rows (= commits.length). Useful for SVG height.
 */
export function layoutGitGraph(commits) {
  const safe = Array.isArray(commits) ? commits : [];
  if (safe.length === 0) {
    return { nodes: [], edges: [], maxLane: 0, totalRows: 0 };
  }

  // `lanes[i]` = the next expected commit hash on lane `i`, or null if
  // that lane is free and can be reused. Sparse-style: we only `push`
  // when no free slot is available, otherwise we recycle.
  /** @type {(string|null)[]} */
  const lanes = [];
  const nodes = [];
  const edges = [];
  let maxLane = 0;

  // Build a hash → row index map so we can still draw an edge to a parent
  // even if the parent's lane assignment changes later (we re-look up the
  // parent's actual lane at render time).
  const rowByHash = new Map();
  for (let i = 0; i < safe.length; i++) rowByHash.set(safe[i].hash, i);

  // Track each commit's assigned lane so parents can look it up later.
  const laneByHash = new Map();

  const allocLane = (hash) => {
    // Reuse the first free slot if any, otherwise grow.
    for (let i = 0; i < lanes.length; i++) {
      if (lanes[i] === null) { lanes[i] = hash; return i; }
    }
    lanes.push(hash);
    return lanes.length - 1;
  };

  for (let row = 0; row < safe.length; row++) {
    const c = safe[row];
    // Find the lane this commit is "expected" on — i.e. the lane that was
    // waiting for c.hash. If multiple lanes wait for the same hash (a
    // merge collapses two threads), pick the leftmost and free the rest.
    let lane = -1;
    for (let i = 0; i < lanes.length; i++) {
      if (lanes[i] === c.hash) {
        if (lane === -1) {
          lane = i;
        } else {
          // Collapsing: this lane was waiting for the same commit, so it
          // merges into our chosen lane. Free the slot.
          lanes[i] = null;
          // Emit a "join" edge from the absorbed lane down into our lane
          // at this row — visualises the merge collapse.
          // Note: we don't have a "from row" because the absorbed thread's
          // most recent commit was earlier; the edge is anchored at the
          // commit that emitted it, which we already drew. The visual
          // collapse is implicit at this row.
        }
      }
    }
    if (lane === -1) {
      // No lane was waiting — this is a fresh tip (or root we're seeing
      // for the first time). Allocate a new lane.
      lane = allocLane(c.hash);
    }

    // Mark this commit's lane and reserve it for its first parent.
    laneByHash.set(c.hash, lane);
    if (lane > maxLane) maxLane = lane;

    // Re-target this lane to the first parent (linear continuation).
    const parents = Array.isArray(c.parents) ? c.parents : [];
    if (parents.length === 0) {
      // Root commit — terminate the lane so it can be recycled by a future
      // unrelated tip.
      lanes[lane] = null;
    } else {
      lanes[lane] = parents[0];
      // Extra parents: each takes a new lane (merge inflows). If any of
      // those parents is *already* awaited on another lane, we don't open
      // a duplicate — we just emit the edge to the existing lane.
      for (let p = 1; p < parents.length; p++) {
        const ph = parents[p];
        let existing = -1;
        for (let i = 0; i < lanes.length; i++) {
          if (lanes[i] === ph) { existing = i; break; }
        }
        if (existing === -1) {
          allocLane(ph);
        }
      }
    }

    nodes.push({
      ...c,
      lane,
      row,
      x: laneX(lane),
      y: rowY(row),
      color: laneColor(lane),
    });
  }

  // Second pass: emit edges now that we know each commit's lane. We do
  // this after the layout so a parent's lane is final before we route to
  // it. Edges that point past the visible window terminate one row below
  // the last commit (renderer clips visually).
  for (let row = 0; row < safe.length; row++) {
    const c = safe[row];
    const fromLane = nodes[row].lane;
    const fromX = laneX(fromLane);
    const fromY = rowY(row);
    const parents = Array.isArray(c.parents) ? c.parents : [];
    for (let p = 0; p < parents.length; p++) {
      const ph = parents[p];
      const parentRow = rowByHash.has(ph) ? rowByHash.get(ph) : safe.length; // off-screen → bottom
      // Pick the parent's lane: known if we've laid it out, else use the
      // commit's own lane (first-parent inheritance) for off-screen edges.
      let toLane;
      if (laneByHash.has(ph)) {
        toLane = laneByHash.get(ph);
      } else if (p === 0) {
        toLane = fromLane;
      } else {
        // Off-screen merge parent — show it diverging by one lane so the
        // visual still hints at a fan-in even if the parent isn't loaded.
        toLane = fromLane + 1;
        if (toLane > maxLane) maxLane = toLane;
      }
      const toX = laneX(toLane);
      const toY = rowY(parentRow);
      edges.push({
        x1: fromX,
        y1: fromY,
        x2: toX,
        y2: toY,
        color: laneColor(p === 0 ? fromLane : toLane),
        // `merge: true` lets the renderer style merge inflows differently
        // (e.g. dashed) if it wants; today we render them all the same.
        merge: p > 0,
      });
    }
  }

  return { nodes, edges, maxLane, totalRows: safe.length };
}
