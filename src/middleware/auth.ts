// Auth Middleware - Protect routes with Supabase Auth

import { Context, Next } from 'hono';
import { supabase, supabaseAdmin } from '../db/supabase.js';
import pino from 'pino';

const logger = pino({ level: 'info' });

export interface AuthUser {
    id: string;
    email: string;
    fullName?: string;
    avatarUrl?: string;
    businessId?: string;
    role?: string;
    provider?: string;
}

/**
 * Middleware to require authentication
 * Extracts user from Bearer token and adds to context
 */
export const requireAuth = async (c: Context, next: Next): Promise<Response | void> => {
    try {
        const authHeader = c.req.header('Authorization');

        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return c.json({ error: 'Authorization header required' }, 401);
        }

        const token = authHeader.split(' ')[1];

        // Verify token with Supabase
        const { data: { user }, error } = await supabase.auth.getUser(token);

        if (error || !user) {
            return c.json({ error: 'Invalid or expired token' }, 401);
        }

        // Get user profile
        const { data: profile } = await supabaseAdmin
            .from('user_profiles')
            .select('*')
            .eq('id', user.id)
            .single();

        // Build auth user object
        const authUser: AuthUser = {
            id: user.id,
            email: user.email || '',
            fullName: profile?.full_name || user.user_metadata?.full_name || '',
            avatarUrl: profile?.avatar_url || user.user_metadata?.avatar_url || '',
            businessId: profile?.business_id,
            role: profile?.role || 'user',
            provider: profile?.provider || 'email',
        };

        // Store user in context
        c.set('user', authUser);
        c.set('userId', user.id);
        c.set('businessId', profile?.business_id);

        return next();
    } catch (error: any) {
        logger.error({ err: String(error) }, 'Auth middleware error');
        return c.json({ error: 'Authentication failed' }, 500);
    }
};

/**
 * Middleware to require specific role
 * Must be used after requireAuth
 */
export const requireRole = (...allowedRoles: string[]) => {
    return async (c: Context, next: Next): Promise<Response | void> => {
        const user = c.get('user') as AuthUser | undefined;

        if (!user) {
            return c.json({ error: 'Authentication required' }, 401);
        }

        if (!user.role || !allowedRoles.includes(user.role)) {
            return c.json({ error: 'Insufficient permissions' }, 403);
        }

        return next();
    };
};

/**
 * Middleware to require user to have a business
 * Must be used after requireAuth
 */
export const requireBusiness = async (c: Context, next: Next): Promise<Response | void> => {
    const user = c.get('user') as AuthUser | undefined;

    if (!user) {
        return c.json({ error: 'Authentication required' }, 401);
    }

    if (!user.businessId) {
        return c.json({ error: 'Business association required. Please set up your business first.' }, 403);
    }

    return next();
};

/**
 * Optional auth middleware
 * Extracts user if token provided, but doesn't require it
 */
export const optionalAuth = async (c: Context, next: Next): Promise<void> => {
    try {
        const authHeader = c.req.header('Authorization');

        if (authHeader && authHeader.startsWith('Bearer ')) {
            const token = authHeader.split(' ')[1];

            const { data: { user } } = await supabase.auth.getUser(token);

            if (user) {
                const { data: profile } = await supabaseAdmin
                    .from('user_profiles')
                    .select('*')
                    .eq('id', user.id)
                    .single();

                const authUser: AuthUser = {
                    id: user.id,
                    email: user.email || '',
                    fullName: profile?.full_name || user.user_metadata?.full_name || '',
                    avatarUrl: profile?.avatar_url || user.user_metadata?.avatar_url || '',
                    businessId: profile?.business_id,
                    role: profile?.role || 'user',
                    provider: profile?.provider || 'email',
                };

                c.set('user', authUser);
                c.set('userId', user.id);
                c.set('businessId', profile?.business_id);
            }
        }

        await next();
    } catch {
        // Silently continue without auth
        await next();
    }
};
