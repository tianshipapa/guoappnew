import React from 'react';
import { Eye, EyeOff, X, Check } from 'lucide-react';
import { SourceSite } from '../../types';

interface SourceVisibilityModalProps {
  isOpen: boolean;
  onClose: () => void;
  allSources: SourceSite[];
  visibilityMap: Record<string, boolean>;
  onToggleVisibility: (sourceId: string, visible: boolean) => void;
  onEnableAll: () => void;
}

export const SourceVisibilityModal: React.FC<SourceVisibilityModalProps> = ({
  isOpen,
  onClose,
  allSources,
  visibilityMap,
  onToggleVisibility,
  onEnableAll,
}) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-3 sm:p-4">
      <div className="bg-[#121624] border border-slate-800 rounded-2xl w-full max-w-xl max-h-[85vh] flex flex-col shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-200">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-slate-800 shrink-0">
          <div className="flex items-center gap-2">
            <div className="p-2 rounded-lg bg-sky-500/20 text-sky-400">
              <Eye className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-100">站源显示列表</h2>
              <p className="text-xs text-slate-400">控制首页及搜索栏中展示的站源选项</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content list */}
        <div className="flex-1 overflow-y-auto p-4 divide-y divide-slate-800/60">
          {allSources.map((source) => {
            const isVisible = visibilityMap[source.id] !== false;
            return (
              <div
                key={source.id}
                className="py-2.5 flex items-center justify-between gap-3"
              >
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-slate-100">{source.name}</span>
                    <span className="text-[10px] text-slate-500 font-mono">({source.id})</span>
                  </div>
                  <p className="text-xs text-slate-400 mt-0.5">{source.description}</p>
                </div>

                <button
                  type="button"
                  onClick={() => onToggleVisibility(source.id, !isVisible)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-colors ${
                    isVisible
                      ? 'bg-rose-600 text-white shadow-sm'
                      : 'bg-slate-800 text-slate-500 border border-slate-700'
                  }`}
                >
                  {isVisible ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
                  <span>{isVisible ? '显示中' : '已隐藏'}</span>
                </button>
              </div>
            );
          })}
        </div>

        {/* Footer */}
        <div className="p-4 bg-slate-900/60 border-t border-slate-800 flex items-center justify-between shrink-0">
          <button
            onClick={onEnableAll}
            className="text-xs text-rose-400 hover:text-rose-300 font-medium"
          >
            一键全部开启
          </button>
          <button
            onClick={onClose}
            className="px-4 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-white text-xs font-semibold transition-colors"
          >
            完成
          </button>
        </div>
      </div>
    </div>
  );
};
