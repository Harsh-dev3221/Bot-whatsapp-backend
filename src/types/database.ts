// Database types for Supabase tables

export interface Business {
  id: string;
  name: string;
  email: string;
  phone: string;
  subscription_status: 'trial' | 'active' | 'inactive' | 'cancelled';
  subscription_plan: 'free' | 'basic' | 'pro' | 'enterprise';
  trial_ends_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface Bot {
  id: string;
  business_id: string;
  name: string;
  phone_number: string;
  status: 'disconnected' | 'connecting' | 'connected' | 'failed';
  qr_code: string | null;
  last_connected_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface BotSession {
  id: string;
  bot_id: string;
  session_data: any; // Encrypted Baileys session data
  created_at: string;
  updated_at: string;
}

export interface BotSettings {
  id: string;
  bot_id: string;
  greeting_message: string | null;
  auto_reply_enabled: boolean;
  auto_reply_message: string | null;
  business_hours_enabled: boolean;
  business_hours_start: string | null;
  business_hours_end: string | null;
  created_at: string;
  updated_at: string;
}

export interface Message {
  id: string;
  bot_id: string;
  business_id: string;
  from_number: string;
  to_number: string;
  message_type: 'text' | 'image' | 'video' | 'audio' | 'document';
  content: string;
  media_url: string | null;
  direction: 'inbound' | 'outbound';
  status: 'sent' | 'delivered' | 'read' | 'failed';
  channel: 'whatsapp' | 'web';
  session_id: string | null;
  origin_url: string | null;
  user_agent: string | null;
  metadata: Record<string, any> | null;
  created_at: string;
}

export interface User {
  id: string;
  business_id: string;
  email: string;
  password_hash: string;
  role: 'admin' | 'user';
  created_at: string;
  updated_at: string;
}

export interface BotCredentials {
  id: string;
  bot_id: string;
  password_hash: string;
  default_password: string | null;
  password_changed: boolean;
  last_login_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface Booking {
  id: string;
  business_id: string;
  bot_id: string;
  customer_name: string;
  customer_phone: string;
  booking_for: string | null;
  gender: string | null;
  service_id: string | null;
  service_name: string;
  service_price: number | null;
  booking_date: string;
  booking_time: string;
  duration: number;
  status: 'pending' | 'confirmed' | 'cancelled' | 'completed' | 'no_show';
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface BotWidgetSettings {
  id: string;
  bot_id: string;
  enabled: boolean;
  widget_token: string; // Plain text token (like API keys)
  allowed_origins: string[];
  theme: {
    primaryColor?: string;
    position?: 'bottom-right' | 'bottom-left' | 'top-right' | 'top-left';
    avatarUrl?: string | null;
    bubbleText?: string;
  };
  greeting: string | null;
  rate_limits: {
    sessionPerMin?: number;
    messagePerMin?: number;
  };
  token_version: number;
  rotated_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface WebSession {
  id: string;
  bot_id: string;
  origin: string;
  origin_url: string | null;
  user_agent: string | null;
  metadata: Record<string, any>;
  status: 'active' | 'ended';
  last_seen_at: string;
  expires_at: string | null;
  created_at: string;
}

// Database schema for Supabase
export interface Database {
  public: {
    Tables: {
      businesses: {
        Row: Business;
        Insert: Omit<Business, 'id' | 'created_at' | 'updated_at'>;
        Update: Partial<Omit<Business, 'id' | 'created_at' | 'updated_at'>>;
      };
      bots: {
        Row: Bot;
        Insert: Omit<Bot, 'id' | 'created_at' | 'updated_at'>;
        Update: Partial<Omit<Bot, 'id' | 'created_at' | 'updated_at'>>;
      };
      bot_sessions: {
        Row: BotSession;
        Insert: Omit<BotSession, 'id' | 'created_at' | 'updated_at'>;
        Update: Partial<Omit<BotSession, 'id' | 'created_at' | 'updated_at'>>;
      };
      bot_settings: {
        Row: BotSettings;
        Insert: Omit<BotSettings, 'id' | 'created_at' | 'updated_at'>;
        Update: Partial<Omit<BotSettings, 'id' | 'created_at' | 'updated_at'>>;
      };
      bot_widget_settings: {
        Row: BotWidgetSettings;
        Insert: Omit<BotWidgetSettings, 'id' | 'created_at' | 'updated_at'>;
        Update: Partial<Omit<BotWidgetSettings, 'id' | 'created_at' | 'updated_at'>>;
      };
      web_sessions: {
        Row: WebSession;
        Insert: Omit<WebSession, 'id' | 'created_at'>;
        Update: Partial<Omit<WebSession, 'id' | 'created_at'>>;
      };
      messages: {
        Row: Message;
        Insert: Omit<Message, 'id' | 'created_at'>;
        Update: Partial<Omit<Message, 'id' | 'created_at'>>;
      };
      users: {
        Row: User;
        Insert: Omit<User, 'id' | 'created_at' | 'updated_at'>;
        Update: Partial<Omit<User, 'id' | 'created_at' | 'updated_at'>>;
      };
    };
  };
}

