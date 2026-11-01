import React from 'react';
import { CATEGORIES } from '../../data/sources';

interface CategoryBarProps {
  selectedCategory: string;
  onSelectCategory: (categoryId: string) => void;
  categories?: { id: string; name: string }[];
}

export const CategoryBar: React.FC<CategoryBarProps> = ({
  selectedCategory,
  onSelectCategory,
  categories = CATEGORIES,
}) => {
  const displayCategories = categories && categories.length > 0 ? categories : CATEGORIES;

  return (
    <div className="relative border-b border-slate-800/80 bg-[#0e111a]/70 backdrop-blur-sm">
      <div className="max-w-7xl mx-auto px-3 md:px-6 py-2.5">
        <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar scroll-smooth">
          {displayCategories.map((cat, idx) => {
            const isSelected = selectedCategory === cat.id;
            return (
              <button
                key={`${cat.id}_${idx}`}
                onClick={() => onSelectCategory(cat.id)}
                className={`px-3.5 py-1 rounded-full text-xs md:text-sm font-medium whitespace-nowrap transition-all duration-200 select-none ${
                  isSelected
                    ? 'bg-rose-600 text-white shadow-md shadow-rose-950/40 scale-105'
                    : 'text-slate-400 hover:text-slate-100 hover:bg-slate-800/80 bg-slate-900/40 border border-slate-800/60'
                }`}
              >
                {cat.name}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
};
