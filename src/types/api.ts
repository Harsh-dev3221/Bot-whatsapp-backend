// API request/response types

import { z } from 'zod';

// Business schemas
export const createBusinessSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  phone: z.string().min(10),
  subscription_plan: z.enum(['free', 'basic', 'pro', 'enterprise']).default('free'),
});

export const updateBusinessSchema = createBusinessSchema.partial();

export type CreateBusinessRequest = z.infer<typeof createBusinessSchema>;
export type UpdateBusinessRequest = z.infer<typeof updateBusinessSchema>;

// Bot schemas
export const createBotSchema = z.object({
  business_id: z.string().uuid(),
  name: z.string().min(1),
  phone_number: z.string().min(10),
});

export const updateBotSchema = z.object({
  name: z.string().min(1).optional(),
  status: z.enum(['disconnected', 'connecting', 'connected', 'failed']).optional(),
});

export type CreateBotRequest = z.infer<typeof createBotSchema>;
export type UpdateBotRequest = z.infer<typeof updateBotSchema>;

// Bot settings schemas
export const updateBotSettingsSchema = z.object({
  greeting_message: z.string().optional(),
  auto_reply_enabled: z.boolean().optional(),
  auto_reply_message: z.string().optional(),
  business_hours_enabled: z.boolean().optional(),
  business_hours_start: z.string().optional(),
  business_hours_end: z.string().optional(),
});

export type UpdateBotSettingsRequest = z.infer<typeof updateBotSettingsSchema>;

// Message schemas
export const sendMessageSchema = z.object({
  bot_id: z.string().uuid(),
  to_number: z.string().min(10),
  message_type: z.enum(['text', 'image', 'video', 'audio', 'document']).default('text'),
  content: z.string(),
  media_url: z.string().url().optional(),
});

export type SendMessageRequest = z.infer<typeof sendMessageSchema>;

// Auth schemas
export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
});

export const registerSchema = z.object({
  business_id: z.string().uuid(),
  email: z.string().email(),
  password: z.string().min(6),
  role: z.enum(['admin', 'user']).default('user'),
});

export type LoginRequest = z.infer<typeof loginSchema>;
export type RegisterRequest = z.infer<typeof registerSchema>;

// API response types
export interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
  hasMore: boolean;
}

