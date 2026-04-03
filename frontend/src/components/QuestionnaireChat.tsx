import { useState, useRef, useEffect } from 'react';
import { api } from '../api';
import type { QuestionnaireQuestion, QuestionnaireAnswer } from '../types';

interface Props {
  avatarEmoji: string;
  onClose: () => void;
}

interface ChatMsg {
  role: 'shrimp' | 'user';
  text: string;
}

export default function QuestionnaireChat({ avatarEmoji, onClose }: Props) {
  const [questions, setQuestions] = useState<QuestionnaireQuestion[]>([]);
  const [currentIdx, setCurrentIdx] = useState(0);
  const [answers, setAnswers] = useState<QuestionnaireAnswer[]>([]);
  const [chatMsgs, setChatMsgs] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [summary, setSummary] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo(0, scrollRef.current.scrollHeight);
  }, [chatMsgs]);

  useEffect(() => {
    (async () => {
      try {
        const res = await api.questionnaireGenerate();
        const qs = res.questions || [];
        setQuestions(qs);
        if (qs.length > 0) {
          setChatMsgs([{ role: 'shrimp', text: qs[0].text }]);
        }
      } catch (e) {
        console.error('Failed to generate questionnaire:', e);
        setChatMsgs([{ role: 'shrimp', text: '生成问卷失败了，稍后再试吧~' }]);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const handleAnswer = () => {
    const text = input.trim();
    if (!text && !questions[currentIdx]) return;

    const q = questions[currentIdx];
    const newMsgs = [...chatMsgs];
    const newAnswers = [...answers];

    if (text) {
      newMsgs.push({ role: 'user', text });
      newAnswers.push({ question_id: q.id, question: q.text, answer: text });
    }

    setInput('');
    setAnswers(newAnswers);

    const nextIdx = currentIdx + 1;
    if (nextIdx < questions.length) {
      newMsgs.push({ role: 'shrimp', text: questions[nextIdx].text });
      setCurrentIdx(nextIdx);
      setChatMsgs(newMsgs);
    } else {
      newMsgs.push({ role: 'shrimp', text: '谢谢！让我消化一下~' });
      setChatMsgs(newMsgs);
      submitAnswers(newAnswers, newMsgs);
    }
  };

  const handleSkip = () => {
    const newMsgs = [...chatMsgs];
    newMsgs.push({ role: 'user', text: '（跳过）' });
    const nextIdx = currentIdx + 1;
    if (nextIdx < questions.length) {
      newMsgs.push({ role: 'shrimp', text: questions[nextIdx].text });
      setCurrentIdx(nextIdx);
      setChatMsgs(newMsgs);
    } else {
      newMsgs.push({ role: 'shrimp', text: '谢谢！让我消化一下~' });
      setChatMsgs(newMsgs);
      submitAnswers(answers, newMsgs);
    }
  };

  const submitAnswers = async (ans: QuestionnaireAnswer[], msgs: ChatMsg[]) => {
    if (ans.length === 0) {
      setChatMsgs([...msgs, { role: 'shrimp', text: '你跳过了所有问题，下次再聊吧~' }]);
      setSummary('done');
      return;
    }
    setSubmitting(true);
    try {
      const res = await api.questionnaireSubmit(ans);
      setChatMsgs([...msgs, { role: 'shrimp', text: res.summary }]);
      setSummary(res.summary);
    } catch (e) {
      console.error('Submit failed:', e);
      setChatMsgs([...msgs, { role: 'shrimp', text: '处理答案时出错了...' }]);
      setSummary('error');
    } finally {
      setSubmitting(false);
    }
  };

  const isDone = !!summary;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="w-[90%] max-w-md h-[70vh] bg-[#17212b] rounded-2xl border border-[#2b5278]/50 flex flex-col overflow-hidden shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-[#2b5278]/30">
          <div className="flex items-center gap-2">
            <span className="text-2xl">{avatarEmoji || '🦐'}</span>
            <span className="text-[15px] font-medium text-[#e4ecf2]">虾想了解你</span>
          </div>
          <button onClick={onClose} className="text-[#6c7883] hover:text-[#e4ecf2] transition text-lg">✕</button>
        </div>

        {/* Chat area */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
          {loading && (
            <div className="flex justify-center py-8">
              <div className="animate-spin w-6 h-6 border-2 border-[#2b5278] border-t-[#e5a93d] rounded-full" />
            </div>
          )}
          {chatMsgs.map((msg, i) => (
            <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              {msg.role === 'shrimp' && (
                <div className="shrink-0 mr-2 mt-1 w-7 h-7 rounded-full bg-[#2b5278] flex items-center justify-center text-sm">
                  {avatarEmoji || '🦐'}
                </div>
              )}
              <div className={`max-w-[75%] px-3 py-2 text-[13px] leading-[1.6] rounded-2xl ${
                msg.role === 'user'
                  ? 'bg-gradient-to-br from-[#2b5278] to-[#234a6e] text-white rounded-br-[4px]'
                  : 'bg-[#1a2836] text-[#e4ecf2] rounded-bl-[4px] border border-[#1e2c3a]'
              }`}>
                {msg.text}
              </div>
            </div>
          ))}
          {submitting && (
            <div className="flex items-center gap-2 text-[12px] text-[#6c7883]">
              <div className="animate-spin w-4 h-4 border-2 border-[#2b5278] border-t-[#e5a93d] rounded-full" />
              正在分析你的回答...
            </div>
          )}
        </div>

        {/* Input area */}
        {!isDone && !loading && questions.length > 0 && (
          <div className="px-4 py-3 border-t border-[#2b5278]/30 flex gap-2">
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && input.trim()) handleAnswer(); }}
              placeholder="输入你的回答..."
              className="flex-1 bg-[#0e1621] border border-[#2b5278]/50 rounded-xl px-3 py-2 text-[13px] text-[#e4ecf2] placeholder-[#4a5968] focus:outline-none focus:border-[#2b5278]"
              disabled={submitting}
            />
            <button
              onClick={handleAnswer}
              disabled={!input.trim() || submitting}
              className="px-3 py-2 bg-[#2b5278] hover:bg-[#3a6a99] text-white text-[12px] rounded-xl transition disabled:opacity-40"
            >
              发送
            </button>
            <button
              onClick={handleSkip}
              disabled={submitting}
              className="px-3 py-2 bg-[#1a2836] hover:bg-[#243345] text-[#6c7883] text-[12px] rounded-xl transition border border-[#2b5278]/30"
            >
              跳过
            </button>
          </div>
        )}

        {isDone && (
          <div className="px-4 py-3 border-t border-[#2b5278]/30">
            <button
              onClick={onClose}
              className="w-full py-2.5 bg-gradient-to-r from-[#2b5278] to-[#3a6a99] text-white text-[13px] rounded-xl hover:brightness-110 transition font-medium"
            >
              完成
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
