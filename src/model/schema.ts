// Runtime validation for documents at the trust boundary (loading a file from disk).
// Mirrors model/types.ts by hand; the two are kept in sync by the round-trip test
// in persistence — there is no codegen here yet.
import { z } from 'zod';

const vec2Schema = z.object({ x: z.number(), y: z.number() });

const nodeBaseSchema = {
  id: z.string(),
  position: vec2Schema,
  chainId: z.string().nullable(),
  createdAt: z.number(),
  label: z.string().optional(),
};

const numberNodeSchema = z.object({
  ...nodeBaseSchema,
  kind: z.literal('number'),
  raw: z.string(),
});

const operatorNodeSchema = z.object({
  ...nodeBaseSchema,
  kind: z.literal('operator'),
  op: z.enum(['+', '-', '×', '÷']),
});

const equalsNodeSchema = z.object({
  ...nodeBaseSchema,
  kind: z.literal('equals'),
});

const parenNodeSchema = z.object({
  ...nodeBaseSchema,
  kind: z.literal('paren'),
  side: z.enum(['open', 'close']),
});

const resultNodeSchema = z.object({
  ...nodeBaseSchema,
  kind: z.literal('result'),
  sourceChainId: z.string(),
  derived: z
    .object({
      display: z.string(),
      computedAt: z.string(),
      outcome: z
        .union([
          z.object({ status: z.literal('stale') }),
          z.object({
            status: z.literal('error'),
            error: z.enum([
              'Incomplete',
              'InvalidSequence',
              'DivideByZero',
              'Overflow',
              'NotANumber',
              'CircularReference',
            ]),
            // Optional; present when P6.3 DFS colouring named the cycle. Stripped on
            // serialise with the rest of `derived`, so this is not a schema migration.
            cycle: z
              .object({
                chainIds: z.array(z.string()),
                chainLabels: z.array(z.string()),
                closingReferenceNodeId: z.string(),
              })
              .optional(),
          }),
        ])
        .optional(),
    })
    .optional(),
});

const referenceNodeSchema = z.object({
  ...nodeBaseSchema,
  kind: z.literal('reference'),
  targetNodeId: z.string(),
});

export const calcNodeSchema = z.discriminatedUnion('kind', [
  numberNodeSchema,
  operatorNodeSchema,
  equalsNodeSchema,
  parenNodeSchema,
  resultNodeSchema,
  referenceNodeSchema,
]);

export const chainSchema = z.object({
  id: z.string(),
  members: z.array(z.string()),
  anchor: vec2Schema,
});

export const viewportSchema = z.object({
  pan: vec2Schema,
  zoom: z.number(),
});

export const calcDocumentSchema = z.object({
  schemaVersion: z.number(),
  id: z.string(),
  name: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  viewport: viewportSchema,
  nodes: z.record(z.string(), calcNodeSchema),
  chains: z.record(z.string(), chainSchema),
});
