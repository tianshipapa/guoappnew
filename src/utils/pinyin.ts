// Pinyin initials table from U+4E00 to U+9FA5
// Generated from Chinese character pronunciation tables
import { PINYIN_RAW_TABLE } from './pinyinData';

export function getCharPinyinInitial(char: string): string {
  if (!char) return '';
  const code = char.charCodeAt(0);
  // English letters or digits
  if ((code >= 65 && code <= 90) || (code >= 97 && code <= 122) || (code >= 48 && code <= 57)) {
    return char.toLowerCase();
  }
  // Chinese characters U+4E00 to U+9FA5
  if (code >= 0x4e00 && code <= 0x9fa5) {
    const idx = code - 0x4e00;
    if (idx < PINYIN_RAW_TABLE.length) {
      const initial = PINYIN_RAW_TABLE[idx];
      return initial !== '_' ? initial.toLowerCase() : '';
    }
  }
  return '';
}

export function getPinyinInitials(text: string): string {
  if (!text) return '';
  let result = '';
  for (let i = 0; i < text.length; i++) {
    const initial = getCharPinyinInitial(text[i]);
    if (initial) {
      result += initial;
    }
  }
  return result;
}

export function matchesPinyin(text: string, query: string): boolean {
  if (!text || !query) return false;
  const cleanQuery = query.trim().toLowerCase();
  if (!cleanQuery) return true;
  
  // Direct substring match
  if (text.toLowerCase().includes(cleanQuery)) {
    return true;
  }
  
  // Pinyin initials match
  const initials = getPinyinInitials(text);
  if (initials && initials.includes(cleanQuery)) {
    return true;
  }
  
  return false;
}
