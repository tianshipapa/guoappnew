import React from 'react';
import { Delete, RotateCcw } from 'lucide-react';

interface LetterKeyboardProps {
  value: string;
  onChange: (val: string) => void;
  onSubmit: () => void;
}

const LETTERS = [
  'A', 'B', 'C', 'D', 'E', 'F',
  'G', 'H', 'I', 'J', 'K', 'L',
  'M', 'N', 'O', 'P', 'Q', 'R',
  'S', 'T', 'U', 'V', 'W', 'X',
  'Y', 'Z', '1', '2', '3', '4',
  '5', '6', '7', '8', '9', '0',
];

export const LetterKeyboard: React.FC<LetterKeyboardProps> = ({
  value,
  onChange,
  onSubmit,
}) => {
  const handleKeyClick = (char: string) => {
    onChange(value + char);
  };

  const handleBackspace = () => {
    if (value.length > 0) {
      onChange(value.slice(0, -1));
    }
  };

  const handleClear = () => {
    onChange('');
  };

  return (
    <div className="bg-slate-900/95 border border-slate-800 rounded-2xl p-3 shadow-xl">
      <div className="flex items-center justify-between pb-2 mb-2 border-b border-slate-800 text-xs text-slate-400">
        <span className="font-semibold text-slate-300">电视 / 拼音首字母键盘</span>
        <span className="text-[11px] text-slate-500">例如：输入 BDZC 搜「霸道总裁」</span>
      </div>

      <div className="grid grid-cols-6 gap-1.5 sm:gap-2">
        {LETTERS.map((char) => (
          <button
            key={char}
            type="button"
            onClick={() => handleKeyClick(char)}
            className="py-2.5 sm:py-3 rounded-lg bg-slate-800 hover:bg-slate-700 active:bg-rose-600 text-slate-100 font-bold text-sm sm:text-base border border-slate-700/60 hover:border-slate-500 transition-all select-none"
          >
            {char}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-3 gap-2 mt-2">
        <button
          type="button"
          onClick={handleBackspace}
          className="py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 font-medium text-xs flex items-center justify-center gap-1 border border-slate-700 transition-colors"
        >
          <Delete className="w-3.5 h-3.5" />
          <span>退格</span>
        </button>

        <button
          type="button"
          onClick={handleClear}
          className="py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 font-medium text-xs flex items-center justify-center gap-1 border border-slate-700 transition-colors"
        >
          <RotateCcw className="w-3.5 h-3.5" />
          <span>清空</span>
        </button>

        <button
          type="button"
          onClick={onSubmit}
          className="py-2 rounded-lg bg-rose-600 hover:bg-rose-500 text-white font-bold text-xs transition-colors shadow-md shadow-rose-950/40"
        >
          确定搜索
        </button>
      </div>
    </div>
  );
};
