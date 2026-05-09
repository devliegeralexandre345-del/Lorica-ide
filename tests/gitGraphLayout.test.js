// tests/gitGraphLayout.test.js
//
// Coverage for the lane-assignment algorithm that powers the Git Graph
// view (Wave 1). Pure-data — input is a flat array of GraphCommit, output
// is the {nodes, edges, maxLane, totalRows} payload the SVG renderer
// reads.

import { describe, it, expect } from 'vitest';
import {
  layoutGitGraph,
  laneColor,
  laneX,
  rowY,
  ROW_HEIGHT,
  LANE_WIDTH,
  PADDING_X,
  PADDING_Y,
} from '../src/utils/gitGraphLayout.js';

// Minimal fixture builder — only the fields the layout reads.
const c = (hash, parents = []) => ({ hash, parents });

describe('layoutGitGraph', () => {
  it('returns an empty layout for empty / non-array input', () => {
    expect(layoutGitGraph([])).toEqual({ nodes: [], edges: [], maxLane: 0, totalRows: 0 });
    expect(layoutGitGraph(null)).toEqual({ nodes: [], edges: [], maxLane: 0, totalRows: 0 });
    expect(layoutGitGraph(undefined)).toEqual({ nodes: [], edges: [], maxLane: 0, totalRows: 0 });
  });

  it('lays out a linear history on a single lane', () => {
    const commits = [
      c('A', ['B']),
      c('B', ['C']),
      c('C', []),
    ];
    const layout = layoutGitGraph(commits);
    expect(layout.totalRows).toBe(3);
    expect(layout.maxLane).toBe(0);
    expect(layout.nodes.map((n) => n.lane)).toEqual([0, 0, 0]);
    // Nodes carry the original commit fields plus geometry.
    expect(layout.nodes[0].hash).toBe('A');
    expect(layout.nodes[0].x).toBe(PADDING_X);
    expect(layout.nodes[0].y).toBe(PADDING_Y);
    expect(layout.nodes[1].y).toBe(PADDING_Y + ROW_HEIGHT);
  });

  it('opens a second lane for an unrelated tip', () => {
    // Two roots: A's chain ends with no parents, then a fresh tip X starts.
    // The renderer treats X as opening a new lane because A's chain has
    // freed lane 0 by then? Actually — X arrives BEFORE A here:
    //   X (no parents seen yet for A's chain)
    //   A (root)
    // X opens lane 0, A is unrelated and opens lane 1.
    const commits = [
      c('X', []),
      c('A', []),
    ];
    const layout = layoutGitGraph(commits);
    // X claims lane 0, terminates it. A then re-uses freed lane 0.
    expect(layout.nodes[0].lane).toBe(0);
    expect(layout.nodes[1].lane).toBe(0);
    expect(layout.maxLane).toBe(0);
  });

  it('handles a merge: child has two parents → second parent opens a lane', () => {
    // Topology:
    //   M (merge of A and B)
    //   A
    //   B
    //   C (root)
    // Newest first.
    const commits = [
      c('M', ['A', 'B']),
      c('A', ['C']),
      c('B', ['C']),
      c('C', []),
    ];
    const layout = layoutGitGraph(commits);
    // M sits on lane 0. After M, lane 0 awaits A, lane 1 awaits B.
    expect(layout.nodes[0].lane).toBe(0); // M
    expect(layout.nodes[1].lane).toBe(0); // A
    expect(layout.nodes[2].lane).toBe(1); // B
    expect(layout.maxLane).toBe(1);

    // M should have edges to both parents.
    const mEdges = layout.edges.filter((e) => e.x1 === laneX(0) && e.y1 === rowY(0));
    expect(mEdges.length).toBeGreaterThanOrEqual(2);
    expect(mEdges.some((e) => e.merge === true)).toBe(true);
  });

  it('octopus merge (3 parents) opens two extra lanes', () => {
    const commits = [
      c('OCT', ['A', 'B', 'C']),
      c('A', []),
      c('B', []),
      c('C', []),
    ];
    const layout = layoutGitGraph(commits);
    expect(layout.nodes[0].lane).toBe(0);
    expect(layout.maxLane).toBeGreaterThanOrEqual(2);
    // OCT row should emit at least 3 edges.
    const octEdges = layout.edges.filter((e) => e.y1 === rowY(0));
    expect(octEdges.length).toBe(3);
  });

  it('emits an off-screen edge when a parent is past the loaded window', () => {
    const commits = [
      c('A', ['LOST']), // LOST not in commits[]
    ];
    const layout = layoutGitGraph(commits);
    expect(layout.edges).toHaveLength(1);
    // Off-screen edge runs from row 0 down to row "totalRows" (= 1) so
    // the renderer clips it gracefully at the bottom of the chart.
    expect(layout.edges[0].y2).toBe(rowY(1));
  });

  it('passes through arbitrary commit fields onto nodes', () => {
    const layout = layoutGitGraph([
      { hash: 'A', parents: [], author: 'Alice', message: 'init', whatever: 42 },
    ]);
    expect(layout.nodes[0].author).toBe('Alice');
    expect(layout.nodes[0].message).toBe('init');
    expect(layout.nodes[0].whatever).toBe(42);
  });
});

describe('geometry helpers', () => {
  it('laneX shifts by LANE_WIDTH per lane', () => {
    expect(laneX(0)).toBe(PADDING_X);
    expect(laneX(1)).toBe(PADDING_X + LANE_WIDTH);
    expect(laneX(5)).toBe(PADDING_X + 5 * LANE_WIDTH);
  });

  it('rowY shifts by ROW_HEIGHT per row', () => {
    expect(rowY(0)).toBe(PADDING_Y);
    expect(rowY(1)).toBe(PADDING_Y + ROW_HEIGHT);
  });

  it('laneColor cycles through the palette', () => {
    expect(laneColor(0)).toBe(laneColor(6));
    expect(laneColor(1)).toBe(laneColor(7));
  });
});
