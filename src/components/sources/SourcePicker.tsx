import React, { useState, useRef, useEffect, useCallback } from 'react';
import { SlidersHorizontal, Check, ChevronDown, Layers } from 'lucide-react';
import { SourceSite } from '../../types';

/** 每行显示的列数 */
const COLS = 3;
/** 移动端长按多久后进入"拖动手指滚动列表"模式 */
const LONG_PRESS_MS = 320;
/** 手指移动超过此像素值时，视为滚动意图、取消长按计时器 */
const SWIPE_CANCEL_PX = 10;

export interface SourcePickerProps {
  sources: SourceSite[];
  currentSource: string;
  onSelect: (id: string) => void;
}

/**
 * 站源选择器：替代原生 <select>。
 *
 * - 触发按钮：显示当前源名 + 展开箭头
 * - 面板：每行 3 个按钮，点击直接选中并关闭
 * - 桌面端：面板获得焦点后 ↑↓←→ 移动高亮、Enter 选中、Esc 关闭
 * - 移动端：在列表区长按 320 ms 后，用手指上下拖动即可快速浏览源列表
 */
export const SourcePicker: React.FC<SourcePickerProps> = ({
  sources,
  currentSource,
  onSelect,
}) => {
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);

  const panelRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const touchState = useRef({
    longPressActive: false,
    startY: 0,
    lastY: 0,
  });

  const currentSourceObj = sources.find((s) => s.id === currentSource) || sources[0];

  // 面板打开时，高亮聚焦到当前选中源
  useEffect(() => {
    if (open) {
      const idx = Math.max(0, sources.findIndex((s) => s.id === currentSource));
      setHighlight(idx);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, currentSource]);

  // 点击面板外部关闭
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent | TouchEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const id = setTimeout(() => {
      document.addEventListener('mousedown', handler);
      document.addEventListener('touchstart', handler);
    }, 0);
    return () => {
      clearTimeout(id);
      document.removeEventListener('mousedown', handler);
      document.removeEventListener('touchstart', handler);
    };
  }, [open]);

  // 键盘方向键导航
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (!open) return;

      switch (e.key) {
        case 'ArrowRight':
          e.preventDefault();
          setHighlight((p) => Math.min(p + 1, sources.length - 1));
          break;
        case 'ArrowLeft':
          e.preventDefault();
          setHighlight((p) => Math.max(p - 1, 0));
          break;
        case 'ArrowDown':
          e.preventDefault();
          setHighlight((p) => Math.min(p + COLS, sources.length - 1));
          break;
        case 'ArrowUp':
          e.preventDefault();
          setHighlight((p) => Math.max(p - COLS, 0));
          break;
        case 'Enter':
        case ' ': {
          e.preventDefault();
          const target = sources[highlight];
          if (target) {
            onSelect(target.id);
            setOpen(false);
          }
          break;
        }
        case 'Escape':
          e.preventDefault();
          setOpen(false);
          break;
      }
    },
    [open, highlight, sources, onSelect]
  );

  // 高亮项自动滚入视野
  useEffect(() => {
    if (!open || !gridRef.current) return;
    const el = gridRef.current.children[highlight] as HTMLElement;
    if (el) el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [highlight, open]);

  // 移动端长按启动
  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    const y = e.touches[0].clientY;
    touchState.current = { longPressActive: false, startY: y, lastY: y };
    longPressTimer.current = setTimeout(() => {
      touchState.current.longPressActive = true;
    }, LONG_PRESS_MS);
  }, []);

  const handleTouchEnd = useCallback(() => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
    touchState.current.longPressActive = false;
  }, []);

  // 长按后手指拖动 → 手动滚动 grid（React 的 onTouchMove 是 passive，
  // 无法 preventDefault，所以用原生监听 passive:false 覆盖）
  useEffect(() => {
    if (!open || !gridRef.current) return;
    const el = gridRef.current;

    const onMove = (e: TouchEvent) => {
      const y = e.touches[0].clientY;
      // 长按前手指已有明显位移 → 视为普通滑动手势，取消长按计时器
      if (!touchState.current.longPressActive && longPressTimer.current) {
        if (Math.abs(y - touchState.current.startY) > SWIPE_CANCEL_PX) {
          clearTimeout(longPressTimer.current);
          longPressTimer.current = null;
        }
      }
      if (touchState.current.longPressActive) {
        e.preventDefault();
        const dy = touchState.current.lastY - y;
        el.scrollTop += dy * 2;
        touchState.current.lastY = y;
      }
    };

    el.addEventListener('touchmove', onMove, { passive: false });
    return () => el.removeEventListener('touchmove', onMove);
  }, [open]);

  const handleSelect = (id: string) => {
    onSelect(id);
    setOpen(false);
  };

  if (!currentSourceObj) return null;

  return (
    <div className="relative" ref={panelRef}>
      {/* 触发按钮 */}
      <button
        onClick={() => setOpen((v) => !v)}
        className={`
          flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 cursor-pointer
          text-xs md:text-sm font-medium transition-all shadow-sm
          ${
            open
              ? 'bg-black border border-rose-500/70 text-rose-200 ring-1 ring-rose-500/40'
              : 'bg-black border border-slate-700/80 text-slate-200 hover:border-slate-500'
          }
        `}
        title="切换站源（展开 3 列按钮列表）"
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <SlidersHorizontal
          className={`w-3.5 h-3.5 shrink-0 transition-colors ${open ? 'text-rose-400' : 'text-slate-400'}`}
        />
        <span className="max-w-20 md:max-w-36 truncate">{currentSourceObj.name}</span>
        {currentSourceObj.isCustom && (
          <span className="text-[9px] text-amber-500/80 shrink-0">自定义</span>
        )}
        <ChevronDown
          className={`w-3 h-3 shrink-0 transition-transform ${open ? 'rotate-180 text-rose-400' : 'text-slate-400'}`}
        />
      </button>

      {/* 下拉面板 */}
      {open && (
        <div
          className="
            absolute top-full left-0 mt-1 z-50
            w-[17rem] max-w-[calc(100vw-2rem)]
            bg-black
            border border-slate-800 rounded-xl
            shadow-2xl shadow-black/80 ring-1 ring-white/10
            overflow-hidden
          "
          tabIndex={0}
          onKeyDown={handleKeyDown}
          role="listbox"
          aria-label="选择站源"
          autoFocus
        >
          {/* 面板标题 */}
          <div className="flex items-center justify-between px-3 py-2 border-b border-slate-800 bg-black">
            <span className="text-[10px] font-bold text-slate-500 tracking-widest uppercase">
              切换站源
            </span>
            <span className="text-[10px] text-slate-600">{sources.length} 个</span>
          </div>

          {/* 3 列源按钮网格 */}
          <div
            ref={gridRef}
            className="max-h-56 overflow-y-auto p-2"
            onTouchStart={handleTouchStart}
            onTouchEnd={handleTouchEnd}
            onTouchCancel={handleTouchEnd}
          >
            <div className="grid grid-cols-3 gap-1">
              {sources.map((source, idx) => {
                const isActive = source.id === currentSource;
                const isHl = idx === highlight;
                return (
                  <button
                    key={source.id}
                    onClick={() => handleSelect(source.id)}
                    onMouseEnter={() => setHighlight(idx)}
                    className={`
                      group relative flex flex-col items-center justify-center
                      px-1 py-2 rounded-lg text-center transition-all
                      ${
                        isActive
                          ? 'bg-rose-600/30 ring-1 ring-rose-500/80 text-rose-100'
                          : isHl
                            ? 'bg-neutral-800 text-white ring-1 ring-rose-500/40'
                            : 'bg-neutral-950 text-slate-200 hover:bg-neutral-800 hover:text-white'
                      }
                    `}
                    title={`${source.name}${source.isCustom ? '（自定义源）' : ''}`}
                    role="option"
                    aria-selected={isActive}
                  >
                    {/* 当前选中指示 */}
                    {isActive && (
                      <Check className="w-3 h-3 text-rose-300 absolute top-0.5 right-0.5" />
                    )}
                    <Layers
                      className={`w-3.5 h-3.5 mb-0.5 transition-colors ${
                        isActive
                          ? 'text-rose-300'
                          : isHl
                            ? 'text-white'
                            : 'text-slate-400 group-hover:text-slate-200'
                      }`}
                    />
                    <span
                      className="text-[10px] font-medium leading-tight line-clamp-2 w-full px-0.5"
                    >
                      {source.name}
                    </span>
                    {source.isCustom && (
                      <span className="text-[8px] text-amber-500/70 mt-0.5">自定义</span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {/* 操作提示 */}
          <div className="flex items-center gap-2 px-3 py-1.5 border-t border-slate-800 bg-black text-[9px] text-slate-500">
            <span className="flex items-center gap-1">
              <kbd className="px-1 py-0.5 bg-slate-800 rounded text-[8px] border border-slate-700/60">
                ↑↓←→
              </kbd>
              <span>移动</span>
            </span>
            <span className="flex items-center gap-1">
              <kbd className="px-1 py-0.5 bg-slate-800 rounded text-[8px] border border-slate-700/60">
                Enter
              </kbd>
              <span>选择</span>
            </span>
            <span className="ml-auto sm:hidden text-amber-500/50">长按后拖动列表</span>
          </div>
        </div>
      )}
    </div>
  );
};
