import bcrypt from "bcryptjs";

// Cost 10 is ~4x faster than 12 (bcryptjs is pure JS) and still meets common guidance.
export const BCRYPT_COST = 10;

export function hashPassword(password: string) {
  return bcrypt.hash(password, BCRYPT_COST);
}

// Hashes made at a higher cost are re-hashed on the next successful sign-in.
export function needsRehash(hash: string) {
  try {
    return bcrypt.getRounds(hash) > BCRYPT_COST;
  } catch {
    return false;
  }
}
