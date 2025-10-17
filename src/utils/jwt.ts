/**
 * JWT Utility Module
 * 
 * Handles JWT token generation and verification for web chat sessions
 * Includes token_version support for rotation/invalidation
 * 
 * Architecture: docs/WEB_CHAT_ARCHITECTURE.txt Section 6 & 7
 * 
 * NOTE: Requires 'jsonwebtoken' package - install with: bun add jsonwebtoken @types/jsonwebtoken
 */

import jwt, { type Secret, type SignOptions } from 'jsonwebtoken';
import { env } from '../config/env.js';
import { logger } from './logger.js';

/**
 * JWT payload for web chat sessions
 */
export interface WebChatJWTPayload {
  botId: string;
  sessionId: string;
  origin: string;
  tokenVersion: number;
  iat?: number;
  exp?: number;
}

/**
 * JWT configuration
 */
const JWT_SECRET: Secret = env.jwt?.secret || process.env.JWT_SECRET || 'your-secret-key-change-in-production';
const JWT_EXPIRY = env.jwt?.expiry || '15m'; // 15 minutes default

// Warn if using default secret in production
if (JWT_SECRET === 'your-secret-key-change-in-production' && env.server.nodeEnv === 'production') {
  logger.warn('⚠️  Using default JWT secret in production! Set JWT_SECRET environment variable.');
}

/**
 * Generate a JWT token for a web chat session
 */
export function generateWebChatToken(payload: Omit<WebChatJWTPayload, 'iat' | 'exp'>): string {
  try {
    const tokenPayload = {
      botId: payload.botId,
      sessionId: payload.sessionId,
      origin: payload.origin,
      tokenVersion: payload.tokenVersion,
    };

    const options: SignOptions = {
      expiresIn: JWT_EXPIRY as any,
      issuer: 'whatsapp-bot-saas',
      audience: 'web-chat',
    };

    const token = jwt.sign(tokenPayload, JWT_SECRET as string, options);

    logger.debug(
      {
        botId: payload.botId,
        sessionId: payload.sessionId,
        tokenVersion: payload.tokenVersion
      },
      'JWT token generated'
    );

    return token;
  } catch (error) {
    logger.error({ err: String(error) }, 'Error generating JWT token');
    throw new Error('Failed to generate JWT token');
  }
}

/**
 * Verify and decode a JWT token
 */
export function verifyWebChatToken(token: string): WebChatJWTPayload {
  try {
    const decoded = jwt.verify(token, JWT_SECRET, {
      issuer: 'whatsapp-bot-saas',
      audience: 'web-chat',
    }) as WebChatJWTPayload;

    logger.debug(
      {
        botId: decoded.botId,
        sessionId: decoded.sessionId,
        tokenVersion: decoded.tokenVersion
      },
      'JWT token verified'
    );

    return decoded;
  } catch (error) {
    if (error instanceof jwt.TokenExpiredError) {
      logger.warn('JWT token expired');
      throw new Error('Token expired');
    } else if (error instanceof jwt.JsonWebTokenError) {
      logger.warn({ err: String(error) }, 'Invalid JWT token');
      throw new Error('Invalid token');
    } else {
      logger.error({ err: String(error) }, 'Error verifying JWT token');
      throw new Error('Token verification failed');
    }
  }
}

/**
 * Decode a JWT token without verification (for debugging)
 */
export function decodeWebChatToken(token: string): WebChatJWTPayload | null {
  try {
    const decoded = jwt.decode(token) as WebChatJWTPayload;
    return decoded;
  } catch (error) {
    logger.error({ err: String(error) }, 'Error decoding JWT token');
    return null;
  }
}

/**
 * Check if a token is expired (without verification)
 */
export function isTokenExpired(token: string): boolean {
  try {
    const decoded = jwt.decode(token) as WebChatJWTPayload;
    if (!decoded || !decoded.exp) {
      return true;
    }

    const now = Math.floor(Date.now() / 1000);
    return decoded.exp < now;
  } catch (error) {
    return true;
  }
}

/**
 * Get token expiry time in seconds
 */
export function getTokenExpiry(token: string): number | null {
  try {
    const decoded = jwt.decode(token) as WebChatJWTPayload;
    return decoded?.exp || null;
  } catch (error) {
    return null;
  }
}

/**
 * Refresh a token (generate new token with same payload but new expiry)
 * Only if the old token is still valid
 */
export function refreshWebChatToken(oldToken: string): string {
  try {
    // Verify the old token first
    const payload = verifyWebChatToken(oldToken);

    // Generate new token with same payload
    return generateWebChatToken({
      botId: payload.botId,
      sessionId: payload.sessionId,
      origin: payload.origin,
      tokenVersion: payload.tokenVersion,
    });
  } catch (error) {
    logger.error({ err: String(error) }, 'Error refreshing JWT token');
    throw new Error('Failed to refresh token');
  }
}

/**
 * Validate token version against current version in database
 * Returns true if token version matches, false otherwise
 */
export async function validateTokenVersion(
  botId: string,
  tokenVersion: number,
  getCurrentVersion: () => Promise<number>
): Promise<boolean> {
  try {
    const currentVersion = await getCurrentVersion();
    const isValid = tokenVersion === currentVersion;

    if (!isValid) {
      logger.warn(
        {
          botId,
          tokenVersion,
          currentVersion
        },
        'Token version mismatch - token has been rotated'
      );
    }

    return isValid;
  } catch (error) {
    logger.error({ err: String(error), botId }, 'Error validating token version');
    return false;
  }
}

