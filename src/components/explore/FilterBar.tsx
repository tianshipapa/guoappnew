import React from 'react';
import { ArrowDownUp, Filter, Sparkles } from 'lucide-react';
import { SORT_OPTIONS, RELEASE_STATUS_OPTIONS } from '../../data/sources';

interface FilterBarProps {
  currentSort: string;
  onSelectSort: (sort: string) => void;
  currentStatus: string;
  onSelectStatus: (status: string) => void;
  totalCount: number;
  sourceName?: string;
  sourceDescription?: string;
}

export const FilterBar: React.FC<FilterBarProps> = ({
  currentSort,
  onSelectSort,
  currentStatus,
  onSelectStatus,
  totalCount,
  sourceName = '红果',
  sourceDescription,
}) => {
  return (
    <div className="max-w-7xl mx-auto px-3 md:px-6 pt-4 pb-2">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs md:text-sm text-slate-400">
        {/* Source info tag */}
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-slate-800/80 border border-slate-700/60 text-slate-200">
            <Sparkles className="w-3.5 h-3.5 text-rose-400" />
            <span className="font-semibold">{sourceName}</span>
            {sourceDescription && (
              <span className="text-slate-400 text-xs hidden md:inline">· {sourceDescription}</span>
            )}
          </div>
          <span className="text-xs text-slate-500">共 {totalCount} 部剧目</span>
        </div>

        {/* Sort & Status Controls */}
        <div className="flex items-center gap-2.5 flex-wrap">
          {/* Release status tabs */}
          <div className="flex items-center p-0.5 rounded-lg bg-slate-900 border border-slate-800">
            {RELEASE_STATUS_OPTIONS.map((opt) => (
              <button
                key={opt.id}
                onClick={() => onSelectStatus(opt.id)}
                className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
                  currentStatus === opt.id
                    ? 'bg-slate-800 text-rose-400 font-semibold'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>

          {/* Sort dropdown */}
          <div className="relative">
            <select
              value={currentSort}
              onChange={(e) => onSelectSort(e.target.value)}
              className="bg-slate-900 text-xs font-medium text-slate-300 border border-slate-800 rounded-lg px-2.5 py-1.5 pr-6 appearance-none cursor-pointer focus:outline-none focus:border-rose-500"
            >
              {SORT_OPTIONS.map((opt) => (
                <option key={opt.id} value={opt.id} className="bg-slate-900 text-slate-200">
                  {opt.label}
                </option>
              ))}
            </select>
            <ArrowDownUp className="w-3 h-3 absolute right-2 top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none" />
          </div>
        </div>
      </div>
    </div>
  );
};
