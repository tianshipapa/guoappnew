import React from 'react';
import {
  Settings,
  X,
  Play,
  Sparkles,
  HardDrive,
  Info,
  Keyboard,
  Trash2,
  Bookmark,
  History,
  Layers,
  Eye,
  ChevronRight,
} from 'lucide-react';
import { UserSettings } from '../../types';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  settings: UserSettings;
  onUpdateSettings: (settings: UserSettings) => void;
  historyCount: number;
  favoritesCount: number;
  customSourcesCount: number;
  onClearStorage: () => void;
  /** 收藏夹（内含播放历史）/ 自定义源 / 源显示 统一从设置进入 */
  onOpenLibrary: (section: 'favorites' | 'history') => void;
  onOpenCustomSources: () => void;
  onOpenSourceVisibility: () => void;
  visibleSourcesCount: number;
  totalSourcesCount: number;
}

const ACCENT_COLORS = [
  { id: '#f43f5e', name: '红果玫瑰红 (默认)' },
  { id: '#f59e0b', name: '真果琥珀金' },
  { id: '#0ea5e9', name: '晴空天际蓝' },
  { id: '#10b981', name: '青翠翡翠绿' },
  { id: '#8b5cf6', name: '幻夜极光紫' },
];

export const SettingsModal: React.FC<SettingsModalProps> = ({
  isOpen,
  onClose,
  settings,
  onUpdateSettings,
  historyCount,
  favoritesCount,
  customSourcesCount,
  onClearStorage,
  onOpenLibrary,
  onOpenCustomSources,
  onOpenSourceVisibility,
  visibleSourcesCount,
  totalSourcesCount,
}) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-3 sm:p-4">
      <div className="bg-[#121624] border border-slate-800 rounded-2xl w-full max-w-2xl max-h-[90vh] flex flex-col shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-200">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-slate-800 shrink-0">
          <div className="flex items-center gap-2">
            <div className="p-2 rounded-lg bg-slate-800 text-rose-400">
              <Settings className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-100">设置</h2>
              <p className="text-xs text-slate-400">收藏夹、播放历史、站源与播放参数</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4 space-y-6 text-xs sm:text-sm">
          {/* Section: Library & Sources（收藏夹 / 播放历史 / 自定义源 / 源显示） */}
          <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-4 space-y-2">
            <h3 className="text-xs font-bold text-slate-200 flex items-center gap-1.5 pb-2 border-b border-slate-800">
              <Bookmark className="w-4 h-4 text-emerald-400" />
              <span>内容与站源</span>
            </h3>

            <button
              type="button"
              onClick={() => onOpenLibrary('favorites')}
              className="w-full flex items-center gap-3 px-1 py-2 rounded-lg hover:bg-slate-800/60 transition-colors text-left"
            >
              <div className="p-2 rounded-lg bg-rose-500/15 text-rose-400 shrink-0">
                <Bookmark className="w-4 h-4" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="font-semibold text-slate-100">我的收藏夹</div>
                <div className="text-[11px] text-slate-400">
                  共 {favoritesCount} 部 · 支持续播、追剧状态管理
                </div>
              </div>
              <ChevronRight className="w-4 h-4 text-slate-500 shrink-0" />
            </button>

            <button
              type="button"
              onClick={() => onOpenLibrary('history')}
              className="w-full flex items-center gap-3 px-1 py-2 rounded-lg hover:bg-slate-800/60 transition-colors text-left"
            >
              <div className="p-2 rounded-lg bg-indigo-500/15 text-indigo-400 shrink-0">
                <History className="w-4 h-4" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="font-semibold text-slate-100">播放历史</div>
                <div className="text-[11px] text-slate-400">
                  共 {historyCount} 条 · 已并入收藏夹，按进度续播
                </div>
              </div>
              <ChevronRight className="w-4 h-4 text-slate-500 shrink-0" />
            </button>

            <button
              type="button"
              onClick={onOpenCustomSources}
              className="w-full flex items-center gap-3 px-1 py-2 rounded-lg hover:bg-slate-800/60 transition-colors text-left"
            >
              <div className="p-2 rounded-lg bg-amber-500/15 text-amber-400 shrink-0">
                <Layers className="w-4 h-4" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="font-semibold text-slate-100">自定义源</div>
                <div className="text-[11px] text-slate-400">
                  已添加 {customSourcesCount} 个 XBPQ / MacCMS 站源
                </div>
              </div>
              <ChevronRight className="w-4 h-4 text-slate-500 shrink-0" />
            </button>

            <button
              type="button"
              onClick={onOpenSourceVisibility}
              className="w-full flex items-center gap-3 px-1 py-2 rounded-lg hover:bg-slate-800/60 transition-colors text-left"
            >
              <div className="p-2 rounded-lg bg-sky-500/15 text-sky-400 shrink-0">
                <Eye className="w-4 h-4" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="font-semibold text-slate-100">源显示</div>
                <div className="text-[11px] text-slate-400">
                  当前显示 {visibleSourcesCount}/{totalSourcesCount} 个站源
                </div>
              </div>
              <ChevronRight className="w-4 h-4 text-slate-500 shrink-0" />
            </button>
          </div>

          {/* Section: Playback */}
          <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-4 space-y-4">
            <h3 className="text-xs font-bold text-slate-200 flex items-center gap-1.5 pb-2 border-b border-slate-800">
              <Play className="w-4 h-4 text-rose-400" />
              <span>播放器设置</span>
            </h3>

            {/* Auto Next */}
            <div className="flex items-center justify-between">
              <div>
                <div className="font-semibold text-slate-100">自动连播下一集</div>
                <div className="text-[11px] text-slate-400">本集播放完毕后无缝衔接下一集</div>
              </div>
              <input
                type="checkbox"
                checked={settings.autoNext}
                onChange={(e) =>
                  onUpdateSettings({ ...settings, autoNext: e.target.checked })
                }
                className="w-5 h-5 rounded text-rose-500 bg-slate-800 border-slate-700 cursor-pointer"
              />
            </div>

            {/* Ad block */}
            <div className="flex items-center justify-between">
              <div>
                <div className="font-semibold text-slate-100">去广告与跳过片头片尾</div>
                <div className="text-[11px] text-slate-400">自动过滤源站贴片广告并定位精彩剧情</div>
              </div>
              <input
                type="checkbox"
                checked={settings.adBlock}
                onChange={(e) =>
                  onUpdateSettings({ ...settings, adBlock: e.target.checked })
                }
                className="w-5 h-5 rounded text-rose-500 bg-slate-800 border-slate-700 cursor-pointer"
              />
            </div>

            {/* Playback rate */}
            <div className="flex items-center justify-between">
              <div>
                <div className="font-semibold text-slate-100">默认播放倍速</div>
                <div className="text-[11px] text-slate-400">换集重开时保留选定的播放速率</div>
              </div>
              <select
                value={settings.playbackRate}
                onChange={(e) =>
                  onUpdateSettings({ ...settings, playbackRate: parseFloat(e.target.value) })
                }
                className="bg-slate-800 border border-slate-700 rounded-lg px-2.5 py-1 text-xs text-slate-200"
              >
                {[0.5, 0.75, 1.0, 1.25, 1.5, 2.0, 3.0].map((rate) => (
                  <option key={rate} value={rate}>
                    {rate}x
                  </option>
                ))}
              </select>
            </div>

            {/* Picture Sharpen Filter */}
            <div className="space-y-2 pt-2 border-t border-slate-800">
              <div className="flex items-center justify-between">
                <div>
                  <div className="font-semibold text-slate-100 flex items-center gap-1.5">
                    <Sparkles className="w-3.5 h-3.5 text-amber-400" />
                    <span>画面清晰度锐化增强</span>
                  </div>
                  <div className="text-[11px] text-slate-400">
                    提升剧目画面边缘锐度与动态对比度
                  </div>
                </div>
                <input
                  type="checkbox"
                  checked={settings.pictureQuality.mode === 'sharpen'}
                  onChange={(e) =>
                    onUpdateSettings({
                      ...settings,
                      pictureQuality: {
                        ...settings.pictureQuality,
                        mode: e.target.checked ? 'sharpen' : 'original',
                      },
                    })
                  }
                  className="w-5 h-5 rounded text-rose-500 bg-slate-800 border-slate-700 cursor-pointer"
                />
              </div>

              {settings.pictureQuality.mode === 'sharpen' && (
                <div className="flex items-center gap-3 pt-1">
                  <span className="text-[11px] text-slate-400">增强强度:</span>
                  <input
                    type="range"
                    min={0}
                    max={100}
                    value={settings.pictureQuality.strength}
                    onChange={(e) =>
                      onUpdateSettings({
                        ...settings,
                        pictureQuality: {
                          ...settings.pictureQuality,
                          strength: parseInt(e.target.value, 10),
                        },
                      })
                    }
                    className="flex-1 h-1.5 bg-slate-700 rounded appearance-none accent-rose-500 cursor-pointer"
                  />
                  <span className="text-xs font-mono text-rose-400 w-8 text-right">
                    {settings.pictureQuality.strength}%
                  </span>
                </div>
              )}
            </div>

            {/* TV Letter Keyboard Mode */}
            <div className="flex items-center justify-between pt-2 border-t border-slate-800">
              <div>
                <div className="font-semibold text-slate-100 flex items-center gap-1.5">
                  <Keyboard className="w-3.5 h-3.5 text-sky-400" />
                  <span>搜索默认开启字母键盘</span>
                </div>
                <div className="text-[11px] text-slate-400">
                  适配电视遥控器操作与拼音首字母快速输入
                </div>
              </div>
              <input
                type="checkbox"
                checked={settings.tvLetterKeyboard}
                onChange={(e) =>
                  onUpdateSettings({ ...settings, tvLetterKeyboard: e.target.checked })
                }
                className="w-5 h-5 rounded text-rose-500 bg-slate-800 border-slate-700 cursor-pointer"
              />
            </div>
          </div>

          {/* Section: Storage & Cache */}
          <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-4 space-y-3">
            <h3 className="text-xs font-bold text-slate-200 flex items-center gap-1.5 pb-2 border-b border-slate-800">
              <HardDrive className="w-4 h-4 text-emerald-400" />
              <span>本地存储与缓存</span>
            </h3>

            <div className="grid grid-cols-3 gap-2 text-center">
              <div className="p-2.5 rounded-lg bg-slate-800/60 border border-slate-700/60">
                <div className="text-lg font-bold text-rose-400">{historyCount}</div>
                <div className="text-[11px] text-slate-400 mt-0.5">观看记录</div>
              </div>
              <div className="p-2.5 rounded-lg bg-slate-800/60 border border-slate-700/60">
                <div className="text-lg font-bold text-emerald-400">{favoritesCount}</div>
                <div className="text-[11px] text-slate-400 mt-0.5">我的追剧</div>
              </div>
              <div className="p-2.5 rounded-lg bg-slate-800/60 border border-slate-700/60">
                <div className="text-lg font-bold text-sky-400">{customSourcesCount}</div>
                <div className="text-[11px] text-slate-400 mt-0.5">自定义站源</div>
              </div>
            </div>

            <div className="pt-2 flex justify-end">
              <button
                type="button"
                onClick={onClearStorage}
                className="px-3.5 py-1.5 rounded-lg bg-rose-600/20 text-rose-400 border border-rose-500/30 hover:bg-rose-600 hover:text-white text-xs font-semibold flex items-center gap-1.5 transition-colors"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>清空本地历史与缓存</span>
              </button>
            </div>
          </div>

          {/* Section: About & Disclaimer */}
          <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-4 space-y-2">
            <h3 className="text-xs font-bold text-slate-200 flex items-center gap-1.5">
              <Info className="w-4 h-4 text-sky-400" />
              <span>关于短剧视界 (HongGuoJian / ZhenGuoJian)</span>
            </h3>
            <p className="text-xs text-slate-400 leading-relaxed">
              版本：1.2.2+107 · 跨平台多端独立短剧与影视聚合播放器。
            </p>
            <p className="text-[11px] text-slate-500 leading-relaxed pt-1 border-t border-slate-800">
              免责声明：站源可用性、清晰度和区域限制取决于各数据源站及网络，本项目不破解、不解除源站 VIP 或其他授权限制，仅供个人技术测试使用。
            </p>
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 bg-slate-900/60 border-t border-slate-800 flex justify-end shrink-0">
          <button
            onClick={onClose}
            className="px-5 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold shadow-md shadow-rose-950/40 transition-colors"
          >
            保存并返回
          </button>
        </div>
      </div>
    </div>
  );
};
