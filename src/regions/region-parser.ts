const BEGIN_MARKER = '<!-- auracoil:begin -->';
const END_MARKER = '<!-- auracoil:end -->';

const DEFAULT_REGION = `${BEGIN_MARKER}
## GPT Insights (maintained by Auracoil)

_No reviews yet. Run \`/auracoil\` to get GPT 5.2 Pro's analysis._
${END_MARKER}`;

/**
 * Extract the Auracoil-owned region content (between markers).
 * Returns null if markers are not present.
 */
export function extractRegion(doc: string): string | null {
  const beginIdx = doc.indexOf(BEGIN_MARKER);
  const endIdx = doc.indexOf(END_MARKER);
  if (beginIdx === -1 || endIdx === -1) return null;
  return doc.substring(beginIdx + BEGIN_MARKER.length, endIdx).trim();
}

/**
 * Replace the Auracoil-owned region with new content.
 * Preserves everything outside the markers.
 */
export function replaceRegion(doc: string, newContent: string): string {
  const beginIdx = doc.indexOf(BEGIN_MARKER);
  const endIdx = doc.indexOf(END_MARKER);
  if (beginIdx === -1 || endIdx === -1) {
    throw new Error('Auracoil region markers not found in document');
  }
  const before = doc.substring(0, beginIdx + BEGIN_MARKER.length);
  const after = doc.substring(endIdx);
  return `${before}\n${newContent.trim()}\n${after}`;
}

/**
 * Ensure the Auracoil region exists in the document.
 * Appends it at the end if not present.
 */
export function ensureRegion(doc: string): string {
  if (doc.includes(BEGIN_MARKER)) return doc;
  return `${doc.trimEnd()}\n\n${DEFAULT_REGION}\n`;
}
