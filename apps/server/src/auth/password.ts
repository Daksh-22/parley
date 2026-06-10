import argon2 from 'argon2';

// argon2id with the library's vetted defaults (64 MiB memory, 3 iterations).
export async function hashPassword(plain: string): Promise<string> {
  return argon2.hash(plain, { type: argon2.argon2id });
}

export async function verifyPassword(hash: string, plain: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, plain);
  } catch {
    // Malformed hash in storage reads as a failed login, not a 500.
    return false;
  }
}
