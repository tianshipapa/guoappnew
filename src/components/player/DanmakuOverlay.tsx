import React, { useState, useEffect, useRef } from 'react';
import { Send, MessageSquareOff, MessageSquare } from 'lucide-react';
import { DanmakuItem } from '../../types';

interface DanmakuOverlayProps {
  currentTime: number;
  enabled: boolean;
  onToggleEnabled: () => void;
  dramaTitle?: string;
}

const DEFAULT_DANMAKU: DanmakuItem[] = [
  { id: '1', text: '前方高能预警！！！', time: 2, color: '#f43f5e' },
  { id: '2', text: '太解气了！打脸来得真快', time: 5, color: '#fbbf24' },
  { id: '3', text: '战神一怒，寸草不生！', time: 9, color: '#38bdf8' },
  { id: '4', text: '一口气刷到这里停不下来了', time: 14, color: '#ffffff' },
  { id: '5', text: '女主太飒了吧，爱了爱了', time: 18, color: '#ec4899' },
  { id: '6', text: '这反转万万没想到！', time: 23, color: '#34d399' },
  { id: '7', text: '隐婚大佬宠上天', time: 30, color: '#a78bfa' },
  { id: '8', text: '还有谁敢欺负主角？', time: 38, color: '#f43f5e' },
  { id: '9', text: '哈哈哈哈丈母娘吓傻了', time: 45, color: '#fbbf24' },
  { id: '10', text: '求求快更下一集！', time: 52, color: '#ffffff' },
];

export const DanmakuOverlay: React.FC<DanmakuOverlayProps> = ({
  currentTime,
  enabled,
  onToggleEnabled,
}) => {
  const [danmakuList, setDanmakuList] = useState<DanmakuItem[]>(DEFAULT_DANMAKU);
  const [inputText, setInputText] = useState('');
  const [inputColor, setInputColor] = useState('#ffffff');
  const [activeItems, setActiveItems] = useState<{ item: DanmakuItem; top: number; key: string }[]>([]);
  const spawnedRef = useRef<Set<string>>(new Set());

  // Check current time to spawn danmaku
  useEffect(() => {
    if (!enabled) {
      setActiveItems([]);
      return;
    }

    const currentSec = Math.floor(currentTime);
    const toSpawn = danmakuList.filter((d) => Math.floor(d.time) === currentSec && !spawnedRef.current.has(`${d.id}_${currentSec}`));

    if (toSpawn.length > 0) {
      toSpawn.forEach((item, index) => {
        spawnedRef.current.add(`${item.id}_${currentSec}`);
        const lanes = [12, 28, 44, 60, 76];
        const top = lanes[(item.id.charCodeAt(0) + index) % lanes.length];
        const uniqueKey = `${item.id}_${Date.now()}_${Math.random()}`;

        setActiveItems((prev) => [...prev, { item, top, key: uniqueKey }]);

        // Remove after 7s animation finishes
        setTimeout(() => {
          setActiveItems((prev) => prev.filter((x) => x.key !== uniqueKey));
        }, 7000);
      });
    }
  }, [currentTime, enabled, danmakuList]);

  const handleSend = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputText.trim()) return;

    const newItem: DanmakuItem = {
      id: `custom_${Date.now()}`,
      text: inputText.trim(),
      time: Math.floor(currentTime) + 0.1,
      color: inputColor,
    };

    setDanmakuList((prev) => [...prev, newItem]);
    setInputText('');

    // Instant spawn on screen
    const lanes = [15, 30, 48, 65];
    const top = lanes[Math.floor(Math.random() * lanes.length)];
    const uniqueKey = `user_${Date.now()}`;
    setActiveItems((prev) => [...prev, { item: newItem, top, key: uniqueKey }]);
    setTimeout(() => {
      setActiveItems((prev) => prev.filter((x) => x.key !== uniqueKey));
    }, 7000);
  };

  return (
    <>
      {/* Floating Danmaku Items */}
      {enabled && (
        <div className="absolute inset-0 overflow-hidden pointer-events-none z-20">
          {activeItems.map(({ item, top, key }) => (
            <div
              key={key}
              style={{
                top: `${top}%`,
                color: item.color || '#ffffff',
                textShadow: '0 1px 3px rgba(0,0,0,0.9), 0 0 4px rgba(0,0,0,0.7)',
                animationDuration: '6.5s',
              }}
              className="absolute right-0 font-medium text-xs md:text-sm lg:text-base animate-danmaku select-none px-2"
            >
              {item.text}
            </div>
          ))}
        </div>
      )}

      {/* Danmaku Input Bottom Bar */}
      <div className="mt-2 flex items-center gap-2 bg-slate-900/90 border border-slate-800 rounded-xl px-3 py-1.5 text-xs">
        <button
          onClick={onToggleEnabled}
          className={`flex items-center gap-1 px-2 py-1 rounded-md transition-colors ${
            enabled
              ? 'bg-rose-500/20 text-rose-400 border border-rose-500/30'
              : 'bg-slate-800 text-slate-400'
          }`}
          title={enabled ? '关闭弹幕' : '开启弹幕'}
        >
          {enabled ? <MessageSquare className="w-3.5 h-3.5" /> : <MessageSquareOff className="w-3.5 h-3.5" />}
          <span>弹幕</span>
        </button>

        {/* Color picker shortcuts */}
        <div className="hidden sm:flex items-center gap-1">
          {['#ffffff', '#f43f5e', '#fbbf24', '#38bdf8', '#34d399'].map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setInputColor(c)}
              style={{ backgroundColor: c }}
              className={`w-3.5 h-3.5 rounded-full border ${
                inputColor === c ? 'border-white scale-110 shadow-sm' : 'border-transparent'
              } transition-transform`}
            />
          ))}
        </div>

        {/* Input */}
        <form onSubmit={handleSend} className="flex-1 flex items-center gap-1.5">
          <input
            type="text"
            placeholder={enabled ? '发一条弹幕参与互动…' : '弹幕已关闭，点击左侧按钮开启'}
            disabled={!enabled}
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            className="flex-1 bg-slate-800/80 text-slate-100 placeholder-slate-500 px-2.5 py-1 rounded-md text-xs focus:outline-none focus:ring-1 focus:ring-rose-500 disabled:opacity-50"
          />
          <button
            type="submit"
            disabled={!enabled || !inputText.trim()}
            className="bg-rose-600 hover:bg-rose-500 disabled:opacity-40 text-white px-2.5 py-1 rounded-md text-xs font-medium flex items-center gap-1 transition-colors"
          >
            <Send className="w-3 h-3" />
            <span>发送</span>
          </button>
        </form>
      </div>
    </>
  );
};
