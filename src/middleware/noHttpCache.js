/**
 * Prevent shared caches and conditional GET (If-None-Match) from treating
 * polling responses as unchanged. Express default ETag + identical JSON bodies
 * (e.g. { status: "generating" }) yields 304 with no body — many clients then
 * keep stale state and never observe completed/failed transitions.
 */
export function noHttpCache(_req, res, next) {
  res.set("Cache-Control", "private, no-store, no-cache, must-revalidate");
  res.set("Pragma", "no-cache");
  res.set("Expires", "0");
  next();
}
