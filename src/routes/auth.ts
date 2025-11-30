// Auth Routes - Handle authentication via Supabase (Google OAuth & Email/Password)

import { Hono } from 'hono';
import { supabase, supabaseAdmin } from '../db/supabase.js';
import { env } from '../config/env.js';
import pino from 'pino';

const logger = pino({ level: 'info' });
const app = new Hono();

// Get the frontend URL for redirects
const FRONTEND_URL = env.server.frontendUrl;

/**
 * POST /api/auth/signup
 * Sign up with email and password
 */
app.post('/signup', async (c) => {
    try {
        const body = await c.req.json();
        const { email, password, fullName } = body;

        if (!email || !password) {
            return c.json({ error: 'Email and password are required' }, 400);
        }

        // Sign up using Supabase Auth
        const { data, error } = await supabase.auth.signUp({
            email,
            password,
            options: {
                data: {
                    full_name: fullName || '',
                },
                emailRedirectTo: `${FRONTEND_URL}/auth/callback`,
            },
        });

        if (error) {
            logger.error({ err: error.message }, 'Signup error');
            return c.json({ error: error.message }, 400);
        }

        // Check if user needs email confirmation
        if (data.user && !data.session) {
            return c.json({
                success: true,
                message: 'Please check your email to confirm your account',
                user: {
                    id: data.user.id,
                    email: data.user.email,
                },
                requiresConfirmation: true,
            });
        }

        return c.json({
            success: true,
            message: 'Account created successfully',
            user: data.user ? {
                id: data.user.id,
                email: data.user.email,
                emailConfirmedAt: data.user.email_confirmed_at,
            } : null,
            session: data.session ? {
                accessToken: data.session.access_token,
                refreshToken: data.session.refresh_token,
                expiresAt: data.session.expires_at,
            } : null,
        });
    } catch (error: any) {
        logger.error({ err: String(error) }, 'Signup error');
        return c.json({ error: 'Internal server error' }, 500);
    }
});

/**
 * POST /api/auth/login
 * Login with email and password
 */
app.post('/login', async (c) => {
    try {
        const body = await c.req.json();
        const { email, password } = body;

        if (!email || !password) {
            return c.json({ error: 'Email and password are required' }, 400);
        }

        const { data, error } = await supabase.auth.signInWithPassword({
            email,
            password,
        });

        if (error) {
            logger.error({ err: error.message }, 'Login error');
            return c.json({ error: error.message }, 401);
        }

        // Get user profile
        const { data: profile } = await supabaseAdmin
            .from('user_profiles')
            .select('*')
            .eq('id', data.user.id)
            .single();

        return c.json({
            success: true,
            user: {
                id: data.user.id,
                email: data.user.email,
                fullName: profile?.full_name || data.user.user_metadata?.full_name || '',
                avatarUrl: profile?.avatar_url || data.user.user_metadata?.avatar_url || '',
                businessId: profile?.business_id,
                role: profile?.role || 'user',
            },
            session: {
                accessToken: data.session.access_token,
                refreshToken: data.session.refresh_token,
                expiresAt: data.session.expires_at,
            },
        });
    } catch (error: any) {
        logger.error({ err: String(error) }, 'Login error');
        return c.json({ error: 'Internal server error' }, 500);
    }
});

/**
 * POST /api/auth/logout
 * Logout the current user
 */
app.post('/logout', async (c) => {
    try {
        const authHeader = c.req.header('Authorization');

        if (authHeader && authHeader.startsWith('Bearer ')) {
            // Sign out from Supabase Auth
            const { error } = await supabase.auth.signOut();

            if (error) {
                logger.warn({ err: error.message }, 'Logout warning');
            }
        }

        return c.json({ success: true, message: 'Logged out successfully' });
    } catch (error: any) {
        logger.error({ err: String(error) }, 'Logout error');
        return c.json({ error: 'Internal server error' }, 500);
    }
});

/**
 * GET /api/auth/google
 * Initiate Google OAuth login - returns the OAuth URL
 */
app.get('/google', async (c) => {
    try {
        // Redirect directly to frontend callback - Supabase will include tokens in hash
        const redirectTo = c.req.query('redirectTo') || `${FRONTEND_URL}/auth/callback`;

        const { data, error } = await supabase.auth.signInWithOAuth({
            provider: 'google',
            options: {
                redirectTo,
                queryParams: {
                    access_type: 'offline',
                    prompt: 'consent',
                },
            },
        });

        if (error) {
            logger.error({ err: error.message }, 'Google OAuth error');
            return c.json({ error: error.message }, 400);
        }

        return c.json({
            success: true,
            url: data.url,
        });
    } catch (error: any) {
        logger.error({ err: String(error) }, 'Google OAuth error');
        return c.json({ error: 'Internal server error' }, 500);
    }
});

/**
 * GET /api/auth/callback
 * Handle OAuth callback - exchange code for session
 */
app.get('/callback', async (c) => {
    try {
        const code = c.req.query('code');
        const error = c.req.query('error');
        const errorDescription = c.req.query('error_description');
        const finalRedirect = c.req.query('finalRedirect') || `${FRONTEND_URL}/auth/callback`;

        if (error) {
            logger.error({ error, errorDescription }, 'OAuth callback error');
            return c.redirect(`${FRONTEND_URL}/login?error=${encodeURIComponent(errorDescription || error)}`);
        }

        if (!code) {
            logger.error('No authorization code received');
            return c.redirect(`${FRONTEND_URL}/login?error=${encodeURIComponent('No authorization code received')}`);
        }

        // Exchange the code for a session
        const { data, error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);

        if (exchangeError) {
            logger.error({ err: exchangeError.message }, 'Code exchange error');
            return c.redirect(`${FRONTEND_URL}/login?error=${encodeURIComponent(exchangeError.message)}`);
        }

        // Redirect to frontend with tokens (frontend will store them)
        const params = new URLSearchParams({
            access_token: data.session.access_token,
            refresh_token: data.session.refresh_token,
            expires_at: String(data.session.expires_at),
        });

        return c.redirect(`${finalRedirect}?${params.toString()}`);
    } catch (error: any) {
        logger.error({ err: String(error) }, 'Callback error');
        return c.redirect(`${FRONTEND_URL}/auth/error?error=Internal server error`);
    }
});

/**
 * POST /api/auth/refresh
 * Refresh access token using refresh token
 */
app.post('/refresh', async (c) => {
    try {
        const body = await c.req.json();
        const { refreshToken } = body;

        if (!refreshToken) {
            return c.json({ error: 'Refresh token is required' }, 400);
        }

        const { data, error } = await supabase.auth.refreshSession({
            refresh_token: refreshToken,
        });

        if (error) {
            logger.error({ err: error.message }, 'Token refresh error');
            return c.json({ error: error.message }, 401);
        }

        return c.json({
            success: true,
            session: {
                accessToken: data.session?.access_token,
                refreshToken: data.session?.refresh_token,
                expiresAt: data.session?.expires_at,
            },
        });
    } catch (error: any) {
        logger.error({ err: String(error) }, 'Token refresh error');
        return c.json({ error: 'Internal server error' }, 500);
    }
});

/**
 * GET /api/auth/me
 * Get current user info
 */
app.get('/me', async (c) => {
    try {
        const authHeader = c.req.header('Authorization');

        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return c.json({ error: 'Authorization header required' }, 401);
        }

        const token = authHeader.split(' ')[1];

        // Get user from token
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

        return c.json({
            success: true,
            user: {
                id: user.id,
                email: user.email,
                fullName: profile?.full_name || user.user_metadata?.full_name || '',
                avatarUrl: profile?.avatar_url || user.user_metadata?.avatar_url || '',
                businessId: profile?.business_id,
                role: profile?.role || 'user',
                provider: profile?.provider || 'email',
                emailConfirmed: !!user.email_confirmed_at,
                createdAt: user.created_at,
            },
        });
    } catch (error: any) {
        logger.error({ err: String(error) }, 'Get user error');
        return c.json({ error: 'Internal server error' }, 500);
    }
});

/**
 * PATCH /api/auth/profile
 * Update user profile
 */
app.patch('/profile', async (c) => {
    try {
        const authHeader = c.req.header('Authorization');

        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return c.json({ error: 'Authorization header required' }, 401);
        }

        const token = authHeader.split(' ')[1];
        const { data: { user }, error: authError } = await supabase.auth.getUser(token);

        if (authError || !user) {
            return c.json({ error: 'Invalid or expired token' }, 401);
        }

        const body = await c.req.json();
        const { fullName, avatarUrl, businessId } = body;

        // Update profile
        const updateData: Record<string, any> = {};
        if (fullName !== undefined) updateData.full_name = fullName;
        if (avatarUrl !== undefined) updateData.avatar_url = avatarUrl;
        if (businessId !== undefined) updateData.business_id = businessId;
        updateData.updated_at = new Date().toISOString();

        const { data: profile, error } = await supabaseAdmin
            .from('user_profiles')
            .update(updateData)
            .eq('id', user.id)
            .select()
            .single();

        if (error) {
            logger.error({ err: error.message }, 'Profile update error');
            return c.json({ error: 'Failed to update profile' }, 400);
        }

        return c.json({
            success: true,
            profile: {
                id: profile.id,
                email: profile.email,
                fullName: profile.full_name,
                avatarUrl: profile.avatar_url,
                businessId: profile.business_id,
                role: profile.role,
            },
        });
    } catch (error: any) {
        logger.error({ err: String(error) }, 'Profile update error');
        return c.json({ error: 'Internal server error' }, 500);
    }
});

/**
 * POST /api/auth/forgot-password
 * Send password reset email
 */
app.post('/forgot-password', async (c) => {
    try {
        const body = await c.req.json();
        const { email } = body;

        if (!email) {
            return c.json({ error: 'Email is required' }, 400);
        }

        const { error } = await supabase.auth.resetPasswordForEmail(email, {
            redirectTo: `${FRONTEND_URL}/auth/reset-password`,
        });

        if (error) {
            logger.error({ err: error.message }, 'Password reset error');
            // Don't reveal if email exists or not
        }

        // Always return success to prevent email enumeration
        return c.json({
            success: true,
            message: 'If an account with that email exists, a password reset link has been sent',
        });
    } catch (error: any) {
        logger.error({ err: String(error) }, 'Password reset error');
        return c.json({ error: 'Internal server error' }, 500);
    }
});

/**
 * POST /api/auth/reset-password
 * Reset password with token
 */
app.post('/reset-password', async (c) => {
    try {
        const body = await c.req.json();
        const { accessToken, newPassword } = body;

        if (!accessToken || !newPassword) {
            return c.json({ error: 'Access token and new password are required' }, 400);
        }

        // Verify the token and update password
        const { error } = await supabase.auth.updateUser({
            password: newPassword,
        });

        if (error) {
            logger.error({ err: error.message }, 'Password update error');
            return c.json({ error: error.message }, 400);
        }

        return c.json({
            success: true,
            message: 'Password updated successfully',
        });
    } catch (error: any) {
        logger.error({ err: String(error) }, 'Password update error');
        return c.json({ error: 'Internal server error' }, 500);
    }
});

/**
 * POST /api/auth/verify-email
 * Resend email verification
 */
app.post('/verify-email', async (c) => {
    try {
        const body = await c.req.json();
        const { email } = body;

        if (!email) {
            return c.json({ error: 'Email is required' }, 400);
        }

        const { error } = await supabase.auth.resend({
            type: 'signup',
            email,
            options: {
                emailRedirectTo: `${FRONTEND_URL}/auth/callback`,
            },
        });

        if (error) {
            logger.error({ err: error.message }, 'Email verification resend error');
            return c.json({ error: error.message }, 400);
        }

        return c.json({
            success: true,
            message: 'Verification email sent',
        });
    } catch (error: any) {
        logger.error({ err: String(error) }, 'Email verification resend error');
        return c.json({ error: 'Internal server error' }, 500);
    }
});

export default app;
