// P7.6 — measure snap search before/after the §8.4 spatial hash. §8.4 said O(n)
// is fine to ~500 nodes; a naive per-frame rebuild of the neighbour index was
// ~10ms p95 at 500 (~60% of a 60fps frame). The hash alone does not fix that —
// construction is still O(n) bounds work — so `useNodeDrag` now builds the
// index once per drag and queries it each frame. This harness profiles that
// realistic path (and keeps the naive numbers for the journal). Numbers also
// land in the journal.
import {
  makeLinearSnappingNeighbours,
  makeSpatialHashSnappingNeighbours,
  SNAP_VERTICAL,
} from './bounds';
import { resolveSnapCandidate } from './snapping';
import { tokens } from '../ui/tokens';
import type { CalcNode, Chain, NumberNode } from '../model/types';
import type { SnappingNeighbours } from './bounds';

/** Jest's TS types omit Node's `performance`; runtime has it via globalThis. */
const now = (): number => {
  const perf = (globalThis as { performance?: { now: () => number } }).performance;
  return perf ? perf.now() : Date.now();
};

const LOCALE = 'en-US';
/** 60fps frame budget. */
const FRAME_MS = 1000 / 60;
/** Per-frame snap query budget after a one-shot index build. ~1/4 frame leaves
 *  room for gesture + paint on the JS path. */
const COMFORTABLE_MS = FRAME_MS / 4;

type NeighbourFactory = (
  chains: Record<string, Chain>,
  nodes: Record<string, CalcNode>,
  locale: string,
) => SnappingNeighbours;

function numberNode(
  id: string,
  raw: string,
  position: { x: number; y: number },
  chainId: string | null = null,
): NumberNode {
  return { id, kind: 'number', raw, position, chainId, createdAt: 0 };
}

/** Scatter free nodes across a grid so vertical filtering has real work, plus
 *  chains so chainBounds work is real. */
function buildDocument(nodeCount: number): {
  nodes: Record<string, CalcNode>;
  chains: Record<string, Chain>;
  dragged: NumberNode;
} {
  const nodes: Record<string, CalcNode> = {};
  const chains: Record<string, Chain> = {};
  const cols = Math.ceil(Math.sqrt(nodeCount));
  const cellX = 120;
  const cellY = tokens.nodeHeight + SNAP_VERTICAL + 8;

  let placed = 0;
  while (placed < nodeCount) {
    const col = placed % cols;
    const row = Math.floor(placed / cols);
    const x = col * cellX;
    const y = row * cellY;

    if (placed % 5 < 2 || placed + 3 > nodeCount) {
      const id = `f${placed}`;
      nodes[id] = numberNode(id, String(placed % 97), { x, y }, null);
      placed += 1;
    } else {
      const cid = `c${placed}`;
      const a = numberNode(`a${placed}`, '12', { x, y }, cid);
      const op: CalcNode = {
        id: `op${placed}`,
        kind: 'operator',
        op: '+',
        position: { x: x + 40, y },
        chainId: cid,
        createdAt: 0,
      };
      const b = numberNode(`b${placed}`, '3', { x: x + 74, y }, cid);
      nodes[a.id] = a;
      nodes[op.id] = op;
      nodes[b.id] = b;
      chains[cid] = { id: cid, anchor: { x, y }, members: [a.id, op.id, b.id] };
      placed += 3;
    }
  }

  const midCol = Math.floor(cols / 2);
  const midRow = Math.floor(Math.sqrt(nodeCount) / 2);
  const dragged = numberNode('dragged', '5', {
    x: midCol * cellX + 10,
    y: midRow * cellY + 4,
  });
  nodes[dragged.id] = dragged;

  return { nodes, chains, dragged };
}

function percentile(samples: number[], p: number): number {
  const sorted = [...samples].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
}

/** Naive path: rebuild index every frame (pre-P7.6 useNodeDrag). */
function timeRebuildEveryFrame(
  factory: NeighbourFactory,
  nodeCount: number,
  iterations: number,
): { meanMs: number; p95Ms: number } {
  const { nodes, chains, dragged } = buildDocument(nodeCount);
  for (let i = 0; i < 20; i += 1) {
    const neighbours = factory(chains, nodes, LOCALE);
    resolveSnapCandidate(dragged, neighbours, nodes, LOCALE);
  }
  const samples: number[] = [];
  for (let i = 0; i < iterations; i += 1) {
    const t0 = now();
    const neighbours = factory(chains, nodes, LOCALE);
    resolveSnapCandidate(dragged, neighbours, nodes, LOCALE);
    samples.push(now() - t0);
  }
  return {
    meanMs: samples.reduce((s, v) => s + v, 0) / samples.length,
    p95Ms: percentile(samples, 0.95),
  };
}

/** Realistic path: build once at drag start, query each frame (post-P7.6). */
function timeBuildOnceQueryMany(
  factory: NeighbourFactory,
  nodeCount: number,
  iterations: number,
): { buildMs: number; queryMeanMs: number; queryP95Ms: number } {
  const { nodes, chains, dragged } = buildDocument(nodeCount);
  // Warm-up
  const warm = factory(chains, nodes, LOCALE);
  for (let i = 0; i < 20; i += 1) {
    resolveSnapCandidate(dragged, warm, nodes, LOCALE);
  }

  const tBuild0 = now();
  const neighbours = factory(chains, nodes, LOCALE);
  const buildMs = now() - tBuild0;

  const samples: number[] = [];
  for (let i = 0; i < iterations; i += 1) {
    // Nudge the probe so each query isn't a pure no-op cache hit in the engine.
    const probe = {
      ...dragged,
      position: { x: dragged.position.x + (i % 7), y: dragged.position.y },
    };
    const t0 = now();
    resolveSnapCandidate(probe, neighbours, nodes, LOCALE);
    samples.push(now() - t0);
  }
  return {
    buildMs,
    queryMeanMs: samples.reduce((s, v) => s + v, 0) / samples.length,
    queryP95Ms: percentile(samples, 0.95),
  };
}

describe('P7.6 snap-search profile (§8.4)', () => {
  // Key sizes only — full 50…2000 sweep is in the journal from the first
  // measurement pass; keeping every `npm test` under a few seconds.
  const sizes = [100, 500, 1000];
  const iterations = 40;
  const naiveLinear500 = { p95Ms: 0 };
  const cachedHash500 = { queryP95Ms: 0, buildMs: 0 };
  const cachedLinear500 = { queryP95Ms: 0 };

  test.each(sizes)('profiles naive rebuild-every-frame (linear) at %i nodes', (n) => {
    const { meanMs, p95Ms } = timeRebuildEveryFrame(
      makeLinearSnappingNeighbours,
      n,
      iterations,
    );
    if (n === 500) naiveLinear500.p95Ms = p95Ms;
    console.log(
      `P7.6 naive-linear n=${n}: mean=${meanMs.toFixed(3)}ms p95=${p95Ms.toFixed(3)}ms ` +
        `(frame=${FRAME_MS.toFixed(2)}ms)`,
    );
    expect(meanMs).toBeGreaterThanOrEqual(0);
  });

  test.each(sizes)('profiles build-once + query (linear) at %i nodes', (n) => {
    const { buildMs, queryMeanMs, queryP95Ms } = timeBuildOnceQueryMany(
      makeLinearSnappingNeighbours,
      n,
      iterations,
    );
    if (n === 500) cachedLinear500.queryP95Ms = queryP95Ms;
    console.log(
      `P7.6 cached-linear n=${n}: build=${buildMs.toFixed(3)}ms ` +
        `queryMean=${queryMeanMs.toFixed(3)}ms queryP95=${queryP95Ms.toFixed(3)}ms`,
    );
    expect(queryMeanMs).toBeGreaterThanOrEqual(0);
  });

  test.each(sizes)('profiles build-once + query (spatial hash) at %i nodes', (n) => {
    const { buildMs, queryMeanMs, queryP95Ms } = timeBuildOnceQueryMany(
      makeSpatialHashSnappingNeighbours,
      n,
      iterations,
    );
    if (n === 500) {
      cachedHash500.queryP95Ms = queryP95Ms;
      cachedHash500.buildMs = buildMs;
    }
    console.log(
      `P7.6 cached-hash n=${n}: build=${buildMs.toFixed(3)}ms ` +
        `queryMean=${queryMeanMs.toFixed(3)}ms queryP95=${queryP95Ms.toFixed(3)}ms ` +
        `(comfort=${COMFORTABLE_MS.toFixed(2)}ms)`,
    );
    expect(queryMeanMs).toBeGreaterThanOrEqual(0);
  });

  test('measurement justified the hash; cached hash query stays under comfort at ~500', () => {
    console.log(
      `P7.6 decision @500: naive-linear p95=${naiveLinear500.p95Ms.toFixed(3)}ms; ` +
        `cached-linear queryP95=${cachedLinear500.queryP95Ms.toFixed(3)}ms; ` +
        `cached-hash build=${cachedHash500.buildMs.toFixed(3)}ms ` +
        `queryP95=${cachedHash500.queryP95Ms.toFixed(3)}ms ` +
        `(comfort ${COMFORTABLE_MS.toFixed(2)}ms)`,
    );
    // Evidence that the pre-P7.6 path was over budget at the §8.4 threshold.
    expect(naiveLinear500.p95Ms).toBeGreaterThanOrEqual(COMFORTABLE_MS);
    // Per-frame cost after one-shot build must clear the budget.
    expect(cachedHash500.queryP95Ms).toBeLessThan(COMFORTABLE_MS);
    // Hash query should beat (or match) linear query on a scattered document.
    expect(cachedHash500.queryP95Ms).toBeLessThanOrEqual(
      cachedLinear500.queryP95Ms + 0.05,
    );
  });
});
