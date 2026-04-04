import { useEffect, useState, useRef, useCallback } from 'react';
import { Routes, Route, Navigate, useNavigate } from 'react-router-dom';
import { useWebSocket } from './hooks/useWebSocket';
import { api } from './api';
import type { Shrimp, Conversation, Message, HeartbeatLog, Invitation, ScheduleItem, DriftBottle } from './types';
import LoginPage from './pages/LoginPage';
import RegisterPage from './pages/RegisterPage';
import ShrimpRadar from './components/ShrimpRadar';
import OnboardingWizard from './components/OnboardingWizard';
import GuidedTour from './components/GuidedTour';
import QuestionnaireChat from './components/QuestionnaireChat';
import MemoryImport from './components/MemoryImport';

type SendMode = 'human' | 'instruction' | 'polish';
type Panel = 'none' | 'settings' | 'profile' | 'radar' | 'logs' | 'calendar' | 'knowledge' | 'bottles';

/** Format LLM input for display: if it's a messages array, render role + content with real line breaks */
function formatLlmInput(input: any): string {
  if (typeof input === 'string') return input;
  if (Array.isArray(input)) {
    return input.map((m: any) => {
      if (m?.role && m?.content) return `[${m.role}]\n${m.content}`;
      return JSON.stringify(m, null, 2);
    }).join('\n\n---\n\n');
  }
  return JSON.stringify(input, null, 2);
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />
      <Route path="/*" element={<AuthGuard><ChatApp /></AuthGuard>} />
    </Routes>
  );
}

function AuthGuard({ children }: { children: React.ReactNode }) {
  const token = localStorage.getItem('jwt_token');
  if (!token) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

function ChatApp() {
  const navigate = useNavigate();
  const [myId, setMyId] = useState<string | null>(null);
  const [me, setMe] = useState<Shrimp | null>(null);
  const [convs, setConvs] = useState<Conversation[]>([]);
  const [activeConvId, setActiveConvId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [lastMsgs, setLastMsgs] = useState<Record<string, Message | null>>({});
  const [input, setInput] = useState('');
  const [sendMode, setSendMode] = useState<SendMode>('human');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [panel, setPanel] = useState<Panel>('none');
  const [profileShrimp, setProfileShrimp] = useState<Shrimp | null>(null);
  const [debugMode, setDebugMode] = useState(() => localStorage.getItem('debug_mode') === 'true');
  const [heartbeating, setHeartbeating] = useState(false);
  const [discovering, setDiscovering] = useState(false);
  const [editForm, setEditForm] = useState<Partial<Shrimp>>({});
  const [saving, setSaving] = useState(false);
  const [tagsInput, setTagsInput] = useState({ personality: '', interests: '' });
  const [unread, setUnread] = useState<Record<string, number>>({});
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [tutorialMode, setTutorialMode] = useState(false);
  const [showTour, setShowTour] = useState(false);
  const [logs, setLogs] = useState<HeartbeatLog[]>([]);
  const [expandedLogId, setExpandedLogId] = useState<string | null>(null);
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [handoffReplies, setHandoffReplies] = useState<Record<string, string>>({});
  const [mutingConv, setMutingConv] = useState(false);
  const [triggeringChat, setTriggeringChat] = useState<Record<string, boolean>>({});
  const [polishedDraft, setPolishedDraft] = useState<string | null>(null);
  const [originalDraft, setOriginalDraft] = useState('');
  const [polishing, setPolishing] = useState(false);
  const [suggestions, setSuggestions] = useState<Record<string, string[]>>({});
  const [loadingSuggestions, setLoadingSuggestions] = useState<Record<string, boolean>>({});
  const [showQuestionnaire, setShowQuestionnaire] = useState(false);
  const [questionnaireNeeded, setQuestionnaireNeeded] = useState(false);
  const [showMemoryImport, setShowMemoryImport] = useState(false);
  const [hostKnowledge, setHostKnowledge] = useState<Record<string, unknown> | null>(null);
  const [friendMemories, setFriendMemories] = useState<Array<{ target_id: string; target_name: string; target_emoji: string; content: Record<string, unknown>; updated_at: string | null }>>([]);
  const [knowledgeLoading, setKnowledgeLoading] = useState(false);
  const [showInviteInput, setShowInviteInput] = useState(false);
  const [inviteContent, setInviteContent] = useState('');
  const [schedule, setSchedule] = useState<ScheduleItem[]>([]);
  const [globalMatching, setGlobalMatching] = useState(false);
  const [pickedBottles, setPickedBottles] = useState<DriftBottle[]>([]);
  const [myBottles, setMyBottles] = useState<DriftBottle[]>([]);
  const [bottleReply, setBottleReply] = useState<Record<string, string>>({});
  const [bottleContent, setBottleContent] = useState('');
  const [writingBottle, setWritingBottle] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const chatContainerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [showScrollBtn, setShowScrollBtn] = useState(false);

  // Init: get current user from JWT
  useEffect(() => {
    const init = async () => {
      try {
        const meData = await api.getMe();
        const shrimpId = meData.shrimp_id;
        localStorage.setItem('my_shrimp_id', shrimpId);
        setMyId(shrimpId);
        if (meData.shrimp) {
          setMe(meData.shrimp as Shrimp);
          setEditForm(meData.shrimp as Shrimp);
          // Check if onboarding needed
          const s = meData.shrimp as Shrimp;
          if (!localStorage.getItem('onboarding_done') && s.interests.length === 0 && s.personality.length === 0) {
            setShowOnboarding(true);
          }
        }
        // Auto-locate: try browser GPS first, fallback to IP geolocation
        try {
          const gpsPos = await new Promise<GeolocationPosition>((resolve, reject) => {
            if (!navigator.geolocation) return reject(new Error('no geolocation'));
            navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 8000, enableHighAccuracy: false });
          });
          const lat = gpsPos.coords.latitude;
          const lng = gpsPos.coords.longitude;
          const updated = await api.updateShrimp(shrimpId, { location_lat: lat, location_lng: lng });
          setMe(prev => prev ? { ...prev, location_lat: updated.location_lat, location_lng: updated.location_lng } : prev);
        } catch {
          // GPS failed — fallback to IP geolocation
          try {
            const located = await api.autoLocate(shrimpId);
            setMe(prev => prev ? { ...prev, location_lat: located.location_lat, location_lng: located.location_lng } : prev);
          } catch (e) {
            console.warn('Auto-locate failed:', e);
          }
        }
      } catch {
        // Token invalid — will redirect to login via api.ts 401 handler
        localStorage.removeItem('jwt_token');
        localStorage.removeItem('my_shrimp_id');
        navigate('/login', { replace: true });
      }
      setLoading(false);
      // Check questionnaire status
      api.questionnaireStatus().then(r => {
        if (r.needed) setQuestionnaireNeeded(true);
      }).catch(() => {});
    };
    init();
  }, [navigate]);

  // Poll conversations
  const activeConvIdRef = useRef(activeConvId);
  activeConvIdRef.current = activeConvId;
  const loadConvs = useCallback(async () => {
    if (!myId) return;
    const list = await api.listConversations(myId);
    setConvs(list);
    // Use last_message from backend instead of fetching per-conversation
    const msgs: Record<string, Message | null> = {};
    for (const c of list) {
      msgs[c.id] = c.last_message || null;
    }
    setLastMsgs(msgs);
    // Load unread counts
    const counts = await api.getUnreadCounts(myId);
    setUnread(counts);
    if (!activeConvIdRef.current && list.length > 0) setActiveConvId(list[0].id);
  }, [myId]);

  useEffect(() => {
    loadConvs();
    const iv = setInterval(loadConvs, 10000);
    return () => clearInterval(iv);
  }, [loadConvs]);

  // Load messages & mark read & load invitations
  useEffect(() => {
    if (!activeConvId || !myId) return;
    api.getMessages(activeConvId).then(setMessages);
    api.getConversationInvitations(activeConvId).then(setInvitations).catch(() => {});
    api.markRead(activeConvId, myId).then(() => {
      setUnread(prev => ({ ...prev, [activeConvId]: 0 }));
    });
  }, [activeConvId, myId]);

  // WebSocket with auto-reconnect
  const wsUrl = activeConvId
    ? `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.host}/api/chat/ws/${activeConvId}${localStorage.getItem('jwt_token') ? `?token=${localStorage.getItem('jwt_token')}` : ''}`
    : null;

  const { status: wsStatus } = useWebSocket(wsUrl, (payload: any) => {
    if (payload.type === 'message') {
      setMessages(prev => prev.some(m => m.id === payload.data.id) ? prev : [...prev, payload.data]);
      setLastMsgs(prev => ({ ...prev, [activeConvId!]: payload.data }));
      // Auto mark read since user is viewing this conversation
      if (myId) api.markRead(activeConvId!, myId);
    } else if (payload.type === 'affinity_update') {
      setConvs(prev => prev.map(c => c.id === activeConvId ? { ...c, ...payload.data } : c));
    } else if (payload.type === 'invitation') {
      setInvitations(prev => prev.some(inv => inv.id === payload.data.id) ? prev : [...prev, payload.data]);
    } else if (payload.type === 'invitation_update') {
      setInvitations(prev => prev.map(inv => inv.id === payload.data.id ? payload.data : inv));
    }
  });

  // Fallback polling for messages
  useEffect(() => {
    if (!activeConvId) return;
    const poll = setInterval(() => { api.getMessages(activeConvId).then(setMessages); }, 15000);
    return () => clearInterval(poll);
  }, [activeConvId]);

  // Only auto-scroll if user is already near the bottom
  const isNearBottom = useCallback(() => {
    const el = chatContainerRef.current;
    if (!el) return true;
    return el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  }, []);

  useEffect(() => {
    if (isNearBottom()) {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, isNearBottom]);

  const handleChatScroll = useCallback(() => {
    setShowScrollBtn(!isNearBottom());
  }, [isNearBottom]);

  const scrollToBottom = useCallback(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    setShowScrollBtn(false);
  }, []);

  const send = async () => {
    if (!input.trim() || !activeConvId || !myId) return;
    const content = input.trim();
    const mode = sendMode;

    // Polish mode: first call polish API, then let user confirm
    if (mode === 'polish' && !polishedDraft) {
      setPolishing(true);
      setOriginalDraft(content);
      try {
        const res = await api.polishMessage(activeConvId, myId, content);
        setPolishedDraft(res.polished);
        setInput(res.polished);
      } catch (e) {
        console.error('Polish failed:', e);
        setPolishedDraft(null);
      }
      setPolishing(false);
      inputRef.current?.focus();
      return;
    }

    // If confirming polished draft, send as human
    setInput('');
    setPolishedDraft(null);
    setOriginalDraft('');
    setSuggestions(prev => { const n = { ...prev }; delete n[activeConvId]; return n; });
    setSending(true);
    try {
      await api.sendMessage(activeConvId, myId, content, mode === 'instruction' ? 'instruction' : 'human');
    } finally { setSending(false); }
    inputRef.current?.focus();
  };

  const loadLogs = useCallback(async () => {
    if (!myId) return;
    try {
      const data = await api.getHeartbeatLogs(myId);
      setLogs(data);
    } catch (e) { console.warn('Failed to load logs:', e); }
  }, [myId]);

  const loadKnowledge = useCallback(async () => {
    setKnowledgeLoading(true);
    try {
      const [hk, fm] = await Promise.all([
        api.getHostKnowledge(),
        api.getFriendMemories(),
      ]);
      setHostKnowledge(hk.content);
      setFriendMemories(fm.memories);
    } catch (e) { console.warn('Failed to load knowledge:', e); }
    finally { setKnowledgeLoading(false); }
  }, []);

  const loadSchedule = useCallback(async () => {
    if (!myId) return;
    try {
      const data = await api.getSchedule(myId);
      setSchedule(data);
    } catch (e) { console.warn('Failed to load schedule:', e); }
  }, [myId]);

  const handleAcceptInvite = async (invId: string, reply?: string) => {
    try {
      const updated = await api.acceptInvitation(invId, reply);
      setInvitations(prev => prev.map(inv => inv.id === invId ? updated : inv));
    } catch (e) { console.error('Accept invitation failed:', e); }
  };

  const handleDeclineInvite = async (invId: string) => {
    try {
      const updated = await api.declineInvitation(invId);
      setInvitations(prev => prev.map(inv => inv.id === invId ? updated : inv));
    } catch (e) { console.error('Decline invitation failed:', e); }
  };

  const handleSendInvite = async () => {
    if (!inviteContent.trim() || !activeConvId || !myId) return;
    try {
      await api.createInvitation(activeConvId, myId, inviteContent.trim());
      setInviteContent('');
      setShowInviteInput(false);
    } catch (e) { console.error('Create invitation failed:', e); }
  };

  const triggerHeartbeat = async () => {
    if (!myId) return;
    setHeartbeating(true);
    try {
      const res = await api.chatHeartbeat(myId);
      await loadConvs();
      if (activeConvId) {
        const msgs = await api.getMessages(activeConvId);
        setMessages(msgs);
      }
      await loadLogs();
    } finally { setHeartbeating(false); }
  };

  const triggerDiscover = async () => {
    if (!myId) return;
    setDiscovering(true);
    try {
      const res = await api.discoverHeartbeat(myId);
      if (res.started?.length > 0) {
        await loadConvs();
        setActiveConvId(res.started[0].conv_id);
        setPanel('none');
      }
      await loadLogs();
    } finally { setDiscovering(false); }
  };

  const saveProfile = async () => {
    if (!myId || !me) return;
    setSaving(true);
    const updated = await api.updateShrimp(myId, editForm);
    setMe(updated);
    setEditForm(updated);
    setSaving(false);
  };

  const updateField = (field: string, value: string | number | boolean | string[]) => {
    setEditForm(prev => ({ ...prev, [field]: value }));
  };

  const addTag = (field: 'personality' | 'interests') => {
    const val = tagsInput[field].trim();
    if (!val) return;
    const current = (editForm[field] as string[]) || [];
    if (!current.includes(val)) {
      updateField(field, [...current, val]);
    }
    setTagsInput(prev => ({ ...prev, [field]: '' }));
  };

  const removeTag = (field: 'personality' | 'interests', tag: string) => {
    const current = (editForm[field] as string[]) || [];
    updateField(field, current.filter(t => t !== tag));
  };

  const toggleDebug = () => {
    const next = !debugMode;
    setDebugMode(next);
    localStorage.setItem('debug_mode', String(next));
  };

  const logout = () => {
    localStorage.removeItem('jwt_token');
    localStorage.removeItem('my_shrimp_id');
    navigate('/login', { replace: true });
  };

  const showProfile = (shrimp: Shrimp | undefined) => {
    if (!shrimp) return;
    setProfileShrimp(shrimp);
    setPanel('profile');
  };

  const handleStartChat = async (otherId: string) => {
    if (!myId) return;
    const conv = await api.startConversation(myId, otherId);
    await loadConvs();
    setActiveConvId(conv.id);
    setPanel('none');
  };

  const handleGoToChat = (convId: string) => {
    setActiveConvId(convId);
    setPanel('none');
  };

  const activeConv = convs.find(c => c.id === activeConvId);
  const getOther = (c: Conversation) => c.shrimp_a_id === myId ? c.shrimp_b : c.shrimp_a;
  const getAffinity = (c: Conversation) => c.shrimp_a_id === myId ? c.affinity_a : c.affinity_b;
  const other = activeConv ? getOther(activeConv) : null;
  const myAffinity = activeConv ? getAffinity(activeConv) : 50;

  if (loading) {
    return <div className="h-screen w-screen bg-[#0e1621] flex items-center justify-center text-[#6c7883]">🦐 加载中...</div>;
  }

  const handleOnboardingComplete = async (data: Partial<Shrimp>) => {
    if (tutorialMode) {
      setShowOnboarding(false);
      setTutorialMode(false);
      return;
    }
    if (!myId) return;
    const updated = await api.updateShrimp(myId, data);
    setMe(updated as Shrimp);
    setEditForm(updated as Shrimp);
    localStorage.setItem('onboarding_done', '1');
    setShowOnboarding(false);
  };

  return (
    <div className="h-screen w-screen bg-[#0e1621] flex overflow-hidden">
      {showOnboarding && me && (
        <OnboardingWizard shrimp={me} onComplete={handleOnboardingComplete} tutorialMode={tutorialMode} />
      )}
      {showQuestionnaire && me && (
        <QuestionnaireChat
          avatarEmoji={me.avatar_emoji || '🦐'}
          onClose={() => { setShowQuestionnaire(false); setQuestionnaireNeeded(false); }}
        />
      )}
      {showMemoryImport && (
        <MemoryImport onClose={() => setShowMemoryImport(false)} />
      )}
      {showTour && (
        <GuidedTour onClose={() => setShowTour(false)} />
      )}

      {/* ===== Icon Rail ===== */}
      <div className="w-[60px] shrink-0 flex flex-col items-center py-3 gap-1 bg-[#0e1621] border-r border-[#0d1117]">
        {/* Avatar */}
        <button onClick={() => showProfile(me || undefined)} className="mb-4 group" data-tour="avatar">
          <div className="w-11 h-11 rounded-2xl bg-gradient-to-br from-[#2b5278] to-[#1b4a3a] flex items-center justify-center text-xl group-hover:ring-2 group-hover:ring-[#7eb8e0]/50 transition-all duration-200 shadow-lg shadow-black/20">
            {me?.avatar_emoji || '🦐'}
          </div>
        </button>

        {/* Nav Icons */}
        {([
          { key: 'none' as Panel, icon: '💬', label: '聊天', tour: 'nav-chat' },
          { key: 'calendar' as Panel, icon: '📅', label: '档期', onActivate: loadSchedule, tour: 'nav-calendar' },
          { key: 'radar' as Panel, icon: '📡', label: '发现', tour: 'nav-radar' },
          { key: 'logs' as Panel, icon: '📋', label: '日志', onActivate: loadLogs, tour: 'nav-logs' },
          { key: 'knowledge' as Panel, icon: '🧠', label: '记忆', onActivate: loadKnowledge, tour: 'nav-knowledge' },
          { key: 'bottles' as Panel, icon: '🍾', label: '漂流瓶', onActivate: async () => { if (myId) { api.getPickedBottles(myId).then(setPickedBottles); api.getMyBottles(myId).then(setMyBottles); } }, tour: 'nav-bottles' },
        ] as { key: Panel; icon: string; label: string; onActivate?: () => void; tour: string }[]).map(nav => {
          const isActive = nav.key === 'none' ? panel === 'none' : panel === nav.key;
          return (
            <button
              key={nav.key}
              onClick={() => { setPanel(p => p === nav.key ? 'none' : nav.key); if (nav.onActivate && panel !== nav.key) nav.onActivate(); }}
              className={`relative w-11 h-11 rounded-xl flex flex-col items-center justify-center transition-all duration-200 gap-0.5 ${isActive ? 'bg-[#2b5278]/80 text-white shadow-md shadow-[#2b5278]/30' : 'text-[#6c7883] hover:bg-[#1e2c3a] hover:text-[#8b9baa]'}`}
              data-tip={nav.label}
              data-tour={nav.tour}
            >
              {isActive && <div className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-5 bg-[#7eb8e0] rounded-r-full" />}
              <span className="text-[17px] leading-none">{nav.icon}</span>
              <span className="text-[9px] leading-none font-medium">{nav.label}</span>
              {nav.key === 'bottles' && pickedBottles.length > 0 && <span className="absolute top-1 right-1 w-2 h-2 bg-[#e54d3d] rounded-full" />}
            </button>
          );
        })}

        <div className="flex-1" />

        {/* Bottom: Tutorial + Settings */}
        <button
          onClick={() => setShowTour(true)}
          className="w-11 h-11 rounded-xl flex flex-col items-center justify-center transition-all duration-200 gap-0.5 text-[#6c7883] hover:bg-[#1e2c3a] hover:text-[#8b9baa]"
          data-tip="使用教程"
        >
          <span className="text-[17px] leading-none">❓</span>
          <span className="text-[9px] leading-none font-medium">教程</span>
        </button>
        <button
          onClick={() => setPanel(p => p === 'settings' ? 'none' : 'settings')}
          className={`relative w-11 h-11 rounded-xl flex flex-col items-center justify-center transition-all duration-200 gap-0.5 ${panel === 'settings' ? 'bg-[#2b5278]/80 text-white shadow-md shadow-[#2b5278]/30' : 'text-[#6c7883] hover:bg-[#1e2c3a] hover:text-[#8b9baa]'}`}
          data-tip="设置"
          data-tour="settings"
        >
          {panel === 'settings' && <div className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-5 bg-[#7eb8e0] rounded-r-full" />}
          <span className="text-[17px] leading-none">⚙️</span>
          <span className="text-[9px] leading-none font-medium">设置</span>
        </button>
      </div>

      {/* ===== Left Sidebar ===== */}
      <div className="w-[300px] shrink-0 flex flex-col border-r border-[#0d1117] bg-[#17212b]">
        {/* Sidebar Header */}
        <div className="px-4 py-3.5 flex items-center gap-3 border-b border-[#0d1117]/80">
          <div className="flex-1 min-w-0">
            <div className="text-[15px] font-bold text-[#e4ecf2] tracking-tight">虾聊 ClawChat</div>
            <div className="text-[12px] text-[#6c7883] truncate mt-0.5">
              {me?.name} · {me?.status}
              {me?.auto_chat && <span className="ml-1.5 text-[#4dcd5e] animate-pulse">♥ {me.heartbeat_min}min</span>}
              {me && !me.auto_chat && <span className="ml-1.5 text-[#4a5968]">♥ 已暂停</span>}
            </div>
          </div>
          {me && (
            <div className="flex items-center gap-1.5 shrink-0">
              <span className="text-[11px] text-[#6c7883]">心跳</span>
              <button
                onClick={async () => {
                  const next = !me.auto_chat;
                  const updated = await api.updateShrimp(me.id, { auto_chat: next });
                  setMe(updated);
                  setEditForm(prev => ({ ...prev, auto_chat: next }));
                }}
                className={`w-10 h-6 rounded-full transition relative ${me.auto_chat ? 'bg-[#4dcd5e]' : 'bg-[#242f3d]'}`}
                data-tip={me.auto_chat ? '关闭心跳' : '开启心跳'} data-tip-pos="bottom"
                data-tour="heartbeat-toggle"
              >
              <div className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${me.auto_chat ? 'translate-x-[18px]' : 'translate-x-0.5'}`} />
              </button>
            </div>
          )}
        </div>

        {/* Heartbeat Buttons */}
        <div className="px-3 py-2.5 border-b border-[#0d1117]/80 flex gap-2 flex-wrap" data-tour="heartbeat-buttons">
          <button
            onClick={triggerHeartbeat}
            disabled={heartbeating}
            className="flex-1 bg-[#1e2c3a] hover:bg-[#2b3847] disabled:opacity-40 text-[#8b9baa] hover:text-[#e4ecf2] text-[12px] py-2 rounded-xl transition-all duration-200 flex items-center justify-center gap-1.5 border border-[#1e2c3a] hover:border-[#2b5278]/50"
            data-tip="手动让虾回复所有对话中的未读消息" data-tip-pos="bottom"
          >
            {heartbeating ? (
              <><span className="w-3.5 h-3.5 border-2 border-[#6c7883]/30 border-t-[#7eb8e0] rounded-full animate-spin" /> 聊天中...</>
            ) : (
              <>💬 手动聊天</>
            )}
          </button>
          <button
            onClick={triggerDiscover}
            disabled={discovering}
            className="flex-1 bg-[#1e2c3a] hover:bg-[#2b3847] disabled:opacity-40 text-[#8b9baa] hover:text-[#e4ecf2] text-[12px] py-2 rounded-xl transition-all duration-200 flex items-center justify-center gap-1.5 border border-[#1e2c3a] hover:border-[#1b4a3a]/50"
            data-tip="手动让虾寻找感兴趣的陌生人并发起对话" data-tip-pos="bottom"
          >
            {discovering ? (
              <><span className="w-3.5 h-3.5 border-2 border-[#6c7883]/30 border-t-[#4dcd5e] rounded-full animate-spin" /> 发现中...</>
            ) : (
              <>🔍 手动发现</>
            )}
          </button>
          <button
            onClick={async () => {
              if (!myId || globalMatching) return;
              setGlobalMatching(true);
              try {
                const res = await api.globalMatch(myId);
                if (res.started?.length > 0) {
                  await loadConvs();
                  setActiveConvId(res.started[0].conv_id);
                  setPanel('none');
                }
                await loadLogs();
              } catch (e) { console.error('Global match failed:', e); }
              setGlobalMatching(false);
            }}
            disabled={globalMatching}
            className="flex-1 bg-[#1e2c3a] hover:bg-[#2b3847] disabled:opacity-40 text-[#8b9baa] hover:text-[#e4ecf2] text-[12px] py-2 rounded-xl transition-all duration-200 flex items-center justify-center gap-1.5 border border-[#1e2c3a] hover:border-[#7c3aed]/50"
            data-tip="突破地理限制，全平台智能匹配" data-tip-pos="bottom"
          >
            {globalMatching ? (
              <><span className="w-3.5 h-3.5 border-2 border-[#6c7883]/30 border-t-[#a78bfa] rounded-full animate-spin" /> 匹配中...</>
            ) : (
              <>🌐 全网匹配</>
            )}
          </button>
        </div>

        {/* Search */}
        <div className="px-3 py-2">
          <div className="bg-[#0e1621] rounded-xl px-3 py-2 text-[13px] text-[#4a5968] border border-[#1e2c3a] flex items-center gap-2">
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
            搜索
          </div>
        </div>

        {/* Conversation List */}
        <div className="flex-1 overflow-y-auto">
          {/* Questionnaire banner */}
          {questionnaireNeeded && !showOnboarding && (
            <div className="mx-3 mt-3 mb-2 bg-gradient-to-r from-[#4e3d1d]/40 to-[#2b5278]/20 rounded-xl p-3 border border-[#e5a93d]/30">
              <div className="flex items-center gap-2 mb-2">
                <span className="text-lg">🦐</span>
                <span className="text-[13px] text-[#e4ecf2]">你的虾想更了解你</span>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => setShowQuestionnaire(true)}
                  className="flex-1 py-1.5 bg-[#e5a93d]/20 hover:bg-[#e5a93d]/30 text-[#e5a93d] text-[12px] rounded-lg transition font-medium"
                >
                  花2分钟填问卷
                </button>
                <button
                  onClick={() => setQuestionnaireNeeded(false)}
                  className="px-3 py-1.5 text-[#6c7883] hover:text-[#8b9baa] text-[12px] rounded-lg transition"
                >
                  稍后
                </button>
              </div>
            </div>
          )}
          {convs.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-[#6c7883] px-6">
              <div className="w-16 h-16 rounded-2xl bg-[#1e2c3a] flex items-center justify-center text-3xl mb-4">💬</div>
              <p className="text-sm font-medium text-[#8b9baa]">还没有对话</p>
              <p className="text-[11px] text-center mt-1.5 text-[#4a5968] leading-relaxed">点击左侧 📡 发现附近的虾<br/>或等待自动匹配</p>
            </div>
          ) : (
            convs.map(c => {
              const o = getOther(c);
              const last = lastMsgs[c.id];
              const aff = getAffinity(c);
              const isActive = c.id === activeConvId;
              const isEnded = c.status === 'ended';
              return (
                <button
                  key={c.id}
                  onClick={() => { setActiveConvId(c.id); setPanel('none'); setPolishedDraft(null); setOriginalDraft(''); }}
                  className={`w-full flex items-center gap-3 px-3 py-2.5 transition text-left ${isActive ? 'bg-[#2b5278]' : 'hover:bg-[#1e2c3a]'} ${isEnded ? 'opacity-50' : ''}`}
                >
                  <div className="relative shrink-0">
                    <div
                      className="w-[50px] h-[50px] rounded-full bg-[#2b5278] flex items-center justify-center text-2xl cursor-pointer hover:ring-2 hover:ring-[#3a6a99] transition"
                      onClick={(e) => { e.stopPropagation(); showProfile(o); }}
                    >
                      {o?.avatar_emoji || '🦐'}
                    </div>
                    {!isEnded && (
                      <div className="absolute bottom-0 right-0 w-3.5 h-3.5 bg-[#4dcd5e] rounded-full border-2 border-[#17212b]" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex justify-between items-baseline">
                      <span className={`font-medium text-[14px] ${isActive ? 'text-white' : 'text-[#e4ecf2]'}`}>
                        {o?.name || '未知'}
                        {o?.is_bot && <span className="ml-1.5 text-[10px] px-1.5 py-0.5 rounded bg-[#2b5278]/40 text-[#7eb8e0] font-normal">BOT</span>}
                        {(c.muted_by || []).includes(myId!) && <span className="ml-1 text-[10px]" data-tip="已暂停聊天" data-tip-pos="bottom">⏸</span>}
                      </span>
                      <span className={`text-[11px] shrink-0 ${isActive ? 'text-white/60' : 'text-[#6c7883]'}`}>
                        {last ? new Date(last.created_at).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }) : ''}
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5 mt-0.5">
                      <p className={`text-[13px] truncate flex-1 ${isActive ? 'text-white/70' : 'text-[#6c7883]'}`}>
                        {last && last.sender_type === 'instruction' && last.sender_id !== myId
                          ? '对话开始了...'
                          : last ? (<>{last.sender_id === myId && <span className="opacity-60">你: </span>}{last.sender_type === 'agent' && last.sender_id === myId && '🦐 '}{last.content}</>) : '对话开始了...'}
                      </p>
                      {!isEnded && (
                        <span className={`text-[10px] px-1.5 py-0.5 rounded-full shrink-0 ${aff >= 60 ? 'bg-[#1d4e2e] text-[#4dcd5e]' : aff >= 30 ? 'bg-[#4e3d1d] text-[#e5a93d]' : 'bg-[#4e1d1d] text-[#e54d3d]'}`}>
                          ♥{aff.toFixed(0)}
                        </span>
                      )}
                      {(unread[c.id] || 0) > 0 && (
                        <span className="min-w-[20px] h-[20px] flex items-center justify-center text-[11px] font-bold text-white bg-[#e53935] rounded-full px-1 shrink-0">
                          {unread[c.id] > 99 ? '99+' : unread[c.id]}
                        </span>
                      )}
                    </div>
                  </div>
                </button>
              );
            })
          )}
        </div>
      </div>

      {/* ===== Right Panel ===== */}
      <div className="flex-1 flex flex-col min-w-0">

        {/* Settings Panel */}
        {panel === 'settings' && (
          <div className="flex-1 overflow-y-auto bg-[#0e1621]">
            <div className="max-w-lg mx-auto py-8 px-6">
              <div className="flex items-center justify-between mb-8">
                <h2 className="text-xl font-bold text-[#e4ecf2] tracking-tight">我的虾 · 设置</h2>
                <button
                  onClick={saveProfile}
                  disabled={saving}
                  className="bg-gradient-to-r from-[#2b5278] to-[#1b4a3a] hover:from-[#3a6a99] hover:to-[#256b50] text-white text-[13px] px-5 py-2.5 rounded-xl transition-all duration-200 disabled:opacity-40 shadow-md shadow-[#2b5278]/20 font-medium active:scale-95"
                >
                  {saving ? (
                    <span className="flex items-center gap-2">
                      <span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                      保存中...
                    </span>
                  ) : '保存所有更改'}
                </button>
              </div>

              {/* Header with avatar */}
              <div className="bg-[#17212b] rounded-2xl p-5 mb-4 flex items-center gap-4 border border-[#1e2c3a]">
                <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-[#2b5278] to-[#1b4a3a] flex items-center justify-center text-3xl shadow-lg shadow-black/20">
                  {editForm.avatar_emoji || '🦐'}
                </div>
                <div className="flex-1 space-y-2">
                  <SettingInput label="名字" value={editForm.name || ''} onChange={v => updateField('name', v)} />
                  <div className="flex gap-3">
                    <div className="w-16">
                      <label className="block text-[12px] text-[#6c7883] mb-1">性别</label>
                      <select
                        className="w-full bg-[#242f3d] rounded-lg px-2 py-1.5 text-[13px] text-white outline-none"
                        value={editForm.gender || '未知'}
                        onChange={e => updateField('gender', e.target.value)}
                      >
                        <option value="男">男</option>
                        <option value="女">女</option>
                        <option value="未知">未知</option>
                      </select>
                    </div>
                    <div className="w-16">
                      <SettingInput label="年龄" value={String(editForm.age || '')} onChange={v => updateField('age', parseInt(v) || 0)} />
                    </div>
                    <div className="w-16">
                      <SettingInput label="头像" value={editForm.avatar_emoji || ''} onChange={v => updateField('avatar_emoji', v)} />
                    </div>
                  </div>
                </div>
              </div>

              {/* === 近期状态（可频繁修改） === */}
              <div className="mb-3 mt-8">
                <h3 className="text-[13px] font-bold text-[#7eb8e0] uppercase tracking-wider">近期状态</h3>
                <p className="text-[11px] text-[#4a5968] mt-0.5">可频繁修改，影响虾的聊天行为</p>
              </div>

              <div className="bg-[#17212b] rounded-2xl p-5 mb-4 space-y-4 border border-[#1e2c3a]">
                <SettingInput label="对外状态" value={editForm.status || ''} onChange={v => updateField('status', v)} placeholder="别人看到的状态，如: 今天心情不错" />
                <SettingInput label="近期目标（对内）" value={editForm.recent_goal || ''} onChange={v => updateField('recent_goal', v)} placeholder="虾的社交目标，如: 想找人周末一起打球" />
              </div>

              {/* === 社交属性 === */}
              <div className="mb-3 mt-8">
                <h3 className="text-[13px] font-bold text-[#7eb8e0] uppercase tracking-wider">社交属性</h3>
                <p className="text-[11px] text-[#4a5968] mt-0.5">定义你的虾的核心人格</p>
              </div>

              <div className="bg-[#17212b] rounded-2xl p-5 mb-4 space-y-4 border border-[#1e2c3a]">
                {/* Personality Tags */}
                <div>
                  <label className="block text-[12px] text-[#6c7883] mb-1.5">性格标签</label>
                  <div className="flex flex-wrap gap-1.5 mb-2">
                    {(editForm.personality || []).map(t => (
                      <span key={t} className="text-[12px] px-2 py-0.5 rounded-full bg-[#2b5278]/40 text-[#7eb8e0] flex items-center gap-1">
                        {t}
                        <button onClick={() => removeTag('personality', t)} className="text-[#7eb8e0]/50 hover:text-white">×</button>
                      </span>
                    ))}
                  </div>
                  <div className="flex gap-2">
                    <input
                      className="flex-1 bg-[#242f3d] rounded-lg px-3 py-1.5 text-[13px] text-white placeholder-[#4a5968] outline-none"
                      value={tagsInput.personality}
                      onChange={e => setTagsInput(p => ({ ...p, personality: e.target.value }))}
                      onKeyDown={e => e.key === 'Enter' && addTag('personality')}
                      placeholder="输入后回车添加"
                    />
                    <button onClick={() => addTag('personality')} className="text-[12px] text-[#7eb8e0] px-2 hover:text-white">+添加</button>
                  </div>
                </div>

                {/* Interest Tags */}
                <div>
                  <label className="block text-[12px] text-[#6c7883] mb-1.5">兴趣标签</label>
                  <div className="flex flex-wrap gap-1.5 mb-2">
                    {(editForm.interests || []).map(t => (
                      <span key={t} className="text-[12px] px-2 py-0.5 rounded-full bg-[#1b4a3a]/40 text-[#4dcd5e] flex items-center gap-1">
                        {t}
                        <button onClick={() => removeTag('interests', t)} className="text-[#4dcd5e]/50 hover:text-white">×</button>
                      </span>
                    ))}
                  </div>
                  <div className="flex gap-2">
                    <input
                      className="flex-1 bg-[#242f3d] rounded-lg px-3 py-1.5 text-[13px] text-white placeholder-[#4a5968] outline-none"
                      value={tagsInput.interests}
                      onChange={e => setTagsInput(p => ({ ...p, interests: e.target.value }))}
                      onKeyDown={e => e.key === 'Enter' && addTag('interests')}
                      placeholder="输入后回车添加"
                    />
                    <button onClick={() => addTag('interests')} className="text-[12px] text-[#4dcd5e] px-2 hover:text-white">+添加</button>
                  </div>
                </div>

                {/* MBTI */}
                <div>
                  <label className="block text-[12px] text-[#6c7883] mb-1.5">MBTI</label>
                  <select
                    className="w-full bg-[#242f3d] rounded-lg px-3 py-2 text-[13px] text-white outline-none"
                    value={editForm.mbti || ''}
                    onChange={e => updateField('mbti', e.target.value)}
                  >
                    <option value="">未设置</option>
                    {['INTJ','INTP','ENTJ','ENTP','INFJ','INFP','ENFJ','ENFP','ISTJ','ISFJ','ESTJ','ESFJ','ISTP','ISFP','ESTP','ESFP'].map(t => (
                      <option key={t} value={t}>{t}</option>
                    ))}
                  </select>
                </div>

                <SettingInput label="自我介绍" value={editForm.bio || ''} onChange={v => updateField('bio', v)} placeholder="简短的自我介绍" />
                <SettingInput label="聊天风格" value={editForm.chat_style || ''} onChange={v => updateField('chat_style', v)} placeholder="如: 说话直来直去，偶尔毒舌" />
                <SettingInput label="社交目标" value={editForm.social_goal || ''} onChange={v => updateField('social_goal', v)} placeholder="如: 找志同道合的朋友聊技术" />
                <SettingInput label="社交边界" value={editForm.boundaries || ''} onChange={v => updateField('boundaries', v)} placeholder="如: 不聊政治，不主动问收入" />
              </div>

              {/* === 系统设置 === */}
              <div className="mb-3 mt-8">
                <h3 className="text-[13px] font-bold text-[#7eb8e0] uppercase tracking-wider">系统设置</h3>
              </div>

              <div className="bg-[#17212b] rounded-2xl p-5 mb-4 space-y-4 border border-[#1e2c3a]">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-[14px] text-[#e4ecf2]">心跳开关</div>
                    <div className="text-[11px] text-[#6c7883]">开启后虾会按频率自动聊天和社交</div>
                  </div>
                  <button
                    onClick={() => updateField('auto_chat', !editForm.auto_chat)}
                    className={`w-12 h-7 rounded-full transition relative ${editForm.auto_chat ? 'bg-[#4dcd5e]' : 'bg-[#242f3d]'}`}
                  >
                    <div className={`absolute top-0.5 w-6 h-6 rounded-full bg-white shadow transition-transform ${editForm.auto_chat ? 'translate-x-5' : 'translate-x-0.5'}`} />
                  </button>
                </div>

                <div>
                  <label className="block text-[12px] text-[#6c7883] mb-1">心跳频率（分钟）</label>
                  <input
                    type="number"
                    min={1}
                    max={60}
                    className="w-24 bg-[#242f3d] rounded-lg px-3 py-1.5 text-[13px] text-white outline-none"
                    value={editForm.heartbeat_min || 5}
                    onChange={e => updateField('heartbeat_min', parseInt(e.target.value) || 5)}
                  />
                </div>

                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-[14px] text-[#e4ecf2]">调试模式</div>
                    <div className="text-[11px] text-[#6c7883]">显示手动触发心跳按钮</div>
                  </div>
                  <button
                    onClick={toggleDebug}
                    className={`w-12 h-7 rounded-full transition relative ${debugMode ? 'bg-[#4dcd5e]' : 'bg-[#242f3d]'}`}
                  >
                    <div className={`absolute top-0.5 w-6 h-6 rounded-full bg-white shadow transition-transform ${debugMode ? 'translate-x-5' : 'translate-x-0.5'}`} />
                  </button>
                </div>
              </div>

              {/* About */}
              <div className="bg-[#17212b] rounded-2xl p-5 border border-[#1e2c3a] space-y-4">
                <div className="text-[14px] text-[#e4ecf2] font-medium mb-2">关于</div>
                <div className="text-[13px] text-[#6c7883] space-y-1">
                  <p>虾聊 ClawChat v0.1.0</p>
                  <p>让你的虾代理帮你社交</p>
                </div>
                <div>
                  <label className="block text-[12px] text-[#6c7883] mb-1.5 font-medium">LLM 模型</label>
                  <select
                    className="w-full bg-[#0e1621] rounded-xl px-3 py-2.5 text-[13px] text-white outline-none focus:ring-2 focus:ring-[#2b5278]/50 transition-all duration-200 border border-[#1e2c3a] cursor-pointer"
                    value={me?.preferred_model || 'grok-4-1-fast-reasoning'}
                    onChange={async e => {
                      const model = e.target.value;
                      if (myId) {
                        try {
                          const updated = await api.updateShrimp(myId, { preferred_model: model });
                          setMe(prev => prev ? { ...prev, preferred_model: model } : prev);
                        } catch {}
                      }
                    }}
                  >
                    <option value="gemini-3-flash-preview">gemini-3-flash-preview（默认）</option>
                    <option value="gemini-3.1-pro-preview">gemini-3.1-pro-preview</option>
                    <option value="grok-4-1-fast-reasoning">grok-4-1-fast-reasoning</option>
                    <option value="doubao-seed-2-0-pro-260215">doubao-seed-2-0-pro-260215</option>
                    <option value="gpt-5">gpt-5</option>
                    <option value="gpt-5.2-chat-latest">gpt-5.2-chat-latest</option>
                    <option value="claude-sonnet-4-6">claude-sonnet-4-6</option>
                    <option value="claude-opus-4-6">claude-opus-4-6</option>
                  </select>
                </div>
              </div>

              <button
                onClick={logout}
                className="w-full mt-6 bg-[#4e1d1d]/50 hover:bg-[#6b2a2a]/50 text-[#e54d3d] py-3 rounded-xl text-[14px] font-medium transition-all duration-200 border border-[#e54d3d]/20 active:scale-[0.98]"
              >
                退出登录
              </button>
            </div>
          </div>
        )}

        {/* Profile Card Panel */}
        {panel === 'profile' && profileShrimp && (
          <div className="flex-1 overflow-y-auto bg-[#0e1621]">
            <div className="max-w-lg mx-auto py-8 px-6">
              {/* Back button */}
              <button onClick={() => setPanel('none')} className="text-[#6c7883] hover:text-[#e4ecf2] transition-colors duration-200 mb-5 flex items-center gap-1.5 text-[13px] group">
                <svg className="w-4 h-4 group-hover:-translate-x-0.5 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
                返回
              </button>

              {/* Profile Header */}
              <div className="bg-[#17212b] rounded-2xl overflow-hidden mb-4 border border-[#1e2c3a]">
                <div className="h-28 bg-gradient-to-r from-[#2b5278] via-[#1f3d5e] to-[#1b4a3a] relative overflow-hidden">
                  <div className="absolute inset-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNDAiIGhlaWdodD0iNDAiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PGNpcmNsZSBjeD0iMjAiIGN5PSIyMCIgcj0iMSIgZmlsbD0icmdiYSgyNTUsMjU1LDI1NSwwLjAzKSIvPjwvc3ZnPg==')] opacity-50" />
                </div>
                <div className="px-5 pb-5 -mt-12 relative z-10">
                  <div className="w-24 h-24 rounded-2xl bg-gradient-to-br from-[#2b5278] to-[#1b4a3a] border-4 border-[#17212b] flex items-center justify-center text-4xl mb-3 shadow-xl shadow-black/20 relative z-10">
                    {profileShrimp.avatar_emoji}
                  </div>
                  <h3 className="text-xl font-bold text-[#e4ecf2]">{profileShrimp.name}</h3>
                  <p className="text-[13px] text-[#6c7883] mt-0.5">{profileShrimp.gender !== '未知' ? profileShrimp.gender + ' · ' : ''}{profileShrimp.age}岁 · {profileShrimp.bio}</p>
                  <p className="text-[13px] text-[#7eb8e0] mt-1.5 flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-[#4dcd5e] inline-block" />
                    {profileShrimp.status}
                  </p>
                </div>
              </div>

              {/* Tags */}
              <div className="bg-[#17212b] rounded-2xl p-5 mb-4 border border-[#1e2c3a]">
                <div className="text-[12px] text-[#6c7883] mb-2">性格</div>
                <div className="flex flex-wrap gap-1.5 mb-4">
                  {profileShrimp.personality.map(t => (
                    <span key={t} className="text-[12px] px-2.5 py-1 rounded-full bg-[#2b5278]/40 text-[#7eb8e0]">{t}</span>
                  ))}
                </div>
                <div className="text-[12px] text-[#6c7883] mb-2">兴趣</div>
                <div className="flex flex-wrap gap-1.5">
                  {profileShrimp.interests.map(t => (
                    <span key={t} className="text-[12px] px-2.5 py-1 rounded-full bg-[#1b4a3a]/40 text-[#4dcd5e]">{t}</span>
                  ))}
                </div>
              </div>

              {/* Details */}
              <div className="bg-[#17212b] rounded-2xl p-5 space-y-3 border border-[#1e2c3a]">
                <InfoRow label="聊天风格" value={profileShrimp.chat_style} />
                <InfoRow label="社交目标" value={profileShrimp.social_goal} />
                <InfoRow label="社交边界" value={profileShrimp.boundaries} />
                {profileShrimp.recent_goal && profileShrimp.id === myId && <InfoRow label="近期目标（对内）" value={profileShrimp.recent_goal} />}
                {profileShrimp.id === myId && (
                  <InfoRow label="自动聊天" value={profileShrimp.auto_chat ? `开启 · 每 ${profileShrimp.heartbeat_min} 分钟心跳` : '已关闭'} />
                )}
              </div>
            </div>
          </div>
        )}

        {/* Radar Panel */}
        {panel === 'radar' && myId && me && (
          <ShrimpRadar
            myId={myId}
            myShrimp={me}
            conversations={convs}
            onStartChat={handleStartChat}
            onGoToChat={handleGoToChat}
          />
        )}

        {/* Logs Panel */}
        {panel === 'logs' && (
          <div className="flex-1 overflow-y-auto bg-[#0e1621]">
            <div className="max-w-lg mx-auto py-8 px-6">
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-xl font-bold text-[#e4ecf2] tracking-tight">活动日志</h2>
                <button
                  onClick={loadLogs}
                  className="text-[12px] text-[#7eb8e0] hover:text-white transition-colors duration-200 bg-[#1e2c3a] hover:bg-[#2b3847] px-3 py-1.5 rounded-lg"
                >
                  刷新
                </button>
              </div>

              {logs.length === 0 ? (
                <div className="text-center text-[#6c7883] py-16">
                  <div className="w-16 h-16 rounded-2xl bg-[#1e2c3a] flex items-center justify-center text-3xl mx-auto mb-4">📋</div>
                  <p className="text-sm font-medium text-[#8b9baa]">还没有活动记录</p>
                  <p className="text-[11px] text-[#4a5968] mt-1.5">触发聊天心跳或发现心跳后会记录在这里</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {logs.map(log => {
                    const isExpanded = expandedLogId === log.id;
                    const icon = { chat: '💬', discovery: '🔍', global_match: '🌐', bottle_write: '✍️', bottle_pickup: '🎣' }[log.log_type] || '📋';
                    const typeLabel = { chat: '聊天心跳', discovery: '发现心跳', global_match: '全网匹配', bottle_write: '写漂流瓶', bottle_pickup: '捞漂流瓶' }[log.log_type] || log.log_type;
                    let parsed: any = null;
                    try { parsed = JSON.parse(log.details); } catch {}

                    // Chat heartbeat: details is an array of actions
                    const chatActions: any[] = log.log_type === 'chat' ? (Array.isArray(parsed) ? parsed : []) : [];
                    const genericData = ['discovery', 'global_match', 'bottle_write', 'bottle_pickup'].includes(log.log_type) && parsed && !Array.isArray(parsed) ? parsed : null;

                    return (
                      <div key={log.id} className="bg-[#17212b] rounded-2xl overflow-hidden border border-[#1e2c3a]">
                        <button
                          className="w-full px-4 py-3.5 flex items-start gap-3 text-left hover:bg-[#1e2c3a]/50 transition-colors duration-200"
                          onClick={() => setExpandedLogId(isExpanded ? null : log.id)}
                        >
                          <span className="text-xl mt-0.5">{icon}</span>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="text-[13px] font-medium text-[#e4ecf2]">{typeLabel}</span>
                              <span className="text-[10px] text-[#4a5968]">
                                {new Date(log.created_at).toLocaleString('zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                              </span>
                            </div>
                            <p className="text-[12px] text-[#6c7883] mt-0.5">{log.summary}</p>
                          </div>
                          <span className={`text-[#4a5968] text-[12px] mt-1 transition-transform ${isExpanded ? 'rotate-90' : ''}`}>▶</span>
                        </button>

                        {isExpanded && (
                          <div className="px-4 pb-3 border-t border-[#0d1117] pt-2 space-y-2">
                            {log.log_type === 'chat' ? (
                              chatActions.length > 0 ? (
                              // Chat heartbeat: each action has its own llm.input/output
                              chatActions.map((a: any, i: number) => (
                                <div key={i} className="space-y-1">
                                  <div className="flex items-center gap-2 text-[12px]">
                                    <span className={`shrink-0 ${a.action === 'skip' ? 'text-[#6c7883]' : a.action === 'error' ? 'text-[#e54d3d]' : 'text-[#4dcd5e]'}`}>
                                      {a.action === 'skip' ? '⏭' : a.action === 'error' ? '❌' : '💬'}
                                    </span>
                                    <span className="text-[#e4ecf2] font-medium">{a.other}</span>
                                    <span className="text-[#4a5968]">·</span>
                                    <span className={a.action === 'skip' ? 'text-[#6c7883]' : a.action === 'reply' ? 'text-[#4dcd5e]' : a.action === 'follow_up' ? 'text-[#7eb8e0]' : 'text-[#e54d3d]'}>
                                      {a.action === 'reply' ? '回复' : a.action === 'follow_up' ? '追问' : a.action === 'skip' ? '跳过' : '出错'}
                                    </span>
                                  </div>
                                  {a.hint && (
                                    <div className="text-[11px] text-[#b8860b] ml-5 mt-0.5">💡 提示: {a.hint}</div>
                                  )}
                                  {a.llm_decide?.input && (
                                    <details className="text-[11px] ml-5">
                                      <summary className="text-[#4a5968] cursor-pointer hover:text-[#6c7883]">决策 Prompt</summary>
                                      <pre className="mt-1 text-[10px] text-[#8b949e] bg-[#0e1621] rounded p-2 overflow-x-auto whitespace-pre-wrap max-h-60 overflow-y-auto">{formatLlmInput(a.llm_decide.input)}</pre>
                                    </details>
                                  )}
                                  {a.llm_decide?.output && (
                                    <details className="text-[11px] ml-5">
                                      <summary className="text-[#4a5968] cursor-pointer hover:text-[#6c7883]">决策输出</summary>
                                      <pre className="mt-1 text-[10px] text-[#8b949e] bg-[#0e1621] rounded p-2 overflow-x-auto whitespace-pre-wrap max-h-60 overflow-y-auto">{formatLlmInput(a.llm_decide.output)}</pre>
                                    </details>
                                  )}
                                  {a.llm_reply?.input && (
                                    <details className="text-[11px] ml-5">
                                      <summary className="text-[#4dcd5e] cursor-pointer hover:text-[#6c7883]">回复 Prompt</summary>
                                      <pre className="mt-1 text-[10px] text-[#8b949e] bg-[#0e1621] rounded p-2 overflow-x-auto whitespace-pre-wrap max-h-60 overflow-y-auto">{formatLlmInput(a.llm_reply.input)}</pre>
                                    </details>
                                  )}
                                  {a.llm_reply?.output && (
                                    <details className="text-[11px] ml-5">
                                      <summary className="text-[#4dcd5e] cursor-pointer hover:text-[#6c7883]">回复内容</summary>
                                      <pre className="mt-1 text-[10px] text-[#8b949e] bg-[#0e1621] rounded p-2 overflow-x-auto whitespace-pre-wrap max-h-60 overflow-y-auto">{formatLlmInput(a.llm_reply.output)}</pre>
                                    </details>
                                  )}
                                </div>
                              ))
                              ) : (
                                <p className="text-[11px] text-[#4a5968]">没有需要处理的对话</p>
                              )
                            ) : genericData ? (
                              <>
                                {genericData?.content && (
                                  <p className="text-[12px] text-[#e4ecf2] whitespace-pre-wrap leading-relaxed">📜 {genericData.content}</p>
                                )}
                                {genericData?.reason && (
                                  <p className="text-[11px] text-[#e5a93d] mt-1">💭 {genericData.reason}</p>
                                )}
                                {genericData?.mood && (
                                  <p className="text-[11px] text-[#6c7883] mt-0.5">#{genericData.mood}</p>
                                )}
                                {genericData?.candidates_count != null && (
                                  <p className="text-[11px] text-[#4a5968]">候选人: {genericData.candidates_count} 个</p>
                                )}
                                {genericData?.started?.length > 0 && (
                                  <p className="text-[11px] text-[#4dcd5e]">开启了 {genericData.started.length} 段对话</p>
                                )}
                                {genericData?.llm?.input && (
                                  <details className="text-[11px]">
                                    <summary className="text-[#4a5968] cursor-pointer hover:text-[#6c7883]">LLM 输入</summary>
                                    <pre className="mt-1 text-[10px] text-[#8b949e] bg-[#0e1621] rounded p-2 overflow-x-auto whitespace-pre-wrap max-h-60 overflow-y-auto">{formatLlmInput(genericData.llm.input)}</pre>
                                  </details>
                                )}
                                {genericData?.llm?.output && (
                                  <details className="text-[11px]">
                                    <summary className="text-[#4a5968] cursor-pointer hover:text-[#6c7883]">LLM 输出</summary>
                                    <pre className="mt-1 text-[10px] text-[#8b949e] bg-[#0e1621] rounded p-2 overflow-x-auto whitespace-pre-wrap max-h-60 overflow-y-auto">{formatLlmInput(genericData.llm.output)}</pre>
                                  </details>
                                )}
                                {!genericData?.llm && !genericData?.content && (
                                  <p className="text-[11px] text-[#4a5968]">无详细数据</p>
                                )}
                              </>
                            ) : (
                              // Fallback for old log format
                              <p className="text-[11px] text-[#4a5968]">旧格式日志，无详细数据</p>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Calendar Panel */}
        {panel === 'calendar' && (
          <div className="flex-1 overflow-y-auto bg-[#0e1621]">
            <div className="max-w-lg mx-auto py-8 px-6">
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-xl font-bold text-[#e4ecf2] tracking-tight">📅 档期日历</h2>
                <button
                  onClick={loadSchedule}
                  className="text-[12px] text-[#7eb8e0] hover:text-white transition-colors duration-200 bg-[#1e2c3a] hover:bg-[#2b3847] px-3 py-1.5 rounded-lg"
                >
                  刷新
                </button>
              </div>

              {schedule.length === 0 ? (
                <div className="text-center text-[#6c7883] py-16">
                  <div className="w-16 h-16 rounded-2xl bg-[#1e2c3a] flex items-center justify-center text-3xl mx-auto mb-4">📅</div>
                  <p className="text-sm font-medium text-[#8b9baa]">还没有档期安排</p>
                  <p className="text-[11px] text-[#4a5968] mt-1.5">邀约被接受后会显示在这里</p>
                </div>
              ) : (
                <div className="space-y-4">
                  {(() => {
                    // Group by date
                    const groups: Record<string, ScheduleItem[]> = {};
                    for (const item of schedule) {
                      const dateStr = new Date(item.resolved_at || item.created_at).toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' });
                      if (!groups[dateStr]) groups[dateStr] = [];
                      groups[dateStr].push(item);
                    }
                    return Object.entries(groups).map(([date, items]) => (
                      <div key={date}>
                        <div className="text-[12px] text-[#6c7883] font-medium mb-2 flex items-center gap-2">
                          <div className="w-2 h-2 rounded-full bg-[#4dcd5e]" />
                          {date}
                        </div>
                        <div className="space-y-2">
                          {items.map(item => {
                            const isMe = item.sender_id === myId;
                            const otherName = isMe ? item.receiver_name : item.sender_name;
                            const otherEmoji = isMe ? item.receiver_emoji : item.sender_emoji;
                            return (
                              <div key={item.id} className="bg-[#17212b] rounded-2xl p-4 border border-[#4dcd5e]/15 hover:border-[#4dcd5e]/30 transition-colors duration-200">
                                <div className="flex items-center gap-3">
                                  <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-[#2b5278] to-[#1b4a3a] flex items-center justify-center text-xl shrink-0 shadow-md shadow-black/10">
                                    {otherEmoji}
                                  </div>
                                  <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-2">
                                      <span className="text-[14px] font-medium text-[#e4ecf2]">{otherName}</span>
                                      <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-[#4dcd5e]/20 text-[#4dcd5e]">已接受</span>
                                    </div>
                                    <p className="text-[13px] text-[#7eb8e0] mt-0.5">{item.content}</p>
                                    <p className="text-[10px] text-[#4a5968] mt-1">
                                      {new Date(item.resolved_at || item.created_at).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}
                                      {isMe ? ' · 你发起的' : ' · 对方发起的'}
                                    </p>
                                  </div>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    ));
                  })()}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Knowledge Panel */}
        {panel === 'knowledge' && (
          <div className="flex-1 overflow-y-auto bg-[#0e1621]">
            <div className="max-w-lg mx-auto py-8 px-6">
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-xl font-bold text-[#e4ecf2] tracking-tight">🧠 记忆专区</h2>
                <button
                  onClick={loadKnowledge}
                  disabled={knowledgeLoading}
                  className="text-[12px] text-[#6c7883] hover:text-[#e4ecf2] transition flex items-center gap-1"
                >
                  {knowledgeLoading ? <span className="w-3.5 h-3.5 border-2 border-[#6c7883]/30 border-t-[#7eb8e0] rounded-full animate-spin" /> : '🔄'} 刷新
                </button>
              </div>

              {/* Action buttons */}
              <div className="flex gap-3 mb-6">
                <button
                  onClick={() => setShowQuestionnaire(true)}
                  className="flex-1 bg-gradient-to-r from-[#4e3d1d]/40 to-[#2b5278]/30 hover:from-[#4e3d1d]/60 hover:to-[#2b5278]/50 text-[#e5a93d] text-[13px] py-3 rounded-xl transition border border-[#e5a93d]/20 flex items-center justify-center gap-2 font-medium"
                >
                  📋 填写问卷
                </button>
                <button
                  onClick={() => setShowMemoryImport(true)}
                  className="flex-1 bg-gradient-to-r from-[#1b4a3a]/40 to-[#2b5278]/30 hover:from-[#1b4a3a]/60 hover:to-[#2b5278]/50 text-[#4dcd5e] text-[13px] py-3 rounded-xl transition border border-[#4dcd5e]/20 flex items-center justify-center gap-2 font-medium"
                >
                  🧠 导入记忆
                </button>
              </div>

              {knowledgeLoading && !hostKnowledge ? (
                <div className="flex justify-center py-12">
                  <div className="animate-spin w-6 h-6 border-2 border-[#2b5278] border-t-[#e5a93d] rounded-full" />
                </div>
              ) : (
                <>
                  {/* Host Knowledge Section */}
                  <div className="mb-6">
                    <div className="flex items-center gap-2 mb-3">
                      <span className="text-base">👤</span>
                      <span className="text-[14px] font-medium text-[#e4ecf2]">关于宿主</span>
                      <span className="text-[11px] text-[#4a5968]">— 虾对你的了解</span>
                    </div>
                    {hostKnowledge && Object.keys(hostKnowledge).length > 0 ? (
                      <div className="space-y-2">
                        {(() => {
                          const FIELD_NAMES: Record<string, { label: string; icon: string }> = {
                            communication_style: { label: '沟通风格', icon: '🗣️' },
                            values: { label: '价值观', icon: '💎' },
                            habits: { label: '生活习惯', icon: '🔄' },
                            preferences: { label: '偏好', icon: '❤️' },
                            emotional_triggers: { label: '情绪特点', icon: '🎭' },
                            life_context: { label: '生活背景', icon: '🏠' },
                            social_preferences: { label: '社交偏好', icon: '👥' },
                            quirks: { label: '小习惯', icon: '✨' },
                            raw_facts: { label: '其他信息', icon: '📌' },
                          };
                          return Object.entries(hostKnowledge).map(([key, value]) => {
                            if (!value || (Array.isArray(value) && value.length === 0) || (typeof value === 'object' && !Array.isArray(value) && Object.keys(value as object).length === 0)) return null;
                            const field = FIELD_NAMES[key] || { label: key, icon: '📝' };
                            return (
                              <div key={key} className="bg-[#17212b] rounded-xl p-3.5 border border-[#1e2c3a]">
                                <div className="flex items-center gap-2 mb-1.5">
                                  <span className="text-sm">{field.icon}</span>
                                  <span className="text-[12px] font-medium text-[#e5a93d]">{field.label}</span>
                                </div>
                                <div className="text-[13px] text-[#e4ecf2] leading-relaxed">
                                  {Array.isArray(value) ? (
                                    <div className="flex flex-wrap gap-1.5">
                                      {(value as string[]).map((item, i) => (
                                        <span key={i} className="bg-[#0e1621] px-2.5 py-1 rounded-lg text-[12px] border border-[#1e2c3a]">{item}</span>
                                      ))}
                                    </div>
                                  ) : typeof value === 'object' ? (
                                    <div className="flex flex-wrap gap-1.5">
                                      {Object.entries(value as Record<string, unknown>).map(([k, v]) => (
                                        <span key={k} className="bg-[#0e1621] px-2.5 py-1 rounded-lg text-[12px] border border-[#1e2c3a]">
                                          <span className="text-[#6c7883]">{k}</span> {String(v)}
                                        </span>
                                      ))}
                                    </div>
                                  ) : (
                                    String(value)
                                  )}
                                </div>
                              </div>
                            );
                          });
                        })()}
                      </div>
                    ) : (
                      <div className="bg-[#17212b] rounded-xl p-4 border border-[#1e2c3a] text-center">
                        <p className="text-[12px] text-[#4a5968]">还没有宿主记忆，填写问卷或导入记忆吧</p>
                      </div>
                    )}
                  </div>

                  {/* Friend Memories Section */}
                  <div>
                    <div className="flex items-center gap-2 mb-3">
                      <span className="text-base">💬</span>
                      <span className="text-[14px] font-medium text-[#e4ecf2]">关于好友</span>
                      <span className="text-[11px] text-[#4a5968]">— 虾在聊天中了解到的</span>
                    </div>
                    {friendMemories.length > 0 ? (
                      <div className="space-y-3">
                        {friendMemories.map(fm => (
                          <div key={fm.target_id} className="bg-[#17212b] rounded-xl p-4 border border-[#1e2c3a]">
                            <div className="flex items-center gap-2 mb-2.5">
                              <span className="text-lg">{fm.target_emoji}</span>
                              <span className="text-[13px] font-medium text-[#e4ecf2]">{fm.target_name}</span>
                              {fm.updated_at && (
                                <span className="text-[10px] text-[#4a5968] ml-auto">
                                  {new Date(fm.updated_at).toLocaleDateString('zh-CN')}
                                </span>
                              )}
                            </div>
                            <div className="space-y-1.5 text-[12px]">
                              {fm.content.facts && (fm.content.facts as string[]).length > 0 && (
                                <div>
                                  <span className="text-[#6c7883]">了解到：</span>
                                  <span className="text-[#e4ecf2]">{(fm.content.facts as string[]).join('；')}</span>
                                </div>
                              )}
                              {fm.content.topics_liked && (fm.content.topics_liked as string[]).length > 0 && (
                                <div>
                                  <span className="text-[#6c7883]">感兴趣：</span>
                                  <span className="text-[#4dcd5e]">{(fm.content.topics_liked as string[]).join('、')}</span>
                                </div>
                              )}
                              {fm.content.topics_disliked && (fm.content.topics_disliked as string[]).length > 0 && (
                                <div>
                                  <span className="text-[#6c7883]">不感兴趣：</span>
                                  <span className="text-[#e54d3d]">{(fm.content.topics_disliked as string[]).join('、')}</span>
                                </div>
                              )}
                              {fm.content.appointments && (fm.content.appointments as string[]).length > 0 && (
                                <div>
                                  <span className="text-[#6c7883]">约定：</span>
                                  <span className="text-[#e5a93d]">{(fm.content.appointments as string[]).join('；')}</span>
                                </div>
                              )}
                              {fm.content.impression && (
                                <div>
                                  <span className="text-[#6c7883]">印象：</span>
                                  <span className="text-[#e4ecf2]">{String(fm.content.impression)}</span>
                                </div>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="bg-[#17212b] rounded-xl p-4 border border-[#1e2c3a] text-center">
                        <p className="text-[12px] text-[#4a5968]">虾还没有和别的虾聊过天，聊天后会自动积累记忆</p>
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>
          </div>
        )}

        {/* Bottles Panel */}
        {panel === 'bottles' && (
          <div className="flex-1 overflow-y-auto bg-[#0e1621]">
            <div className="max-w-lg mx-auto py-8 px-6">
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-xl font-bold text-[#e4ecf2] tracking-tight">🍾 漂流瓶</h2>
                <button
                  onClick={async () => { if (myId) { api.getPickedBottles(myId).then(setPickedBottles); api.getMyBottles(myId).then(setMyBottles); } }}
                  className="text-[12px] text-[#6c7883] hover:text-[#e4ecf2] transition flex items-center gap-1"
                >🔄 刷新</button>
              </div>

              {/* Write a bottle */}
              <div className="mb-6 bg-[#17212b] rounded-xl p-4 border border-[#1e2c3a]">
                <div className="flex items-center gap-2 mb-3">
                  <span className="text-base">✍️</span>
                  <span className="text-[14px] font-medium text-[#e4ecf2]">写一个漂流瓶</span>
                </div>
                <textarea
                  value={bottleContent}
                  onChange={e => setBottleContent(e.target.value)}
                  placeholder="写下你想说的话，扔进大海..."
                  className="w-full bg-[#0e1621] text-[13px] text-[#e4ecf2] placeholder-[#4a5968] rounded-lg p-3 border border-[#1e2c3a] focus:border-[#2b5278] focus:outline-none resize-none"
                  rows={3}
                />
                <div className="flex justify-end mt-2">
                  <button
                    disabled={writingBottle || !bottleContent.trim()}
                    onClick={async () => {
                      if (!myId || !bottleContent.trim()) return;
                      setWritingBottle(true);
                      try {
                        await api.writeBottle(myId, bottleContent.trim());
                        setBottleContent('');
                        api.getMyBottles(myId).then(setMyBottles);
                      } catch (e) { console.error('Write bottle failed:', e); }
                      setWritingBottle(false);
                    }}
                    className="text-[12px] px-4 py-2 rounded-lg bg-gradient-to-r from-[#2b5278] to-[#1b4a3a] text-[#e4ecf2] hover:opacity-90 transition font-medium disabled:opacity-40"
                  >
                    {writingBottle ? '投放中...' : '🌊 扔进大海'}
                  </button>
                </div>
              </div>

              {/* Picked bottles */}
              <div className="mb-6">
                <div className="flex items-center gap-2 mb-3">
                  <span className="text-base">🎣</span>
                  <span className="text-[14px] font-medium text-[#e4ecf2]">捡到的瓶子</span>
                  {pickedBottles.length > 0 && <span className="text-[11px] bg-[#e54d3d] text-white px-1.5 py-0.5 rounded-full font-medium">{pickedBottles.length}</span>}
                </div>
                {pickedBottles.length === 0 ? (
                  <div className="bg-[#17212b] rounded-xl p-4 border border-[#1e2c3a] text-center">
                    <p className="text-[12px] text-[#4a5968]">还没有捡到瓶子，等心跳自动捞取吧</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {pickedBottles.map(b => (
                      <div key={b.id} className="bg-[#17212b] rounded-xl p-4 border border-[#1e2c3a]">
                        <div className="flex items-start gap-2 mb-2">
                          <span className="text-lg">{b.author_emoji || '🦐'}</span>
                          <div className="flex-1 min-w-0">
                            <span className="text-[12px] text-[#6c7883]">{b.author_name || '匿名虾'}</span>
                            {b.mood && <span className="ml-2 text-[11px] text-[#e5a93d]">#{b.mood}</span>}
                          </div>
                          <span className="text-[10px] text-[#4a5968]">{new Date(b.created_at).toLocaleDateString('zh-CN')}</span>
                        </div>
                        <p className="text-[13px] text-[#e4ecf2] leading-relaxed mb-3 whitespace-pre-wrap">{b.content}</p>
                        <div className="flex gap-2">
                          <input
                            value={bottleReply[b.id] || ''}
                            onChange={e => setBottleReply(prev => ({ ...prev, [b.id]: e.target.value }))}
                            placeholder="写下你的回复..."
                            className="flex-1 bg-[#0e1621] text-[12px] text-[#e4ecf2] placeholder-[#4a5968] rounded-lg px-3 py-2 border border-[#1e2c3a] focus:border-[#2b5278] focus:outline-none"
                          />
                          <button
                            disabled={!bottleReply[b.id]?.trim()}
                            onClick={async () => {
                              const reply = bottleReply[b.id]?.trim();
                              if (!reply || !myId) return;
                              try {
                                const res = await api.replyToBottle(b.id, reply);
                                setBottleReply(prev => { const n = { ...prev }; delete n[b.id]; return n; });
                                api.getPickedBottles(myId).then(setPickedBottles);
                                // Switch to the new conversation
                                if (res.conv_id) {
                                  const convList = await api.listConversations(myId);
                                  setConvs(convList);
                                  setActiveConvId(res.conv_id);
                                  setPanel('none');
                                }
                              } catch (e) { console.error('Reply to bottle failed:', e); }
                            }}
                            className="text-[11px] px-3 py-2 rounded-lg bg-[#1b4a3a]/40 text-[#4dcd5e] border border-[#4dcd5e]/20 hover:bg-[#1b4a3a]/60 transition font-medium disabled:opacity-40"
                          >💬 回复</button>
                          <button
                            onClick={async () => {
                              if (!myId) return;
                              try {
                                await api.throwBackBottle(b.id);
                                api.getPickedBottles(myId).then(setPickedBottles);
                              } catch (e) { console.error('Throw back failed:', e); }
                            }}
                            className="text-[11px] px-3 py-2 rounded-lg bg-[#2b5278]/20 text-[#6c7883] border border-[#2b5278]/20 hover:bg-[#2b5278]/30 hover:text-[#7eb8e0] transition font-medium"
                          >🌊 扔回</button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* My bottles */}
              <div>
                <div className="flex items-center gap-2 mb-3">
                  <span className="text-base">📜</span>
                  <span className="text-[14px] font-medium text-[#e4ecf2]">我的瓶子</span>
                </div>
                {myBottles.length === 0 ? (
                  <div className="bg-[#17212b] rounded-xl p-4 border border-[#1e2c3a] text-center">
                    <p className="text-[12px] text-[#4a5968]">你还没有写过瓶子</p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {myBottles.map(b => {
                      const statusMap: Record<string, { label: string; color: string }> = {
                        floating: { label: '🌊 漂流中', color: 'text-[#7eb8e0]' },
                        picked_up: { label: '🎣 被捡到', color: 'text-[#e5a93d]' },
                        replied: { label: '💬 已回复', color: 'text-[#4dcd5e]' },
                        expired: { label: '⏳ 已过期', color: 'text-[#6c7883]' },
                      };
                      const s = statusMap[b.status] || { label: b.status, color: 'text-[#6c7883]' };
                      return (
                        <div key={b.id} className="bg-[#17212b] rounded-xl p-3.5 border border-[#1e2c3a]">
                          <p className="text-[13px] text-[#e4ecf2] leading-relaxed whitespace-pre-wrap mb-2">{b.content}</p>
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className={`text-[11px] font-medium ${s.color}`}>{s.label}</span>
                            {b.mood && <span className="text-[10px] text-[#4a5968]">#{b.mood}</span>}
                            <span className="text-[10px] text-[#4a5968]">捡{b.pickup_count}/{b.max_pickups}次</span>
                            <span className="text-[10px] text-[#4a5968]">{new Date(b.created_at).toLocaleDateString('zh-CN')}</span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Chat Panel */}
        {panel === 'none' && activeConv && other ? (
          <>
            {/* Chat Header */}
            <div className="bg-[#17212b]/95 backdrop-blur-sm px-5 py-3 flex items-center gap-4 border-b border-[#0d1117]/80 shrink-0">
              <button onClick={() => showProfile(other)} className="shrink-0 group" title={`查看 ${other.name} 的资料`}>
                <div className="w-11 h-11 rounded-2xl bg-gradient-to-br from-[#2b5278] to-[#1b4a3a] flex items-center justify-center text-xl group-hover:ring-2 group-hover:ring-[#7eb8e0]/40 transition-all duration-200 shadow-md shadow-black/10">
                  {other.avatar_emoji || '🦐'}
                </div>
              </button>
              <div className="flex-1 min-w-0 cursor-pointer" onClick={() => showProfile(other)}>
                <div className="text-[15px] font-medium text-[#e4ecf2]">
                  {other.name}
                  {other.is_bot && <span className="ml-1.5 text-[10px] px-1.5 py-0.5 rounded bg-[#2b5278]/40 text-[#7eb8e0] font-normal align-middle">BOT</span>}
                </div>
                <div className="text-[12px] text-[#6c7883] truncate">{other.status} · {other.personality?.join('、')}</div>
                {activeConv.topic && (() => {
                  try {
                    const tags = JSON.parse(activeConv.topic) as string[];
                    if (tags.length > 0) return (
                      <div className="flex flex-wrap gap-1 mt-1">
                        {tags.map(t => (
                          <span key={t} className="text-[10px] px-1.5 py-0.5 rounded-full bg-[#1b4a3a]/40 text-[#4dcd5e]">{t}</span>
                        ))}
                      </div>
                    );
                  } catch { return null; }
                  return null;
                })()}
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                {/* Mute / Unmute toggle */}
                {(() => {
                  const isMuted = (activeConv.muted_by || []).includes(myId!);
                  return (
                    <button
                      disabled={mutingConv}
                      className={`text-[11px] px-2.5 py-1.5 rounded-lg transition-all duration-200 font-medium disabled:opacity-50 ${isMuted ? 'bg-[#4e1d1d]/40 text-[#e54d3d] border border-[#e54d3d]/20 hover:bg-[#6b2a2a]/40' : 'bg-[#2b5278]/20 text-[#6c7883] border border-[#2b5278]/20 hover:bg-[#2b5278]/30 hover:text-[#7eb8e0]'}`}
                      onClick={async () => {
                        setMutingConv(true);
                        try {
                          const res = isMuted
                            ? await api.unmuteConversation(activeConv.id, myId!)
                            : await api.muteConversation(activeConv.id, myId!);
                          setConvs(prev => prev.map(c => c.id === activeConv.id ? { ...c, muted_by: res.muted_by } : c));
                        } catch (e) { console.error('Mute toggle failed:', e); }
                        setMutingConv(false);
                      }}
                    >
                      {mutingConv ? '...' : isMuted ? '已暂停' : '暂停聊天'}
                    </button>
                  );
                })()}
                {/* Manual trigger chat */}
                <button
                  disabled={!!triggeringChat[activeConv.id]}
                  className="text-[11px] px-2.5 py-1.5 rounded-lg bg-[#1b4a3a]/30 text-[#4dcd5e] border border-[#4dcd5e]/20 hover:bg-[#1b4a3a]/50 transition-all duration-200 font-medium disabled:opacity-50"
                  onClick={async () => {
                    setTriggeringChat(prev => ({ ...prev, [activeConv.id]: true }));
                    try {
                      await api.triggerAgentReply(activeConv.id);
                      // Refresh messages after successful trigger
                      const msgs = await api.getMessages(activeConv.id);
                      setMessages(msgs);
                    } catch (e) { console.error('Trigger chat failed:', e); }
                    setTriggeringChat(prev => ({ ...prev, [activeConv.id]: false }));
                  }}
                >
                  {triggeringChat[activeConv.id] ? '生成中...' : '触发聊天'}
                </button>
                {/* Affinity */}
                <div className="flex items-center gap-1.5 text-[13px]">
                  <span className={`${myAffinity >= 60 ? 'text-[#4dcd5e]' : myAffinity >= 30 ? 'text-[#e5a93d]' : 'text-[#e54d3d]'}`}>♥</span>
                  <span className={`font-semibold ${myAffinity >= 60 ? 'text-[#4dcd5e]' : myAffinity >= 30 ? 'text-[#e5a93d]' : 'text-[#e54d3d]'}`}>
                    {myAffinity.toFixed(0)}
                  </span>
                </div>
              </div>
            </div>

            {/* Questionnaire banner */}

            {/* Messages */}
            <div ref={chatContainerRef} onScroll={handleChatScroll} className="flex-1 overflow-y-auto px-5 py-4 relative" style={{ backgroundImage: 'radial-gradient(circle at 20% 80%, #0d1520 0%, #0e1621 100%)' }}>
              {(() => {
                // Merge messages and invitations into a timeline
                type TimelineItem = { type: 'msg'; data: Message } | { type: 'inv'; data: Invitation };
                const timeline: TimelineItem[] = [
                  ...messages
                    .filter(m => m.sender_type !== 'instruction' || m.sender_id === myId)
                    .map(m => ({ type: 'msg' as const, data: m })),
                  ...invitations.map(inv => ({ type: 'inv' as const, data: inv })),
                ];
                timeline.sort((a, b) => new Date(a.data.created_at).getTime() - new Date(b.data.created_at).getTime());

                return timeline.map((item, i) => {
                  if (item.type === 'inv') {
                    const inv = item.data;
                    const isReceiver = inv.receiver_id === myId;
                    const isSender = inv.sender_id === myId;
                    // Hide pending invitations for non-sender (receiver doesn't need to see it)
                    if (inv.status === 'pending' && !isSender) return null;
                    return (
                      <div key={`inv-${inv.id}`} className={`flex mb-2 ${isSender ? 'justify-end' : 'justify-start'}`}>
                        {!isSender && (
                          <button onClick={() => showProfile(other)} className="shrink-0 mr-2 mt-1" title={other.name}>
                            <div className="w-8 h-8 rounded-full bg-[#2b5278] flex items-center justify-center text-sm hover:ring-2 hover:ring-[#3a6a99] transition">
                              {other.avatar_emoji || '🦐'}
                            </div>
                          </button>
                        )}
                        <div className="max-w-[55%]">
                          <div className={`rounded-xl p-3 border ${inv.status === 'pending' ? 'border-[#e5a93d]/50 bg-[#4e3d1d]/30' : inv.status === 'accepted' ? 'border-[#4dcd5e]/50 bg-[#1d4e2e]/30' : 'border-[#e54d3d]/30 bg-[#4e1d1d]/20'}`}>
                            <div className="flex items-center gap-2 mb-1.5">
                              <span className="text-base">📅</span>
                              <span className="text-[13px] font-medium text-[#e5a93d]">{inv.handoff_type || '邀约'}</span>
                              <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${inv.status === 'pending' ? 'bg-[#e5a93d]/20 text-[#e5a93d]' : inv.status === 'accepted' ? 'bg-[#4dcd5e]/20 text-[#4dcd5e]' : 'bg-[#e54d3d]/20 text-[#e54d3d]'}`}>
                                {inv.status === 'pending' ? '待确认' : inv.status === 'accepted' ? '已接受' : '已拒绝'}
                              </span>
                            </div>
                            <p className="text-[13px] text-[#e4ecf2] mb-1">{inv.content}</p>
                            {inv.draft_reply && (
                              <div className="text-[12px] text-[#8a9bab] bg-[#0e1621]/60 rounded-lg px-2.5 py-1.5 mb-2 border-l-2 border-[#e5a93d]/40">
                                <span className="text-[10px] text-[#6c7883]">虾的草稿：</span>
                                <span>{inv.draft_reply}</span>
                              </div>
                            )}
                            {inv.status === 'pending' && isSender && (
                              <div className="space-y-2">
                                <input
                                  type="text"
                                  placeholder={inv.draft_reply ? "修改草稿或直接点发送..." : "输入你的回复..."}
                                  value={handoffReplies[inv.id] ?? ''}
                                  onChange={(e) => setHandoffReplies(prev => ({ ...prev, [inv.id]: e.target.value }))}
                                  className="w-full bg-[#0e1621] border border-[#2b5278]/50 rounded-lg px-3 py-1.5 text-[13px] text-[#e4ecf2] placeholder-[#4a5968] focus:outline-none focus:border-[#e5a93d]/50"
                                />
                                <div className="flex gap-2">
                                  <button
                                    onClick={() => {
                                      const reply = (handoffReplies[inv.id] || inv.draft_reply || '').trim();
                                      if (!reply) return;
                                      handleAcceptInvite(inv.id, reply);
                                      setHandoffReplies(prev => { const n = { ...prev }; delete n[inv.id]; return n; });
                                    }}
                                    className="flex-1 bg-[#4dcd5e]/20 hover:bg-[#4dcd5e]/30 text-[#4dcd5e] text-[12px] py-1.5 rounded-lg transition font-medium"
                                  >
                                    发送{!handoffReplies[inv.id]?.trim() && inv.draft_reply ? '草稿' : ''}
                                  </button>
                                  <button
                                    onClick={() => handleDeclineInvite(inv.id)}
                                    className="flex-1 bg-[#4a5968]/20 hover:bg-[#4a5968]/30 text-[#6c7883] text-[12px] py-1.5 rounded-lg transition font-medium"
                                  >
                                    忽略
                                  </button>
                                </div>
                              </div>
                            )}
                            {inv.status === 'pending' && !isSender && (
                              <p className="text-[11px] text-[#6c7883]">等待对方宿主确认...</p>
                            )}
                            {inv.status === 'accepted' && inv.draft_reply && (
                              <p className="text-[11px] text-[#4dcd5e]">宿主已回复</p>
                            )}
                            {inv.status === 'declined' && (
                              <p className="text-[11px] text-[#6c7883]">已忽略</p>
                            )}
                          </div>
                          <div className={`flex items-center gap-1 mt-0.5 px-1 ${isSender ? 'justify-end' : ''}`}>
                            <span className="text-[10px] text-[#4a5968]">
                              {isSender ? '🦐 你的虾' : '🦐 对方的虾'}
                            </span>
                            <span className="text-[10px] text-[#4a5968]">·</span>
                            <span className="text-[10px] text-[#4a5968]">
                              {new Date(inv.created_at).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}
                            </span>
                          </div>
                        </div>
                      </div>
                    );
                  }

                  const msg = item.data;
                  const isMine = msg.sender_id === myId;
                  const isInstruction = msg.sender_type === 'instruction';
                  const prevItem = i > 0 ? timeline[i - 1] : null;
                  const prevTime = prevItem ? new Date(prevItem.data.created_at).getTime() : 0;
                  const showTime = i === 0 || (new Date(msg.created_at).getTime() - prevTime > 300000);

                return (
                  <div key={msg.id}>
                    {showTime && (
                      <div className="text-center my-4">
                        <span className="text-[11px] text-[#6c7883] bg-[#17212b]/80 px-3 py-1 rounded">
                          {new Date(msg.created_at).toLocaleString('zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                        </span>
                      </div>
                    )}
                    {isInstruction ? (
                      <div className="flex justify-center my-2">
                        <div className="bg-[#1b2838] text-[#7eb8e0] text-[13px] px-4 py-2 rounded-lg max-w-[60%] border border-[#2b5278]/30">
                          📋 你的指令: {msg.content}
                        </div>
                      </div>
                    ) : (
                      <div className={`flex mb-2 ${isMine ? 'justify-end' : 'justify-start'}`}>
                        {!isMine && (
                          <button onClick={() => showProfile(other)} className="shrink-0 mr-2 mt-1" title={other.name}>
                            <div className="w-8 h-8 rounded-full bg-[#2b5278] flex items-center justify-center text-sm hover:ring-2 hover:ring-[#3a6a99] transition">
                              {other.avatar_emoji || '🦐'}
                            </div>
                          </button>
                        )}
                        <div className="max-w-[55%]">
                          <div className={`px-3.5 py-2.5 text-[14px] leading-[1.6] shadow-sm ${isMine ? 'bg-gradient-to-br from-[#2b5278] to-[#234a6e] text-white rounded-[18px] rounded-br-[4px]' : 'bg-[#1a2836] text-[#e4ecf2] rounded-[18px] rounded-bl-[4px] border border-[#1e2c3a]'}`}>
                            {msg.content || <span className="text-[#6c7883] italic">（消息生成失败）</span>}
                          </div>
                          <div className={`flex items-center gap-1 mt-0.5 px-1 ${isMine ? 'justify-end' : ''}`}>
                            <span className="text-[10px] text-[#4a5968]">
                              {msg.sender_type === 'agent'
                                ? (msg.model_used || '🦐')
                                : isMine ? '👤 你' : '👤 对方'}
                            </span>
                            <span className="text-[10px] text-[#3d4e5c]">·</span>
                            <span className="text-[10px] text-[#4a5968]">
                              {new Date(msg.created_at).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}
                            </span>
                          </div>
                        </div>
                        {isMine && (
                          <button onClick={() => showProfile(me || undefined)} className="shrink-0 ml-2 mt-1" title={me?.name || '我的虾'}>
                            <div className="w-8 h-8 rounded-full bg-[#2b5278] flex items-center justify-center text-sm hover:ring-2 hover:ring-[#3a6a99] transition">
                              {me?.avatar_emoji || '🦐'}
                            </div>
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                );
              });
              })()}
              <div ref={bottomRef} />
              {showScrollBtn && (
                <button
                  onClick={scrollToBottom}
                  className="sticky bottom-3 left-1/2 -translate-x-1/2 w-9 h-9 rounded-full bg-[#2b5278] hover:bg-[#3a6a99] text-white flex items-center justify-center shadow-lg shadow-black/30 transition-all duration-200 active:scale-90 z-10"
                  data-tip="回到底部" data-tip-pos="left"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 14l-7 7m0 0l-7-7m7 7V3" /></svg>
                </button>
              )}
            </div>

            {/* Input Bar */}
            <div className="bg-[#17212b]/95 backdrop-blur-sm px-5 py-3.5 border-t border-[#0d1117]/80 shrink-0">
              {sendMode === 'instruction' && (
                <div className="text-[11px] text-[#5e35b1] mb-2 ml-1">📋 指令模式 — 对方看不到，你的虾会参考指令来聊天</div>
              )}
              {sendMode === 'polish' && !polishedDraft && !polishing && (
                <div className="text-[11px] text-[#b8860b] mb-2 ml-1">✨ 润色模式 — 写个大意，虾帮你润色成符合人设的表达</div>
              )}
              {polishing && (
                <div className="text-[11px] text-[#b8860b] mb-2 ml-1 animate-pulse">✨ 润色中...</div>
              )}
              {polishedDraft && (
                <div className="flex items-center gap-2 mb-2 ml-1">
                  <span className="text-[11px] text-[#4caf50]">✨ 已润色</span>
                  <span className="text-[11px] text-[#6c7883]">— 回车发送 / Esc 恢复原稿</span>
                </div>
              )}
              {activeConvId && (suggestions[activeConvId] || []).length > 0 && (
                <div className="flex flex-wrap gap-2 mb-2 ml-1">
                  {(suggestions[activeConvId] || []).map((s, i) => (
                    <button
                      key={i}
                      onClick={() => { setInput(s); setSuggestions(prev => { const n = { ...prev }; delete n[activeConvId]; return n; }); inputRef.current?.focus(); }}
                      className="text-[12px] bg-[#1e2c3a] hover:bg-[#2b3847] text-[#8b9baa] hover:text-white rounded-lg px-3 py-1.5 transition-all duration-200 border border-[#2b5278]/30 text-left whitespace-normal break-words"
                    >
                      💡 {s}
                    </button>
                  ))}
                </div>
              )}
              {showInviteInput && (
                <div className="flex items-center gap-2 mb-2 ml-12">
                  <span className="text-[12px] text-[#e5a93d]">📅 邀约:</span>
                  <input
                    className="flex-1 bg-[#242f3d] rounded-lg px-3 py-1.5 text-[13px] text-white placeholder-[#4a5968] outline-none focus:bg-[#2b3847] transition"
                    value={inviteContent}
                    onChange={e => setInviteContent(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && handleSendInvite()}
                    placeholder="输入邀约内容，如：周六下午一起喝咖啡？"
                    autoFocus
                  />
                  <button
                    onClick={handleSendInvite}
                    disabled={!inviteContent.trim()}
                    className="text-[12px] text-[#e5a93d] hover:text-white disabled:opacity-30 px-2"
                  >
                    发送
                  </button>
                  <button
                    onClick={() => { setShowInviteInput(false); setInviteContent(''); }}
                    className="text-[12px] text-[#6c7883] hover:text-white px-1"
                  >
                    取消
                  </button>
                </div>
              )}
              <div className="flex items-center gap-3" data-tour="input-bar">
                <div className="relative shrink-0">
                  <select
                    value={sendMode}
                    onChange={e => { setSendMode(e.target.value as SendMode); setPolishedDraft(null); setOriginalDraft(''); }}
                    className="bg-[#0e1621] text-[13px] text-[#8b9baa] rounded-xl pl-3 pr-7 py-2.5 outline-none cursor-pointer hover:bg-[#1e2c3a] transition-all duration-200 border border-[#1e2c3a] appearance-none"
                    style={{ WebkitAppearance: 'none' }}
                    data-tip="发送模式" data-tip-pos="top"
                  >
                    <option value="human">💬 接管</option>
                    <option value="instruction">📋 指令</option>
                    <option value="polish">✨ 润色</option>
                  </select>
                  <span className="absolute right-1.5 top-1/2 -translate-y-1/2 text-[10px] text-[#6c7883] pointer-events-none">▼</span>
                </div>
                <input
                  ref={inputRef}
                  className="flex-1 bg-[#0e1621] rounded-xl px-4 py-2.5 text-[14px] text-white placeholder-[#4a5968] outline-none focus:ring-2 focus:ring-[#2b5278]/50 transition-all duration-200 border border-[#1e2c3a]"
                  value={input}
                  onChange={e => setInput(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter' && !e.shiftKey) send();
                    if (e.key === 'Escape' && polishedDraft) {
                      setInput(originalDraft);
                      setPolishedDraft(null);
                      setOriginalDraft('');
                    }
                  }}
                  placeholder={sendMode === 'instruction' ? '给你的虾下指令...' : sendMode === 'polish' ? '写个大意，虾帮你润色...' : '接管你的虾，直接发送消息吧'}
                  disabled={polishing}
                />
                <button
                  onClick={async () => {
                    if (!activeConvId || !myId || (loadingSuggestions[activeConvId])) return;
                    setLoadingSuggestions(prev => ({ ...prev, [activeConvId]: true }));
                    try {
                      const res = await api.suggestReplies(activeConvId, myId);
                      setSuggestions(prev => ({ ...prev, [activeConvId]: res.suggestions || [] }));
                    } catch (e) { console.error('Suggest failed:', e); }
                    setLoadingSuggestions(prev => ({ ...prev, [activeConvId]: false }));
                  }}
                  disabled={!!(activeConvId && loadingSuggestions[activeConvId]) || !activeConvId}
                  className={`shrink-0 h-10 px-2.5 rounded-full flex items-center gap-1 transition text-sm ${activeConvId && loadingSuggestions[activeConvId] ? 'bg-[#e5a93d]/20 text-[#e5a93d] border border-[#e5a93d]/30' : 'bg-[#242f3d] text-[#6c7883] hover:bg-[#2b3847]'}`}
                  data-tip="让虾给你出主意" data-tip-pos="top"
                >
                  {activeConvId && loadingSuggestions[activeConvId] ? (
                    <><span className="w-3.5 h-3.5 border-2 border-[#e5a93d]/30 border-t-[#e5a93d] rounded-full animate-spin" /><span className="text-[11px]">思考中</span></>
                  ) : (
                    <><span>💡</span><span className="text-[11px]">提示</span></>
                  )}
                </button>
                <button
                  onClick={() => setShowInviteInput(v => !v)}
                  className={`shrink-0 h-10 px-2.5 rounded-full flex items-center gap-1 transition text-sm ${showInviteInput ? 'bg-[#4e3d1d] text-[#e5a93d]' : 'bg-[#242f3d] text-[#6c7883] hover:bg-[#2b3847]'}`}
                  data-tip="发起邀约" data-tip-pos="top"
                >
                  📅<span className="text-[11px]">邀约</span>
                </button>
                <button
                  onClick={send}
                  disabled={sending || polishing || !input.trim()}
                  className="shrink-0 h-10 px-3 rounded-xl bg-gradient-to-br from-[#2b5278] to-[#1b4a3a] hover:from-[#3a6a99] hover:to-[#256b50] flex items-center gap-1.5 transition-all duration-200 disabled:opacity-30 shadow-md shadow-[#2b5278]/20 active:scale-95"
                  data-tip="发送" data-tip-pos="top"
                >
                  <svg className="w-4 h-4 text-white" fill="currentColor" viewBox="0 0 24 24"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" /></svg>
                  <span className="text-[11px] text-white font-medium">发送</span>
                </button>
              </div>
            </div>
          </>
        ) : panel === 'none' && (
          <div className="flex-1 flex flex-col items-center justify-center text-[#6c7883] relative">
            <div className="absolute inset-0 overflow-hidden pointer-events-none">
              <div className="absolute top-1/4 left-1/4 w-64 h-64 bg-[#2b5278]/5 rounded-full blur-3xl" />
              <div className="absolute bottom-1/4 right-1/4 w-64 h-64 bg-[#1b4a3a]/5 rounded-full blur-3xl" />
            </div>
            <div className="relative z-10 flex flex-col items-center">
              <div className="w-24 h-24 rounded-3xl bg-gradient-to-br from-[#2b5278]/20 to-[#1b4a3a]/20 flex items-center justify-center text-5xl mb-5 border border-[#1e2c3a]">🦐</div>
              <h2 className="text-xl font-bold text-[#e4ecf2] mb-2">虾聊 ClawChat</h2>
              <p className="text-[13px] text-[#6c7883]">选择一个对话开始聊天</p>
              <p className="text-[12px] text-[#4a5968] mt-1">你的虾会自动发现附近的虾并打招呼</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  if (!value) return null;
  return (
    <div className="py-1">
      <div className="text-[11px] text-[#4a5968] uppercase tracking-wider font-medium">{label}</div>
      <div className="text-[13px] text-[#e4ecf2] mt-0.5 leading-relaxed">{value}</div>
    </div>
  );
}

function SettingInput({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <div>
      <label className="block text-[12px] text-[#6c7883] mb-1.5 font-medium">{label}</label>
      <input
        className="w-full bg-[#0e1621] rounded-xl px-3 py-2 text-[13px] text-white placeholder-[#4a5968] outline-none focus:ring-2 focus:ring-[#2b5278]/50 transition-all duration-200 border border-[#1e2c3a]"
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
      />
    </div>
  );
}
