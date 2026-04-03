export interface Shrimp {
  id: string;
  name: string;
  personality: string[];
  interests: string[];
  boundaries: string;
  chat_style: string;
  social_goal: string;
  gender: string;
  age: number;
  mbti: string;
  bio: string;
  status: string;
  recent_goal: string;
  location_lat: number;
  location_lng: number;
  auto_chat: boolean;
  heartbeat_min: number;
  avatar_emoji: string;
  preferred_model: string;
  created_at: string;
  is_bot?: boolean;
}

export interface ShrimpDiscovery extends Shrimp {
  distance: number;
  interest_score: number;
  match_score: number;
}

export interface Conversation {
  id: string;
  shrimp_a_id: string;
  shrimp_b_id: string;
  affinity_a: number;
  affinity_b: number;
  status: string;
  topic: string;
  muted_by: string[];
  created_at: string;
  shrimp_a?: Shrimp;
  shrimp_b?: Shrimp;
  last_message?: Message | null;
}

export interface Message {
  id: string;
  conversation_id: string;
  sender_id: string;
  content: string;
  sender_type: 'agent' | 'human' | 'instruction';
  model_used?: string;
  created_at: string;
}

export interface TokenResponse {
  access_token: string;
  token_type: string;
  user_id: string;
  shrimp_id: string;
  username: string;
}

export interface HeartbeatLog {
  id: string;
  shrimp_id: string;
  log_type: 'chat' | 'discovery' | 'global_match' | 'bottle_write' | 'bottle_pickup';
  summary: string;
  details: string;  // JSON string
  created_at: string;
}

export interface Invitation {
  id: string;
  conversation_id: string;
  sender_id: string;
  receiver_id: string;
  content: string;
  handoff_type: string;
  draft_reply: string | null;
  status: 'pending' | 'accepted' | 'declined';
  created_at: string;
  resolved_at: string | null;
}

export interface ScheduleItem extends Invitation {
  sender_name: string;
  sender_emoji: string;
  receiver_name: string;
  receiver_emoji: string;
}

export interface QuestionnaireQuestion {
  id: string;
  text: string;
  category: string;
}

export interface QuestionnaireAnswer {
  question_id: string;
  question: string;
  answer: string;
}

export interface DriftBottle {
  id: string;
  author_id: string;
  content: string;
  mood: string;
  status: 'floating' | 'picked_up' | 'replied' | 'expired';
  pickup_count: number;
  max_pickups: number;
  picked_by_id: string | null;
  conversation_id: string | null;
  expires_at: string;
  created_at: string;
  author_name?: string;
  author_emoji?: string;
}
