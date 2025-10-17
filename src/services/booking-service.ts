// Booking service - Core booking logic

import { supabaseAdmin } from '../db/supabase.js';
import { BookingStateManager } from './booking-state-manager.js';
import {
  BookingState,
  BookingValidator,
  type ConversationState,
} from './booking-validator.js';
import type { MessagingAdapter } from '../adapters/messaging-adapter.js';
import pino from 'pino';

const logger = pino({ level: 'info' });

export class BookingService {
  /**
   * Check if message is a booking trigger
   */
  static isBookingTrigger(message: string, keywords: string[]): boolean {
    const lowerMessage = message.toLowerCase();
    return keywords.some((keyword) => lowerMessage.includes(keyword.toLowerCase()));
  }

  /**
   * Check if booking is enabled for bot
   */
  static async isBookingEnabled(botId: string): Promise<boolean> {
    try {
      const { data, error } = await supabaseAdmin
        .from('bot_settings')
        .select('booking_enabled')
        .eq('bot_id', botId)
        .single();

      if (error || !data) return false;
      return (data as any).booking_enabled === true;
    } catch (error) {
      return false;
    }
  }

  /**
   * Get booking trigger keywords for bot
   */
  static async getBookingKeywords(botId: string): Promise<string[]> {
    try {
      const { data, error } = await supabaseAdmin
        .from('bot_settings')
        .select('booking_trigger_keywords')
        .eq('bot_id', botId)
        .single();

      if (error || !data) {
        return ['book', 'booking', 'appointment', 'schedule', 'reserve'];
      }

      return (data as any).booking_trigger_keywords || ['book', 'booking', 'appointment', 'schedule', 'reserve'];
    } catch (error) {
      return ['book', 'booking', 'appointment', 'schedule', 'reserve'];
    }
  }

  /**
   * Main handler for booking messages
   */
  static async handleBookingMessage(
    adapter: MessagingAdapter,
    message: string
  ): Promise<void> {
    const botId = adapter.getBotId();
    const businessId = adapter.getBusinessId();
    const customerPhone = adapter.getUserKey();
    try {
      // Get or create conversation state
      const state = await BookingStateManager.getOrCreateState(botId, businessId, customerPhone);

      // Extend expiry on each message
      await BookingStateManager.extendExpiry(botId, customerPhone);

      // Check if user wants to cancel
      if (message.toLowerCase().trim() === 'cancel' && state.currentStep !== BookingState.CONFIRMING) {
        await this.handleCancel(adapter);
        return;
      }

      // Route to appropriate handler based on current step
      switch (state.currentStep) {
        case BookingState.IDLE:
          await this.startBooking(adapter, state);
          break;

        case BookingState.COLLECTING_NAME:
          await this.handleNameInput(adapter, message, state);
          break;

        case BookingState.COLLECTING_BOOKING_FOR:
          await this.handleBookingForInput(adapter, message, state);
          break;

        case BookingState.COLLECTING_GENDER:
          await this.handleGenderInput(adapter, message, state);
          break;

        case BookingState.COLLECTING_SERVICE:
          await this.handleServiceInput(adapter, message, state);
          break;

        case BookingState.COLLECTING_DATE:
          await this.handleDateInput(adapter, message, state);
          break;

        case BookingState.COLLECTING_TIME:
          await this.handleTimeInput(adapter, message, state);
          break;

        case BookingState.CONFIRMING:
          await this.handleConfirmation(adapter, message, state);
          break;

        default:
          await this.startBooking(adapter, state);
      }
    } catch (error) {
      logger.error({ err: String(error), botId, customerPhone }, 'Error handling booking message');
      await this.sendMessage(adapter, '❌ Sorry, something went wrong. Please try again or type "cancel" to start over.');
    }
  }

  /**
   * Start booking conversation
   */
  private static async startBooking(
    adapter: MessagingAdapter,
    state: ConversationState
  ): Promise<void> {
    const botId = adapter.getBotId();
    const customerPhone = adapter.getUserKey();

    state.currentStep = BookingState.COLLECTING_NAME;
    await BookingStateManager.updateState(botId, customerPhone, state);

    const message = `👋 Hi! I'll help you book an appointment.\n\n📝 What's your name?`;
    await this.sendMessage(adapter, message);
  }

  /**
   * Handle name input
   */
  private static async handleNameInput(
    adapter: MessagingAdapter,
    message: string,
    state: ConversationState
  ): Promise<void> {
    const botId = adapter.getBotId();
    const customerPhone = adapter.getUserKey();

    const validation = BookingValidator.validateName(message);

    if (!validation.valid) {
      await this.sendMessage(adapter, `❌ ${validation.error}\n\nPlease enter your name again:`);
      return;
    }

    state.collectedData.customerName = validation.value;

    // Check if booking_for is required
    const { data: settings } = await supabaseAdmin
      .from('bot_settings')
      .select('booking_require_booking_for')
      .eq('bot_id', botId)
      .single();

    const requireBookingFor = (settings as any)?.booking_require_booking_for !== false;

    if (requireBookingFor) {
      state.currentStep = BookingState.COLLECTING_BOOKING_FOR;
      await BookingStateManager.updateState(botId, customerPhone, state);
      await this.sendMessage(adapter, `Great, ${validation.value}! 👤\n\nWho is this booking for?\n(Reply "self" if it's for you)`);
    } else {
      state.collectedData.bookingFor = 'self';
      state.currentStep = BookingState.COLLECTING_GENDER;
      await BookingStateManager.updateState(botId, customerPhone, state);
      await this.sendMessage(adapter, `Great, ${validation.value}! ⚧\n\nWhat's the gender?\n\n1️⃣ Male\n2️⃣ Female\n3️⃣ Other\n\nReply with number or name:`);
    }
  }

  /**
   * Handle booking for input
   */
  private static async handleBookingForInput(
    adapter: MessagingAdapter,
    message: string,
    state: ConversationState
  ): Promise<void> {
    const botId = adapter.getBotId();
    const businessId = adapter.getBusinessId();
    const customerPhone = adapter.getUserKey();

    const validation = BookingValidator.validateBookingFor(message);

    if (!validation.valid) {
      await this.sendMessage(adapter, `❌ ${validation.error}\n\nPlease enter the name or "self":`);
      return;
    }

    state.collectedData.bookingFor = validation.value;

    // Check if gender is required
    const { data: settings } = await supabaseAdmin
      .from('bot_settings')
      .select('booking_require_gender')
      .eq('bot_id', botId)
      .single();

    const requireGender = (settings as any)?.booking_require_gender !== false;

    if (requireGender) {
      state.currentStep = BookingState.COLLECTING_GENDER;
      await BookingStateManager.updateState(botId, customerPhone, state);
      await this.sendMessage(adapter, `Perfect! ⚧\n\nWhat's the gender?\n\n1️⃣ Male\n2️⃣ Female\n3️⃣ Other\n\nReply with number or name:`);
    } else {
      state.currentStep = BookingState.SHOWING_SERVICES;
      await BookingStateManager.updateState(botId, customerPhone, state);
      await this.showServices(adapter, state);
    }
  }

  /**
   * Handle gender input
   */
  private static async handleGenderInput(
    adapter: MessagingAdapter,
    message: string,
    state: ConversationState
  ): Promise<void> {
    const botId = adapter.getBotId();
    const customerPhone = adapter.getUserKey();

    // Handle number selection
    let input = message.trim();
    if (input === '1') input = 'male';
    else if (input === '2') input = 'female';
    else if (input === '3') input = 'other';

    const validation = BookingValidator.validateGender(input);

    if (!validation.valid) {
      await this.sendMessage(adapter, `❌ ${validation.error}\n\nPlease select:\n1️⃣ Male\n2️⃣ Female\n3️⃣ Other`);
      return;
    }

    state.collectedData.gender = validation.value;
    state.currentStep = BookingState.SHOWING_SERVICES;
    await BookingStateManager.updateState(botId, customerPhone, state);

    await this.showServices(adapter, state);
  }

  /**
   * Show services menu
   */
  private static async showServices(
    adapter: MessagingAdapter,
    state: ConversationState
  ): Promise<void> {
    const botId = adapter.getBotId();
    const businessId = adapter.getBusinessId();
    const customerPhone = adapter.getUserKey();

    // Get services from database
    const { data: services, error } = await supabaseAdmin
      .from('business_services')
      .select('*')
      .eq('business_id', businessId)
      .eq('is_active', true)
      .order('display_order', { ascending: true });

    if (error || !services || services.length === 0) {
      await this.sendMessage(adapter, '❌ Sorry, no services are available at the moment. Please contact us directly.');
      await BookingStateManager.cancelConversation(botId, customerPhone);
      return;
    }

    // Format services menu
    let message = '💇 Here are our services:\n\n';
    services.forEach((service: any, index: number) => {
      const price = service.price ? `₹${service.price}` : 'Price on request';
      const duration = service.duration ? `${service.duration} min` : '';
      message += `${index + 1}️⃣ ${service.name} - ${price}`;
      if (duration) message += ` (${duration})`;
      if (service.description) message += `\n   ${service.description}`;
      message += '\n\n';
    });

    message += 'Reply with the number or service name:';

    state.currentStep = BookingState.COLLECTING_SERVICE;
    await BookingStateManager.updateState(botId, customerPhone, state);
    await this.sendMessage(adapter, message);
  }

  /**
   * Send message helper
   */
  private static async sendMessage(adapter: MessagingAdapter, message: string): Promise<void> {
    await adapter.sendText({ text: message });
  }

  /**
   * Handle cancel
   */
  private static async handleCancel(adapter: MessagingAdapter): Promise<void> {
    const botId = adapter.getBotId();
    const customerPhone = adapter.getUserKey();

    await BookingStateManager.cancelConversation(botId, customerPhone);
    await this.sendMessage(adapter, '❌ Booking cancelled. Feel free to start again anytime by typing "book"!');
  }

  /**
   * Handle service selection
   */
  private static async handleServiceInput(
    adapter: MessagingAdapter,
    message: string,
    state: ConversationState
  ): Promise<void> {
    const botId = adapter.getBotId();
    const businessId = adapter.getBusinessId();
    const customerPhone = adapter.getUserKey();
    const validation = BookingValidator.validateServiceSelection(message);

    if (!validation.valid) {
      await this.sendMessage(adapter, `❌ ${validation.error}\n\nPlease select a service by number or name:`);
      return;
    }

    // Get services
    const { data: services, error } = await supabaseAdmin
      .from('business_services')
      .select('*')
      .eq('business_id', businessId)
      .eq('is_active', true)
      .order('display_order', { ascending: true });

    if (error || !services || services.length === 0) {
      await this.sendMessage(adapter, '❌ Sorry, no services available.');
      return;
    }

    // Find service by number or name
    let selectedService: any = null;
    const input = validation.value!.toLowerCase();

    // Check if input is a number
    if (/^\d+$/.test(input)) {
      const index = parseInt(input) - 1;
      if (index >= 0 && index < services.length) {
        selectedService = services[index];
      }
    } else {
      // Search by name (exact or partial match)
      selectedService = services.find((s: any) =>
        s.name.toLowerCase() === input ||
        s.name.toLowerCase().includes(input)
      );
    }

    if (!selectedService) {
      await this.sendMessage(adapter, '❌ Service not found. Please select from the list by number or name:');
      return;
    }

    // Save selected service
    state.collectedData.serviceId = selectedService.id;
    state.collectedData.serviceName = selectedService.name;
    state.collectedData.servicePrice = selectedService.price;
    state.collectedData.serviceDuration = selectedService.duration;
    state.currentStep = BookingState.SHOWING_DATES;
    await BookingStateManager.updateState(botId, customerPhone, state);

    await this.showAvailableDates(adapter, state);
  }

  /**
   * Show available dates
   */
  private static async showAvailableDates(
    adapter: MessagingAdapter,
    state: ConversationState
  ): Promise<void> {
    const botId = adapter.getBotId();
    const customerPhone = adapter.getUserKey();

    const today = new Date();
    const dates: { label: string; value: string }[] = [];

    // Show next 7 days
    for (let i = 0; i < 7; i++) {
      const date = new Date(today);
      date.setDate(today.getDate() + i);

      const dateStr = date.toISOString().split('T')[0];

      let label = '';
      if (i === 0) label = 'Today';
      else if (i === 1) label = 'Tomorrow';
      else label = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

      dates.push({ label, value: dateStr });
    }

    let message = `Great choice! ${state.collectedData.serviceName} selected. 📅\n\nAvailable dates:\n\n`;
    dates.forEach((date, index) => {
      message += `${index + 1}️⃣ ${date.label} (${date.value})\n`;
    });
    message += '\nReply with the number or date:';

    state.currentStep = BookingState.COLLECTING_DATE;
    await BookingStateManager.updateState(botId, customerPhone, state);
    await this.sendMessage(adapter, message);
  }

  /**
   * Handle date selection
   */
  private static async handleDateInput(
    adapter: MessagingAdapter,
    message: string,
    state: ConversationState
  ): Promise<void> {
    const botId = adapter.getBotId();
    const customerPhone = adapter.getUserKey();

    let input = message.trim().toLowerCase();
    let selectedDate: string | null = null;

    // Handle number selection (1-7)
    if (/^\d+$/.test(input)) {
      const index = parseInt(input) - 1;
      if (index >= 0 && index < 7) {
        const date = new Date();
        date.setDate(date.getDate() + index);
        selectedDate = date.toISOString().split('T')[0];
      }
    } else if (input === 'today') {
      selectedDate = new Date().toISOString().split('T')[0];
    } else if (input === 'tomorrow') {
      const date = new Date();
      date.setDate(date.getDate() + 1);
      selectedDate = date.toISOString().split('T')[0];
    } else if (/^\d{4}-\d{2}-\d{2}$/.test(input)) {
      selectedDate = input;
    }

    if (!selectedDate) {
      await this.sendMessage(adapter, '❌ Invalid date. Please select from the list by number:');
      return;
    }

    // Validate date is not in the past
    const bookingDate = new Date(selectedDate);
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    if (bookingDate < today) {
      await this.sendMessage(adapter, '❌ Cannot book in the past. Please select a future date:');
      return;
    }

    state.collectedData.bookingDate = selectedDate;
    state.currentStep = BookingState.SHOWING_TIME_SLOTS;
    await BookingStateManager.updateState(botId, customerPhone, state);

    await this.showAvailableTimeSlots(adapter, state);
  }

  /**
   * Show available time slots
   */
  private static async showAvailableTimeSlots(
    adapter: MessagingAdapter,
    state: ConversationState
  ): Promise<void> {
    const botId = adapter.getBotId();
    const businessId = adapter.getBusinessId();
    const customerPhone = adapter.getUserKey();

    const bookingDate = new Date(state.collectedData.bookingDate!);
    const dayOfWeek = bookingDate.getDay();

    logger.info({
      businessId,
      bookingDate: state.collectedData.bookingDate,
      dayOfWeek,
      dayName: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][dayOfWeek],
    }, 'Fetching time slots');

    // Get available slots from database function
    const { data: slots, error } = await supabaseAdmin.rpc('get_available_time_slots', {
      p_business_id: businessId,
      p_date: state.collectedData.bookingDate,
      p_day_of_week: dayOfWeek,
    });

    logger.info({
      businessId,
      slotsCount: slots?.length || 0,
      error: error ? JSON.stringify(error) : null,
    }, 'Time slots fetched');

    if (error || !slots || slots.length === 0) {
      logger.warn({
        businessId,
        bookingDate: state.collectedData.bookingDate,
        dayOfWeek,
        error: error ? JSON.stringify(error) : 'No slots returned',
      }, 'No time slots available');

      await this.sendMessage(adapter, '❌ Sorry, no time slots available for this date. Please select another date.');
      state.currentStep = BookingState.SHOWING_DATES;
      await BookingStateManager.updateState(botId, customerPhone, state);
      await this.showAvailableDates(adapter, state);
      return;
    }

    // Filter only available slots
    const availableSlots = slots.filter((slot: any) => slot.is_available);

    if (availableSlots.length === 0) {
      await this.sendMessage(adapter, '❌ Sorry, all slots are booked for this date. Please select another date.');
      state.currentStep = BookingState.SHOWING_DATES;
      await BookingStateManager.updateState(botId, customerPhone, state);
      await this.showAvailableDates(adapter, state);
      return;
    }

    const dateLabel = bookingDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    let message = `Available time slots for ${dateLabel}: ⏰\n\n`;

    availableSlots.forEach((slot: any, index: number) => {
      const time = slot.slot_time.substring(0, 5); // HH:MM
      const hour = parseInt(time.split(':')[0]);
      const ampm = hour >= 12 ? 'PM' : 'AM';
      const displayHour = hour > 12 ? hour - 12 : hour === 0 ? 12 : hour;
      const displayTime = `${displayHour}:${time.split(':')[1]} ${ampm}`;
      message += `${index + 1}️⃣ ${displayTime}\n`;
    });

    message += '\nReply with the number:';

    state.currentStep = BookingState.COLLECTING_TIME;
    await BookingStateManager.updateState(botId, customerPhone, state);
    await this.sendMessage(adapter, message);
  }

  /**
   * Handle time selection
   */
  private static async handleTimeInput(
    adapter: MessagingAdapter,
    message: string,
    state: ConversationState
  ): Promise<void> {
    const botId = adapter.getBotId();
    const businessId = adapter.getBusinessId();
    const customerPhone = adapter.getUserKey();

    const input = message.trim();

    // Get available slots again
    const bookingDate = new Date(state.collectedData.bookingDate!);
    const dayOfWeek = bookingDate.getDay();

    const { data: slots, error } = await supabaseAdmin.rpc('get_available_time_slots', {
      p_business_id: businessId,
      p_date: state.collectedData.bookingDate,
      p_day_of_week: dayOfWeek,
    });

    if (error || !slots) {
      await this.sendMessage(adapter, '❌ Error fetching time slots. Please try again.');
      return;
    }

    const availableSlots = slots.filter((slot: any) => slot.is_available);
    let selectedTime: string | null = null;

    // Handle number selection
    if (/^\d+$/.test(input)) {
      const index = parseInt(input) - 1;
      if (index >= 0 && index < availableSlots.length) {
        selectedTime = availableSlots[index].slot_time.substring(0, 5); // HH:MM
      }
    }

    if (!selectedTime) {
      await this.sendMessage(adapter, '❌ Invalid time slot. Please select from the list by number:');
      return;
    }

    state.collectedData.bookingTime = selectedTime;
    state.currentStep = BookingState.CONFIRMING;
    await BookingStateManager.updateState(botId, customerPhone, state);

    await this.showConfirmation(adapter, state);
  }

  /**
   * Show booking confirmation
   */
  private static async showConfirmation(
    adapter: MessagingAdapter,
    state: ConversationState
  ): Promise<void> {
    const data = state.collectedData;
    const bookingDate = new Date(data.bookingDate!);
    const dateLabel = bookingDate.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    });

    // Format time
    const time = data.bookingTime!;
    const hour = parseInt(time.split(':')[0]);
    const ampm = hour >= 12 ? 'PM' : 'AM';
    const displayHour = hour > 12 ? hour - 12 : hour === 0 ? 12 : hour;
    const displayTime = `${displayHour}:${time.split(':')[1]} ${ampm}`;

    const message = `Perfect! Let me confirm your booking:\n\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `📅 Booking Details\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `👤 Name: ${data.customerName}\n` +
      `👥 For: ${data.bookingFor}\n` +
      (data.gender ? `⚧ Gender: ${data.gender}\n` : '') +
      `💇 Service: ${data.serviceName}\n` +
      `📅 Date: ${dateLabel}\n` +
      `⏰ Time: ${displayTime}\n` +
      (data.servicePrice ? `💰 Price: ₹${data.servicePrice}\n` : '') +
      `━━━━━━━━━━━━━━━━━━━━\n\n` +
      `Reply *CONFIRM* to book or *CANCEL* to start over.`;

    await this.sendMessage(adapter, message);
  }

  /**
   * Handle confirmation
   */
  private static async handleConfirmation(
    adapter: MessagingAdapter,
    message: string,
    state: ConversationState
  ): Promise<void> {
    const botId = adapter.getBotId();
    const businessId = adapter.getBusinessId();
    const customerPhone = adapter.getUserKey();

    const validation = BookingValidator.validateConfirmation(message);

    if (!validation.valid) {
      await this.sendMessage(adapter, `❌ ${validation.error}`);
      return;
    }

    if (!validation.value) {
      // User cancelled
      await this.handleCancel(adapter);
      return;
    }

    // Create booking using safe function (prevents double booking)
    const data = state.collectedData;

    const { data: result, error } = await supabaseAdmin.rpc('create_booking_safe', {
      p_business_id: businessId,
      p_bot_id: botId,
      p_customer_name: data.customerName!,
      p_customer_phone: customerPhone,
      p_booking_for: data.bookingFor || 'self',
      p_gender: data.gender || 'not specified',
      p_service_id: data.serviceId,
      p_service_name: data.serviceName!,
      p_service_price: data.servicePrice || 0,
      p_booking_date: data.bookingDate!,
      p_booking_time: data.bookingTime!,
      p_duration: data.serviceDuration || 30,
      p_notes: null,
    });

    if (error || !result || result.length === 0) {
      logger.error({ err: error ? JSON.stringify(error) : 'No result' }, 'Error calling create_booking_safe');
      await this.sendMessage(adapter, '❌ Sorry, there was an error creating your booking. Please try again or contact us directly.');
      return;
    }

    const bookingResult = result[0];

    if (!bookingResult.success) {
      // Slot was taken by someone else (race condition)
      logger.warn({
        businessId,
        bookingDate: data.bookingDate,
        bookingTime: data.bookingTime,
        error: bookingResult.error_message
      }, 'Booking slot no longer available');

      await this.sendMessage(adapter, `❌ ${bookingResult.error_message}\n\nLet me show you the available slots again...`);

      // Go back to showing time slots
      state.currentStep = BookingState.SHOWING_TIME_SLOTS;
      await BookingStateManager.updateState(botId, customerPhone, state);
      await this.showAvailableTimeSlots(adapter, state);
      return;
    }

    const createdBookingId = bookingResult.booking_id;

    // Complete conversation
    await BookingStateManager.completeConversation(botId, customerPhone);

    // Get confirmation message from settings
    const { data: settings } = await supabaseAdmin
      .from('bot_settings')
      .select('booking_confirmation_message')
      .eq('bot_id', botId)
      .single();

    const confirmationMsg = (settings as any)?.booking_confirmation_message ||
      'Your booking has been confirmed! We look forward to seeing you.';

    const bookingId = createdBookingId.substring(0, 8).toUpperCase();
    const successMessage = `✅ Booking confirmed!\n\n` +
      `Booking ID: #${bookingId}\n\n` +
      `${confirmationMsg}\n\n` +
      `We'll send you a reminder before your appointment. 📲`;

    await this.sendMessage(adapter, successMessage);

    logger.info({
      botId,
      businessId,
      customerPhone,
      bookingId: createdBookingId
    }, 'Booking created successfully');
  }
}

