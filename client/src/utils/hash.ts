/**
 * sha256Hex
 *
 * Computes a SHA-256 hex digest of a UTF-8 string using the browser's
 * native SubtleCrypto API (available in all modern browsers and in secure
 * contexts — localhost and HTTPS).
 *
 * This is the client-side counterpart of PostgreSQL's
 *   encode(digest(content, 'sha256'), 'hex')
 * used in the GET /files/:id route. Both must produce the same hex string
 * for the same input so the integrity check in the state machine is valid.
 *
 * Returns a lowercase 64-character hex string, e.g.:
 *   "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
 *   (the hash of an empty string — matches COALESCE(content, '') in SQL)
 */
export async function sha256Hex(input: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(input);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}
