const DEVELOPMENT_JWT_SECRET = "dev-secret-change-me";

/**
 * Returns the application signing secret shared by authentication-related
 * cryptographic operations. Production must always provide a strong secret;
 * the stable fallback exists only so local development works without setup.
 */
export function applicationSecret(): string {
  const configured = process.env.JWT_SECRET;
  if (process.env.NODE_ENV === "production" && (!configured || configured === DEVELOPMENT_JWT_SECRET)) {
    throw new Error(
      "JWT_SECRET must be set to a strong, unique value in production. Refusing to start with the default/dev secret."
    );
  }
  return configured || DEVELOPMENT_JWT_SECRET;
}
