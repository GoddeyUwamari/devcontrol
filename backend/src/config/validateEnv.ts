/**
 * Environment Variable Validation
 * Ensures all required configuration is present and valid before server starts
 */

/**
 * Validate required environment variables
 * Throws error if any required variables are missing or invalid
 */
export function validateEnv(): void {
  console.log('🔍 Validating environment variables...');

  // Required variables for all environments
  const required = [
    'JWT_SECRET',
    'ENCRYPTION_KEY',
    'DB_HOST',
    'DB_NAME',
    'DB_USER',
    'DB_PASSWORD',
  ];

  // Check for missing variables
  const missing = required.filter(key => !process.env[key]);

  if (missing.length > 0) {
    throw new Error(
      `❌ Missing required environment variables:\n` +
      `   ${missing.join(', ')}\n` +
      `   Please check your .env file`
    );
  }

  // Validate JWT_SECRET strength
  const jwtSecret = process.env.JWT_SECRET!;
  if (jwtSecret.length < 32) {
    throw new Error(
      `❌ JWT_SECRET must be at least 32 characters for security\n` +
      `   Current length: ${jwtSecret.length} characters\n` +
      `   Generate a strong secret with: openssl rand -base64 32`
    );
  }

  // Validate ENCRYPTION_KEY length (must be exactly 32 for AES-256)
  const encryptionKey = process.env.ENCRYPTION_KEY!;
  if (encryptionKey.length !== 32) {
    throw new Error(
      `❌ ENCRYPTION_KEY must be exactly 32 characters for AES-256\n` +
      `   Current length: ${encryptionKey.length} characters\n` +
      `   Generate with: openssl rand -hex 16`
    );
  }

  // Production-specific validations
  if (process.env.NODE_ENV === 'production') {
    console.log('🔒 Running production environment checks...');

    // Ensure FRONTEND_URL uses HTTPS in production
    if (process.env.FRONTEND_URL && !process.env.FRONTEND_URL.startsWith('https://')) {
      throw new Error(
        `❌ FRONTEND_URL must use HTTPS in production\n` +
        `   Current: ${process.env.FRONTEND_URL}\n` +
        `   Required: https://...`
      );
    }

    // Ensure JWT_SECRET is changed from default
    const defaultSecret = 'dev-jwt-secret-key-please-change-in-production-min-32-chars-long';
    if (jwtSecret === defaultSecret) {
      throw new Error(
        `❌ JWT_SECRET must be changed from default value in production!\n` +
        `   Generate a strong secret with: openssl rand -base64 32`
      );
    }

    // Ensure database is not localhost in production
    if (process.env.DB_HOST === 'localhost' || process.env.DB_HOST === '127.0.0.1') {
      console.warn(
        `⚠️  WARNING: Database host is localhost in production\n` +
        `   This may cause issues in containerized/cloud environments`
      );
    }

    // Check for other production-critical variables
    const productionRecommended = ['AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'STRIPE_SECRET_KEY'];
    const missingRecommended = productionRecommended.filter(key => !process.env[key]);

    if (missingRecommended.length > 0) {
      console.warn(
        `⚠️  WARNING: Recommended production variables not set:\n` +
        `   ${missingRecommended.join(', ')}\n` +
        `   Some features may not work correctly`
      );
    }
  }

  // Development-specific validations
  if (process.env.NODE_ENV === 'development') {
    console.log('🔧 Running development environment checks...');

    // Warn if using weak secrets in development (still need minimum length)
    if (jwtSecret.length < 40) {
      console.warn(
        `⚠️  JWT_SECRET is short (${jwtSecret.length} chars). ` +
        `Consider using a longer secret even in development.`
      );
    }
  }

  // Validate database port if provided
  if (process.env.DB_PORT) {
    const port = parseInt(process.env.DB_PORT);
    if (isNaN(port) || port < 1 || port > 65535) {
      throw new Error(
        `❌ DB_PORT must be a valid port number (1-65535)\n` +
        `   Current: ${process.env.DB_PORT}`
      );
    }
  }

  // Validate PORT if provided
  if (process.env.PORT) {
    const port = parseInt(process.env.PORT);
    if (isNaN(port) || port < 1 || port > 65535) {
      throw new Error(
        `❌ PORT must be a valid port number (1-65535)\n` +
        `   Current: ${process.env.PORT}`
      );
    }
  }

  console.log('✅ Environment validation passed');
  console.log(`   Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`   Database: ${process.env.DB_HOST}:${process.env.DB_PORT || 5432}`);
  console.log(`   JWT Secret: ${jwtSecret.length} characters`);
  console.log(`   Encryption Key: ${encryptionKey.length} characters`);
}

/**
 * Get safe environment info for logging (without secrets)
 */
export function getSafeEnvInfo(): Record<string, any> {
  return {
    nodeEnv: process.env.NODE_ENV || 'development',
    port: process.env.PORT || 8080,
    dbHost: process.env.DB_HOST,
    dbPort: process.env.DB_PORT || 5432,
    dbName: process.env.DB_NAME,
    frontendUrl: process.env.FRONTEND_URL || 'http://localhost:3010',
    hasAwsCredentials: !!(process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY),
    hasStripeKey: !!process.env.STRIPE_SECRET_KEY,
    jwtSecretLength: process.env.JWT_SECRET?.length || 0,
    encryptionKeyLength: process.env.ENCRYPTION_KEY?.length || 0,
  };
}
