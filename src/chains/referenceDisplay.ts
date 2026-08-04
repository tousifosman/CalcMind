// Re-exports the reference display helpers from the engine. Layout (`widthOf`) and
// the ReferenceNode view historically imported from here (P4.9); the §11.2 dangling
// logic now lives in `engine/reference.ts` so graph deletes can stamp last-known
// values without pulling UI modules into the engine.
export {
  referenceDisplayText,
  referenceCellContent,
  isDanglingReference,
  explainDanglingReference,
  prepareReferencesForDeletion,
  deleteNodesLeavingDanglingRefs,
  isRepointTarget,
  type ReferenceCellContent,
} from '../engine/reference';
