import { isDynamicRecord, isFunction } from "@openbot/contracts/runtime-values";

/** The message and error code used when this Worker has no R2 binding. */
export const OBJECT_STORAGE_UNAVAILABLE = "object_storage_unavailable";

export function isObjectBucket(value: unknown): value is R2Bucket {
  return isDynamicRecord(value) && isFunction(value.get) && isFunction(value.put) && isFunction(value.delete);
}

/** A bucket whose operations fail. Sign-in does not need it. Avatar and file routes answer 503. */
export function unavailableObjectBucket(): R2Bucket {
  const fail = () => Promise.reject(new Error(OBJECT_STORAGE_UNAVAILABLE));
  const bucket = new Proxy(Object.create(null), {
    get(_target, property) {
      if (property === "then" || typeof property === "symbol") return undefined;
      return fail;
    },
  });
  if (!isObjectBucket(bucket)) throw new Error("Object storage is not configured.");
  return bucket;
}

export function presentObjectBucket(value: unknown): R2Bucket {
  return isObjectBucket(value) ? value : unavailableObjectBucket();
}

export function isObjectStorageUnavailable(error: unknown): boolean {
  if (error instanceof Error && error.message === OBJECT_STORAGE_UNAVAILABLE) return true;
  return isDynamicRecord(error) && error.message === OBJECT_STORAGE_UNAVAILABLE;
}
