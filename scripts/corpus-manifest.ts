/**
 * Re-exporta o manifesto curado do corpus, que passou a viver em `src/` para ser
 * usado tanto pelos adapters de fonte quanto pelos scripts (ver
 * `src/adapters/source/legislacao/manifest.ts`).
 */
export { CORPUS_MANIFEST, type ManifestItem } from '../src/adapters/source/legislacao/manifest.js';
