// Booking validation schemas using Zod

import { z } from 'zod';

/**
 * Booking state enum
 */
export enum BookingState {
  IDLE = 'idle',
  COLLECTING_NAME = 'collecting_name',
  COLLECTING_BOOKING_FOR = 'collecting_booking_for',
  COLLECTING_GENDER = 'collecting_gender',
  SHOWING_SERVICES = 'showing_services',
  COLLECTING_SERVICE = 'collecting_service',
  SHOWING_DATES = 'showing_dates',
  COLLECTING_DATE = 'collecting_date',
  SHOWING_TIME_SLOTS = 'showing_time_slots',
  COLLECTING_TIME = 'collecting_time',
  CONFIRMING = 'confirming',
  COMPLETED = 'completed',
}

/**
 * Gender enum
 */
export enum Gender {
  MALE = 'male',
  FEMALE = 'female',
  OTHER = 'other',
}

/**
 * Booking status enum
 */
export enum BookingStatus {
  PENDING = 'pending',
  CONFIRMED = 'confirmed',
  CANCELLED = 'cancelled',
  COMPLETED = 'completed',
  NO_SHOW = 'no_show',
}

/**
 * Name validation schema
 */
export const nameSchema = z
  .string()
  .min(2, 'Name must be at least 2 characters')
  .max(100, 'Name is too long (max 100 characters)')
  .regex(/^[a-zA-Z\s.'-]+$/, 'Name should only contain letters, spaces, dots, hyphens, and apostrophes')
  .transform((val) => val.trim());

/**
 * Booking for validation schema
 */
export const bookingForSchema = z
  .string()
  .min(2, 'Please provide a valid name or "self"')
  .max(100, 'Name is too long (max 100 characters)')
  .transform((val) => val.trim().toLowerCase())
  .refine(
    (val) => val === 'self' || val === 'myself' || val === 'me' || /^[a-zA-Z\s.'-]+$/.test(val),
    'Please enter a valid name or "self"'
  );

/**
 * Gender validation schema
 */
export const genderSchema = z
  .string()
  .transform((val) => val.trim().toLowerCase())
  .refine(
    (val) => ['male', 'female', 'other', 'm', 'f', 'o'].includes(val),
    'Please select: Male, Female, or Other'
  )
  .transform((val) => {
    if (val === 'm' || val === 'male') return Gender.MALE;
    if (val === 'f' || val === 'female') return Gender.FEMALE;
    return Gender.OTHER;
  });

/**
 * Service selection validation schema
 * Accepts: number (1, 2, 3), full name, or partial name
 */
export const serviceSelectionSchema = z
  .string()
  .min(1, 'Please select a service')
  .transform((val) => val.trim());

/**
 * Date validation schema
 */
export const dateSchema = z
  .string()
  .transform((val) => val.trim().toLowerCase())
  .refine((val) => {
    // Accept various formats: "today", "tomorrow", "1", "2", "oct 14", "14 oct", "2025-10-14"
    return (
      val === 'today' ||
      val === 'tomorrow' ||
      /^\d+$/.test(val) || // Just a number (1, 2, 3)
      /^\d{4}-\d{2}-\d{2}$/.test(val) || // YYYY-MM-DD
      /^[a-z]{3}\s?\d{1,2}$/.test(val) || // oct 14 or oct14
      /^\d{1,2}\s?[a-z]{3}$/.test(val) // 14 oct or 14oct
    );
  }, 'Invalid date format. Please select from the options or use format: YYYY-MM-DD');

/**
 * Time validation schema
 */
export const timeSchema = z
  .string()
  .transform((val) => val.trim())
  .refine((val) => {
    // Accept: number (1, 2, 3) or time format (10:00, 10:00 AM, 10:00AM)
    return /^\d+$/.test(val) || /^\d{1,2}:\d{2}(\s?(AM|PM|am|pm))?$/.test(val);
  }, 'Invalid time format. Please select from the options or use format: HH:MM');

/**
 * Confirmation validation schema
 */
export const confirmationSchema = z
  .string()
  .transform((val) => val.trim().toLowerCase())
  .refine(
    (val) => ['confirm', 'yes', 'y', 'ok', 'okay', 'cancel', 'no', 'n'].includes(val),
    'Please reply with "CONFIRM" or "CANCEL"'
  )
  .transform((val) => ['confirm', 'yes', 'y', 'ok', 'okay'].includes(val));

/**
 * Conversation state schema
 */
export const conversationStateSchema = z.object({
  currentStep: z.nativeEnum(BookingState),
  collectedData: z.object({
    customerName: z.string().optional(),
    customerPhone: z.string(),
    bookingFor: z.string().optional(),
    gender: z.nativeEnum(Gender).optional(),
    serviceId: z.string().uuid().optional(),
    serviceName: z.string().optional(),
    servicePrice: z.number().optional(),
    serviceDuration: z.number().optional(),
    bookingDate: z.string().optional(), // YYYY-MM-DD
    bookingTime: z.string().optional(), // HH:MM
  }),
  validationErrors: z.array(z.string()).default([]),
  retryCount: z.number().default(0),
});

export type ConversationState = z.infer<typeof conversationStateSchema>;

/**
 * Business service schema
 */
export const businessServiceSchema = z.object({
  id: z.string().uuid(),
  business_id: z.string().uuid(),
  name: z.string(),
  description: z.string().nullable(),
  price: z.number().nullable(),
  duration: z.number().default(30),
  category: z.string().nullable(),
  is_active: z.boolean().default(true),
  display_order: z.number().default(0),
});

export type BusinessService = z.infer<typeof businessServiceSchema>;

/**
 * Time slot schema
 */
export const timeSlotSchema = z.object({
  id: z.string().uuid(),
  business_id: z.string().uuid(),
  day_of_week: z.number().min(0).max(6),
  start_time: z.string(), // HH:MM:SS
  end_time: z.string(), // HH:MM:SS
  slot_duration: z.number().default(30),
  is_active: z.boolean().default(true),
});

export type TimeSlot = z.infer<typeof timeSlotSchema>;

/**
 * Booking schema
 */
export const bookingSchema = z.object({
  id: z.string().uuid().optional(),
  business_id: z.string().uuid(),
  bot_id: z.string().uuid(),
  customer_name: z.string(),
  customer_phone: z.string(),
  booking_for: z.string().optional(),
  gender: z.string().optional(),
  service_id: z.string().uuid().optional(),
  service_name: z.string(),
  service_price: z.number().optional(),
  booking_date: z.string(), // YYYY-MM-DD
  booking_time: z.string(), // HH:MM
  duration: z.number().default(30),
  status: z.nativeEnum(BookingStatus).default(BookingStatus.PENDING),
  notes: z.string().optional(),
});

export type Booking = z.infer<typeof bookingSchema>;

/**
 * Validation helper functions
 */
export class BookingValidator {
  /**
   * Validate name input
   */
  static validateName(input: string): { valid: boolean; value?: string; error?: string } {
    try {
      const value = nameSchema.parse(input);
      return { valid: true, value };
    } catch (error: any) {
      return { valid: false, error: error.errors[0]?.message || 'Invalid name' };
    }
  }

  /**
   * Validate booking for input
   */
  static validateBookingFor(input: string): { valid: boolean; value?: string; error?: string } {
    try {
      const value = bookingForSchema.parse(input);
      return { valid: true, value };
    } catch (error: any) {
      return { valid: false, error: error.errors[0]?.message || 'Invalid input' };
    }
  }

  /**
   * Validate gender input
   */
  static validateGender(input: string): { valid: boolean; value?: Gender; error?: string } {
    try {
      const value = genderSchema.parse(input);
      return { valid: true, value };
    } catch (error: any) {
      return { valid: false, error: error.errors[0]?.message || 'Invalid gender' };
    }
  }

  /**
   * Validate service selection
   */
  static validateServiceSelection(input: string): { valid: boolean; value?: string; error?: string } {
    try {
      const value = serviceSelectionSchema.parse(input);
      return { valid: true, value };
    } catch (error: any) {
      return { valid: false, error: error.errors[0]?.message || 'Invalid service selection' };
    }
  }

  /**
   * Validate date input
   */
  static validateDate(input: string): { valid: boolean; value?: string; error?: string } {
    try {
      const value = dateSchema.parse(input);
      return { valid: true, value };
    } catch (error: any) {
      return { valid: false, error: error.errors[0]?.message || 'Invalid date' };
    }
  }

  /**
   * Validate time input
   */
  static validateTime(input: string): { valid: boolean; value?: string; error?: string } {
    try {
      const value = timeSchema.parse(input);
      return { valid: true, value };
    } catch (error: any) {
      return { valid: false, error: error.errors[0]?.message || 'Invalid time' };
    }
  }

  /**
   * Validate confirmation input
   */
  static validateConfirmation(input: string): { valid: boolean; value?: boolean; error?: string } {
    try {
      const value = confirmationSchema.parse(input);
      return { valid: true, value };
    } catch (error: any) {
      return { valid: false, error: error.errors[0]?.message || 'Invalid confirmation' };
    }
  }
}

