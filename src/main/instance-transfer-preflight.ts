// Size checks for an instance transfer, before any archive is read or zipped. The estimate is the sum
// of the bytes that go into the archive, so it runs on sizes already on disk and in SQLite.

const MEGABYTE = 1024 * 1024;

/** An archive fits when it is no larger than the limit. The limit itself is allowed. */
export function fitsLimit(bytes: number, limit: number): boolean {
  return bytes <= limit;
}

/** Whole megabytes, rounded up, for a message. 100 MB + 1 byte reads as 101. */
export function megabytes(bytes: number): number {
  return Math.ceil(bytes / MEGABYTE);
}
