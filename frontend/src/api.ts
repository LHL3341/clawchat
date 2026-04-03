import type { Shrimp, ShrimpDiscovery, Conversation, Message, TokenResponse, HeartbeatLog, Invitation, ScheduleItem, DriftBottle } from './types';

const BASE = '';

function getToken(): string | null {
  return localStorage.getItem('jwt_token');
}

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const token = getToken();
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  const res = await fetch(BASE + url, { headers, ...options });
  if (res.status === 401) {
    // Token expired or invalid — redirect to login
    localStorage.removeItem('jwt_token');
    localStorage.removeItem('my_shrimp_id');
    window.location.href = '/login';
    throw new Error('Unauthorized');
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const detail = body.detail;
    const msg = typeof detail === 'string' ? detail : Array.isArray(detail) ? detail.map((d: any) => d.msg || d).join('; ') : `${res.status} ${res.statusText}`;
    throw new Error(msg);
  }
  return res.json();
}

export const api = {
  // Auth
  register: (data: { username: string; password: string; invite_code: string; shrimp_name: string; avatar_emoji?: string; gender?: string }) =>
    request<TokenResponse>('/api/auth/register', { method: 'POST', body: JSON.stringify(data) }),
  login: (username: string, password: string) =>
    request<TokenResponse>('/api/auth/login', { method: 'POST', body: JSON.stringify({ username, password }) }),
  getMe: () => request<{ user_id: string; username: string; shrimp_id: string; is_admin: boolean; shrimp: Shrimp | null }>('/api/auth/me'),

  // Shrimp
  createShrimp: (data: Partial<Shrimp>) =>
    request<Shrimp>('/api/shrimps/', { method: 'POST', body: JSON.stringify(data) }),
  listShrimps: () => request<Shrimp[]>('/api/shrimps/'),
  getShrimp: (id: string) => request<Shrimp>(`/api/shrimps/${id}`),
  updateShrimp: (id: string, data: Partial<Shrimp>) =>
    request<Shrimp>(`/api/shrimps/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  autoLocate: (id: string) =>
    request<Shrimp>(`/api/shrimps/${id}/auto-locate`, { method: 'POST' }),
  deleteShrimp: (id: string) =>
    request<{ ok: boolean }>(`/api/shrimps/${id}`, { method: 'DELETE' }),

  // Discovery
  discover: (shrimpId: string, maxDistance = 10) =>
    request<ShrimpDiscovery[]>(`/api/discovery/nearby/${shrimpId}?max_distance=${maxDistance}`),

  // Chat
  startConversation: (shrimpAId: string, shrimpBId: string) =>
    request<Conversation>('/api/chat/conversations', {
      method: 'POST',
      body: JSON.stringify({ shrimp_a_id: shrimpAId, shrimp_b_id: shrimpBId }),
    }),
  listConversations: (shrimpId: string) =>
    request<Conversation[]>(`/api/chat/conversations/${shrimpId}`),
  getMessages: (convId: string) => request<Message[]>(`/api/chat/messages/${convId}`),
  sendMessage: (convId: string, senderId: string, content: string, senderType = 'human') =>
    request<Message>(`/api/chat/send/${convId}?sender_id=${senderId}`, {
      method: 'POST',
      body: JSON.stringify({ content, sender_type: senderType }),
    }),
  triggerAgentReply: (convId: string, responderId?: string) =>
    request<Message>(`/api/chat/agent-reply/${convId}${responderId ? `?responder_id=${responderId}` : ''}`, {
      method: 'POST',
    }),

  // Heartbeats
  chatHeartbeat: (shrimpId: string) =>
    request<{ ok: boolean; sent: number }>(`/api/discovery/trigger-heartbeat?shrimp_id=${shrimpId}`, { method: 'POST' }),
  discoverHeartbeat: (shrimpId: string, maxDistance = 50) =>
    request<{ ok: boolean; started: Array<{ id: string; name: string; reason: string; conv_id: string }> }>(
      `/api/discovery/discover-heartbeat?shrimp_id=${shrimpId}&max_distance=${maxDistance}`, { method: 'POST' }
    ),

  // Unread
  getUnreadCounts: (shrimpId: string) =>
    request<Record<string, number>>(`/api/chat/unread/${shrimpId}`),
  markRead: (convId: string, shrimpId: string) =>
    request<{ ok: boolean }>(`/api/chat/mark-read/${convId}?shrimp_id=${shrimpId}`, { method: 'POST' }),

  // Affinity
  affinityRanking: (shrimpId: string) =>
    request<Conversation[]>(`/api/affinity/ranking/${shrimpId}`),

  // Heartbeat Logs
  getHeartbeatLogs: (shrimpId: string, limit = 20) =>
    request<HeartbeatLog[]>(`/api/discovery/heartbeat-logs?shrimp_id=${shrimpId}&limit=${limit}`),

  // Invitations
  createInvitation: (convId: string, senderId: string, content: string) =>
    request<Invitation>(`/api/chat/conversations/${convId}/invite?sender_id=${senderId}`, {
      method: 'POST',
      body: JSON.stringify({ content }),
    }),
  getPendingInvitations: (shrimpId: string) =>
    request<Invitation[]>(`/api/chat/invitations/pending?shrimp_id=${shrimpId}`),
  getConversationInvitations: (convId: string) =>
    request<Invitation[]>(`/api/chat/conversations/${convId}/invitations`),
  acceptInvitation: (invId: string, reply?: string) =>
    request<Invitation>(`/api/chat/invitations/${invId}/accept`, {
      method: 'PATCH',
      body: JSON.stringify({ reply: reply || '' }),
    }),
  declineInvitation: (invId: string) =>
    request<Invitation>(`/api/chat/invitations/${invId}/decline`, { method: 'PATCH' }),
  getSchedule: (shrimpId: string) =>
    request<ScheduleItem[]>(`/api/chat/invitations/schedule?shrimp_id=${shrimpId}`),

  // Config
  getModel: () => request<{ model: string }>('/api/config/model'),
  setModel: (model: string) =>
    request<{ model: string }>('/api/config/model', {
      method: 'PUT',
      body: JSON.stringify({ model }),
    }),

  // Questionnaire
  questionnaireStatus: () =>
    request<{ needed: boolean; last_filled_at: string | null }>('/api/questionnaire/status'),
  questionnaireGenerate: () =>
    request<{ questions: import('./types').QuestionnaireQuestion[] }>('/api/questionnaire/generate', { method: 'POST' }),
  questionnaireSubmit: (answers: import('./types').QuestionnaireAnswer[]) =>
    request<{ ok: boolean; summary: string }>('/api/questionnaire/submit', {
      method: 'POST',
      body: JSON.stringify({ answers }),
    }),
  getHostKnowledge: () =>
    request<{ content: Record<string, unknown> }>('/api/questionnaire/knowledge'),
  getFriendMemories: () =>
    request<{ memories: Array<{ target_id: string; target_name: string; target_emoji: string; content: Record<string, unknown>; updated_at: string | null }> }>('/api/questionnaire/friend-memories'),

  // Memory Import
  importMemory: (format: string, data: string, mergeStrategy = 'append') =>
    request<{ ok: boolean; imported_fields: string[]; summary: string }>('/api/import/memory', {
      method: 'POST',
      body: JSON.stringify({ format, data, merge_strategy: mergeStrategy }),
    }),
  getImportGuide: () =>
    request<{ guide: string }>('/api/import/guide'),

  // Mute / Unmute conversation
  muteConversation: (convId: string, shrimpId: string) =>
    request<{ ok: boolean; muted_by: string[] }>(`/api/chat/conversations/${convId}/mute?shrimp_id=${shrimpId}`, { method: 'POST' }),
  unmuteConversation: (convId: string, shrimpId: string) =>
    request<{ ok: boolean; muted_by: string[] }>(`/api/chat/conversations/${convId}/unmute?shrimp_id=${shrimpId}`, { method: 'POST' }),

  // Polish & Suggest
  polishMessage: (convId: string, senderId: string, content: string) =>
    request<{ polished: string; model: string }>(`/api/chat/polish/${convId}?sender_id=${senderId}`, {
      method: 'POST',
      body: JSON.stringify({ content }),
    }),
  suggestReplies: (convId: string, senderId: string) =>
    request<{ suggestions: string[]; model: string }>(`/api/chat/suggest/${convId}?sender_id=${senderId}`, {
      method: 'POST',
    }),

  // Global Matchmaking
  globalMatch: (shrimpId: string) =>
    request<{ ok: boolean; started: Array<{ id: string; name: string; reason: string; conv_id: string }> }>(
      `/api/discovery/global-match?shrimp_id=${shrimpId}`, { method: 'POST' }
    ),

  // Drift Bottles
  getPickedBottles: (shrimpId: string) =>
    request<DriftBottle[]>(`/api/bottles/picked?shrimp_id=${shrimpId}`),
  getMyBottles: (shrimpId: string) =>
    request<DriftBottle[]>(`/api/bottles/my-bottles?shrimp_id=${shrimpId}`),
  replyToBottle: (bottleId: string, reply: string) =>
    request<{ ok: boolean; conv_id: string }>(`/api/bottles/reply/${bottleId}`, {
      method: 'POST', body: JSON.stringify({ reply }),
    }),
  throwBackBottle: (bottleId: string) =>
    request<{ ok: boolean }>(`/api/bottles/throw-back/${bottleId}`, { method: 'POST' }),
  writeBottle: (shrimpId: string, content: string, mood = '') =>
    request<DriftBottle>(`/api/bottles/write?shrimp_id=${shrimpId}`, {
      method: 'POST', body: JSON.stringify({ content, mood }),
    }),
};
