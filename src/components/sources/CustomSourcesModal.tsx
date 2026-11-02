import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Plus,
  Trash2,
  CheckCircle2,
  AlertCircle,
  X,
  Globe,
  Wifi,
  FileCode,
  Download,
  Upload,
  Check,
  Link,
  Loader2,
  Layers,
  RotateCcw,
  Pencil,
  FolderOpen,
  ClipboardPaste,
  ServerCog,
  Plug,
} from 'lucide-react';
import { CustomSourceSite } from '../../types';
import { apiService } from '../../services/api';
import { nativeCore, isCoreOnline, DEFAULT_CORE_BASE } from '../../services/nativeCore';
import { normalizeGitHubUrl } from '../../data/xbpqSamples';

interface CustomSourcesModalProps {
  isOpen: boolean;
  onClose: () => void;
  customSources: CustomSourceSite[];
  /** silent=true 时不自动切换当前站源（批量导入用）。 */
  onSaveSource: (source: CustomSourceSite, options?: { silent?: boolean }) => void;
  onDeleteSource: (id: string) => void;
  /** 恢复默认源：清空全部自定义源，只保留内置源。 */
  onResetSources: () => void;
}

type SourceKind = 'auto' | 'web' | 'json' | 'xml';
type View = 'list' | 'editor' | 'import';
type ImportTab = 'url' | 'file' | 'paste';

const KIND_OPTIONS: { value: SourceKind; label: string; hint: string }[] = [
  { value: 'auto', label: '自动（推荐）', hint: '由服务端按站点形态探测：XBPQ 规则优先，其余按 MacCMS 处理' },
  { value: 'web', label: '网页源（HTML 抓取）', hint: '抓 HTML 后按规则截取，适合普通影视站' },
  { value: 'json', label: 'JSON 源（直连接口）', hint: 'api.php/provide/vod 这类苹果CMS 接口' },
  { value: 'xml', label: 'XML 源', hint: '返回 XML 的采集接口' },
];

/** 与 guoappxp 保持一致的两个默认订阅地址（加速链接 + 真实地址拼接形态）。 */
const IMPORT_PRESETS = [
  {
    name: '网页',
    url:
      'https://cfkua.wokaotianshi.eu.org/https://raw.githubusercontent.com/' +
      'wokaotianshi123/wokaotianshi123.github.io/refs/heads/main/hongguo/config.json',
  },
  {
    name: '采集',
    url:
      'https://cfkua.wokaotianshi.eu.org/https://raw.githubusercontent.com/' +
      'wokaotianshi123/jgcj/refs/heads/main/hongguo.json',
  },
];

/** 从规则文本里嗅出 name / url，用于自动补全表单。 */
function peekRuleIdentity(text: string): { name?: string; url?: string } {
  try {
    const parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return {
      name: typeof parsed.name === 'string' ? parsed.name : undefined,
      url:
        typeof parsed.url === 'string'
          ? parsed.url
          : typeof parsed['主页url'] === 'string'
            ? parsed['主页url']
            : undefined,
    };
  } catch {
    return {};
  }
}

function safeHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return '自定义源';
  }
}

function normBase(value: string): string {
  return String(value || '').trim().toLowerCase().replace(/\/+$/, '');
}

/** 识别本应用导出的备份文件（保留 id / 启用状态，导入后可原样还原）。 */
function parseLocalBackup(text: string): CustomSourceSite[] | null {
  let parsed: any;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  const list = Array.isArray(parsed) ? parsed : parsed?.sites;
  if (!Array.isArray(list) || !list.length) return null;
  const looksOurs = list.every(
    (item) =>
      item &&
      typeof item === 'object' &&
      typeof item.base === 'string' &&
      (item.createdAt || item.kind || item.enabled !== undefined)
  );
  if (!looksOurs) return null;
  return list.map((item: any, index: number) => ({
    id: String(item.id || `custom:${Date.now()}_${index}`),
    name: String(item.name || safeHost(item.base)),
    base: String(item.base || ''),
    kind: item.kind || 'xbpq',
    rule: typeof item.rule === 'string' ? item.rule : '',
    xbpqRule: item.xbpqRule,
    enabled: item.enabled !== false,
    createdAt: Number(item.createdAt) || Date.now(),
  }));
}

export const CustomSourcesModal: React.FC<CustomSourcesModalProps> = ({
  isOpen,
  onClose,
  customSources,
  onSaveSource,
  onDeleteSource,
  onResetSources,
}) => {
  const [view, setView] = useState<View>('list');

  // 编辑器
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [base, setBase] = useState('');
  const [kind, setKind] = useState<SourceKind>('auto');
  const [ruleMode, setRuleMode] = useState(false);
  const [ruleText, setRuleText] = useState('');
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);

  // 导入
  const [importTab, setImportTab] = useState<ImportTab>('url');
  const [remoteUrl, setRemoteUrl] = useState('');
  const [pasteText, setPasteText] = useState('');
  const [importing, setImporting] = useState(false);
  const [notice, setNotice] = useState<{ ok: boolean; text: string; details?: string[] } | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  // 导出 / 恢复
  const [copied, setCopied] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<CustomSourceSite | null>(null);

  // 本机服务状态
  const [coreOnline, setCoreOnline] = useState<boolean | null>(null);
  const [coreBaseInput, setCoreBaseInput] = useState(nativeCore.base || DEFAULT_CORE_BASE);

  const kindHint = useMemo(
    () => KIND_OPTIONS.find((item) => item.value === kind)?.hint || '',
    [kind]
  );

  useEffect(() => {
    if (!isOpen) return;
    let alive = true;
    setView('list');
    setNotice(null);
    setConfirmReset(false);
    setCoreBaseInput(nativeCore.base || DEFAULT_CORE_BASE);
    setCoreOnline(null);
    isCoreOnline(true).then((ok) => {
      if (alive) setCoreOnline(ok);
    });
    return () => {
      alive = false;
    };
  }, [isOpen]);

  if (!isOpen) return null;

  const openNewEditor = () => {
    setEditingId(null);
    setName('');
    setBase('');
    setKind('auto');
    setRuleMode(false);
    setRuleText('');
    setTestResult(null);
    setView('editor');
  };

  const openEdit = (source: CustomSourceSite) => {
    setEditingId(source.id);
    setName(source.name);
    setBase(source.base);
    setKind((source.kind as SourceKind) || 'auto');
    setRuleMode(Boolean(source.rule || source.xbpqRule));
    setRuleText(
      source.rule ||
        (source.xbpqRule ? JSON.stringify(source.xbpqRule, null, 2) : '')
    );
    setTestResult(null);
    setView('editor');
  };

  const handleRuleChange = (text: string) => {
    setRuleText(text);
    const identity = peekRuleIdentity(text);
    if (identity.name && !name) setName(identity.name);
    if (identity.url && !base) setBase(identity.url);
  };

  const requestBody = () => {
    const trimmed = ruleText.trim();
    let parsedRule: any = undefined;
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      parsedRule = JSON.parse(trimmed);
    }
    return { trimmed, parsedRule };
  };

  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const { trimmed, parsedRule } = requestBody();
      if (ruleMode && !parsedRule) {
        setTestResult({ ok: false, message: '规则 JSON 语法不合法，请检查括号与引号' });
        return;
      }
      const result = await apiService.testCustomSource({
        base: base.trim(),
        kind: kind === 'auto' ? 'xbpq' : kind,
        rule: trimmed,
        xbpqRule: parsedRule,
      });
      setTestResult(result);
    } catch (error: any) {
      setTestResult({ ok: false, message: error?.message || '校验失败' });
    } finally {
      setTesting(false);
    }
  };

  const handleSave = () => {
    let parsedRule: any = undefined;
    const trimmed = ruleText.trim();

    if (trimmed) {
      if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
        try {
          parsedRule = JSON.parse(trimmed);
        } catch (error: any) {
          setTestResult({ ok: false, message: `请检查规则 JSON 格式：${error.message}` });
          return;
        }
      } else {
        setTestResult({ ok: false, message: '规则必须是 JSON 对象文本' });
        return;
      }
    }

    if (ruleMode && !parsedRule) {
      setTestResult({ ok: false, message: '开启规则模式后需要粘贴 XBPQ 规则 JSON' });
      return;
    }

    const identity = parsedRule ? peekRuleIdentity(trimmed) : {};
    const targetBase = base.trim() || identity.url || '';
    const targetName = name.trim() || identity.name || (targetBase ? safeHost(targetBase) : '');
    const effectiveKind: CustomSourceSite['kind'] =
      parsedRule ? 'xbpq' : kind === 'auto' ? 'web' : (kind as CustomSourceSite['kind']);

    if (!targetBase && !parsedRule) {
      setTestResult({ ok: false, message: '请填写源网址（或粘贴带「主页url」的规则）' });
      return;
    }
    if (!targetName) {
      setTestResult({ ok: false, message: '请填写源名称' });
      return;
    }

    onSaveSource({
      id: editingId || `custom:${Date.now()}`,
      name: targetName,
      base: targetBase || 'https://xbpq-rule.local',
      kind: effectiveKind,
      rule: trimmed,
      xbpqRule: parsedRule,
      enabled: true,
      createdAt: Date.now(),
    });

    setView('list');
    setNotice({ ok: true, text: editingId ? `已更新「${targetName}」` : `已加入「${targetName}」` });
    setEditingId(null);
    setName('');
    setBase('');
    setRuleText('');
    setRuleMode(false);
    setTestResult(null);
  };

  /** 合并导入：按 id / 站址 / 名称去重，命中则更新。 */
  const ingestDrafts = (drafts: CustomSourceSite[]) => {
    const working = customSources.map((item) => ({ ...item }));
    const details: string[] = [];
    let added = 0;
    let updated = 0;
    let skipped = 0;

    drafts.forEach((draft, index) => {
      const rawRule = (draft.rule || '').trim();
      let parsedRule: any = draft.xbpqRule;
      if (!parsedRule && (rawRule.startsWith('{') || rawRule.startsWith('['))) {
        try {
          parsedRule = JSON.parse(rawRule);
        } catch {
          parsedRule = undefined;
        }
      }

      const candidate: CustomSourceSite = {
        ...draft,
        id: draft.id || `custom:${Date.now()}_${index}`,
        name: draft.name || safeHost(draft.base),
        base: draft.base || '',
        kind: draft.kind || (parsedRule ? 'xbpq' : 'json'),
        rule: rawRule,
        xbpqRule: parsedRule,
        enabled: draft.enabled !== false,
        createdAt: draft.createdAt || Date.now(),
      };

      if (!candidate.name && !candidate.base) {
        skipped += 1;
        return;
      }

      const hitIndex = working.findIndex(
        (item) =>
          item.id === candidate.id ||
          (normBase(item.base) && normBase(item.base) === normBase(candidate.base)) ||
          (item.name && item.name === candidate.name)
      );

      if (hitIndex >= 0) {
        const previous = working[hitIndex];
        working[hitIndex] = {
          ...previous,
          ...candidate,
          id: previous.id,
          createdAt: previous.createdAt,
          enabled: previous.enabled,
        };
        updated += 1;
        details.push(`更新：${working[hitIndex].name}`);
      } else {
        working.push(candidate);
        added += 1;
        details.push(`新增：${candidate.name}`);
      }
    });

    // 批量写入时不让 App 自动切站源，避免导入 20 个源后停在最后一个
    working.forEach((item) => onSaveSource(item, { silent: true }));
    if (skipped) details.push(`跳过 ${skipped} 条无法识别的内容`);
    return { added, updated, details };
  };

  const runImport = async (loader: () => Promise<CustomSourceSite[]>) => {
    setImporting(true);
    setNotice(null);
    try {
      const drafts = await loader();
      if (!drafts.length) {
        setNotice({ ok: false, text: '没有识别到有效站源，请确认是 TVBox / guoappxp 的配置格式' });
        return;
      }
      const result = ingestDrafts(drafts);
      const shown = result.details.slice(0, 6);
      if (result.details.length > shown.length) {
        shown.push(`…另有 ${result.details.length - shown.length} 条`);
      }
      setNotice({
        ok: true,
        text: `导入完成：新增 ${result.added} 个，更新 ${result.updated} 个`,
        details: shown,
      });
      setRemoteUrl('');
      setPasteText('');
    } catch (error: any) {
      setNotice({ ok: false, text: `${error?.message || '未知错误'}` });
    } finally {
      setImporting(false);
    }
  };

  const importFromUrl = () =>
    runImport(async () => {
      const target = normalizeGitHubUrl(remoteUrl.trim());
      const result = await apiService.subscribeSources(target);
      return result.drafts;
    });

  const importFromText = (text: string) =>
    runImport(async () => {
      const backup = parseLocalBackup(text);
      if (backup) return backup;
      return apiService.importSources(text);
    });

  const handleFilePick = async (file: File | null) => {
    if (!file) return;
    if (file.size > 8 * 1024 * 1024) {
      setNotice({ ok: false, text: '导入文件过大（上限 8MB）' });
      return;
    }
    try {
      const text = await file.text();
      await importFromText(text);
    } catch {
      setNotice({ ok: false, text: '文件不是有效的 UTF-8 文本' });
    }
  };

  const buildExport = () =>
    JSON.stringify(
      {
        app: 'guoappnew',
        version: 1,
        exportedAt: new Date().toISOString(),
        sites: customSources,
      },
      null,
      2
    );

  const handleExportFile = () => {
    if (!customSources.length) {
      setNotice({ ok: false, text: '还没有可导出的自定义源' });
      return;
    }
    const blob = new Blob([buildExport()], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `duanju-custom-sources-${new Date().toISOString().slice(0, 10)}.json`;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 200);
    setNotice({ ok: true, text: `已导出 ${customSources.length} 个自定义源` });
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(buildExport());
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      setNotice({ ok: false, text: '浏览器拒绝写入剪贴板，请改用「导出文件」' });
    }
  };

  const handleReset = () => {
    onResetSources();
    setConfirmReset(false);
    setNotice({ ok: true, text: '已恢复默认源，仅保留内置源' });
  };

  const applyCoreBase = async () => {
    const value = coreBaseInput.trim().replace(/\/+$/, '');
    nativeCore.setBase(value);
    setCoreOnline(null);
    setCoreOnline(await isCoreOnline(true));
  };

  const busy = importing;

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-3 sm:p-4">
      <div className="relative bg-black border border-slate-800 rounded-2xl w-full max-w-2xl max-h-[92vh] flex flex-col shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-slate-800 shrink-0 gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <div className="p-2 rounded-lg bg-rose-500/20 text-rose-400 shrink-0">
              <FileCode className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <h2 className="text-base font-bold text-slate-100 flex items-center gap-2">
                <span>自定义源</span>
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-rose-500/20 text-rose-300 border border-rose-500/30 whitespace-nowrap">
                  本地抓取
                </span>
              </h2>
              <p className="text-xs text-slate-400 truncate">
                XBPQ 规则解析、模板补全、在线探测全部在本机服务完成，不受浏览器跨域限制
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            <button
              onClick={() => {
                setView(view === 'import' ? 'list' : 'import');
                setNotice(null);
              }}
              className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium flex items-center gap-1 transition-colors"
              title="从文件、订阅地址或粘贴文本导入"
            >
              <Upload className="w-3.5 h-3.5" />
              <span>导入</span>
            </button>
            <button
              onClick={handleExportFile}
              disabled={!customSources.length}
              className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-slate-200 text-xs font-medium flex items-center gap-1 transition-colors"
              title="导出所有自定义源为 JSON 文件"
            >
              <Download className="w-3.5 h-3.5" />
              <span>导出</span>
            </button>
            <button
              onClick={() => setConfirmReset(true)}
              disabled={!customSources.length}
              className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-amber-600/80 disabled:opacity-40 text-slate-200 text-xs font-medium flex items-center gap-1 transition-colors"
              title="删除全部自定义源，仅保留内置源"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>恢复默认源</span>
            </button>
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 ml-0.5"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* 本机服务状态 */}
        <div className="px-4 py-2 border-b border-slate-800 bg-black shrink-0 text-[11px]">
          {coreOnline === null ? (
            <div className="flex items-center gap-2 text-slate-400">
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              <span>正在检测本机抓取服务…</span>
            </div>
          ) : coreOnline ? (
            <div className="flex items-center gap-2 text-emerald-400">
              <CheckCircle2 className="w-3.5 h-3.5" />
              <span className="truncate">
                已连接本机抓取服务：{nativeCore.base || window.location.origin}
              </span>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-2 text-amber-300">
              <AlertCircle className="w-3.5 h-3.5 shrink-0" />
              <span>
                未连接抓取服务。云端部署请确认 <code className="mx-1 px-1 rounded bg-slate-800 text-amber-200">api/</code>（Vercel）或
                <code className="mx-1 px-1 rounded bg-slate-800 text-amber-200">functions/</code>（Cloudflare）已随前端一起发布；本地请运行
                <code className="mx-1 px-1 rounded bg-slate-800 text-amber-200">npm run serve</code>。
              </span>
              <div className="flex items-center gap-1.5 ml-auto">
                <input
                  value={coreBaseInput}
                  onChange={(e) => setCoreBaseInput(e.target.value)}
                  className="w-44 bg-slate-800 border border-slate-700 rounded-md px-2 py-1 text-[11px] text-slate-200 font-mono focus:outline-none focus:border-rose-500"
                  placeholder="留空＝跟随当前站点（同源）"
                />
                <button
                  onClick={() => void applyCoreBase()}
                  className="px-2 py-1 rounded-md bg-sky-600 hover:bg-sky-500 text-white text-[11px] font-semibold flex items-center gap-1"
                >
                  <Plug className="w-3 h-3" />
                  连接
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4 text-xs">
          {notice && (
            <div
              className={`p-2.5 rounded-lg border text-xs flex items-start gap-2 ${
                notice.ok
                  ? 'bg-emerald-500/15 border-emerald-500/30 text-emerald-300'
                  : 'bg-rose-500/15 border-rose-500/30 text-rose-300'
              }`}
            >
              {notice.ok ? (
                <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
              ) : (
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              )}
              <div className="min-w-0">
                <p className="break-all leading-relaxed">{notice.text}</p>
                {notice.details?.length ? (
                  <ul className="mt-1 space-y-0.5 text-[11px] opacity-80">
                    {notice.details.map((line) => (
                      <li key={line} className="truncate">
                        · {line}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
              <button
                onClick={() => setNotice(null)}
                className="ml-auto shrink-0 text-slate-400 hover:text-white"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          )}

          {confirmReset && (
            <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-200 space-y-2">
              <p className="font-semibold flex items-center gap-1.5">
                <RotateCcw className="w-3.5 h-3.5" />
                恢复默认源
              </p>
              <p className="text-[11px] leading-relaxed">
                将删除全部自定义源（含 XBPQ 规则），仅保留内置源。此操作不可撤销，建议先「导出」备份。
              </p>
              <div className="flex items-center gap-2">
                <button
                  onClick={handleReset}
                  className="px-3 py-1 rounded-lg bg-amber-600 hover:bg-amber-500 text-white text-[11px] font-semibold"
                >
                  确认恢复
                </button>
                <button
                  onClick={() => setConfirmReset(false)}
                  className="px-3 py-1 rounded-lg bg-slate-800 text-slate-300 text-[11px]"
                >
                  取消
                </button>
              </div>
            </div>
          )}

          {/* ---------------- 列表 ---------------- */}
          {view === 'list' && (
            <>
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-bold text-slate-300 flex items-center gap-1.5">
                  <Layers className="w-3.5 h-3.5 text-slate-500" />
                  已生效的自定义站源（{customSources.length}）
                </h3>
                <button
                  onClick={openNewEditor}
                  className="px-2.5 py-1 rounded-lg bg-rose-600 hover:bg-rose-500 text-white text-xs font-semibold flex items-center gap-1 shadow-sm"
                >
                  <Plus className="w-3.5 h-3.5" />
                  新增
                </button>
              </div>

              {customSources.length === 0 ? (
                <div className="text-center py-8 bg-slate-900/40 rounded-xl border border-slate-800 space-y-1.5">
                  <p className="text-xs text-slate-400">还没有自定义源</p>
                  <p className="text-[11px] text-slate-500 leading-relaxed px-6">
                    点「新增」填 MacCMS 站点地址或粘贴 XBPQ 规则；也可以「导入」文件 / 订阅地址批量添加，
                    「导出」做备份迁移。
                  </p>
                </div>
              ) : (
                <div className="space-y-2">
                  {customSources.map((source) => (
                    <div
                      key={source.id}
                      className="p-3 rounded-xl bg-slate-900/60 border border-slate-800 flex items-center justify-between gap-3"
                    >
                      <button
                        onClick={() => openEdit(source)}
                        className="flex items-center gap-2.5 min-w-0 text-left flex-1 group"
                      >
                        <div className="p-1.5 rounded-lg bg-slate-800 text-rose-400 shrink-0">
                          {source.kind === 'xbpq' ? (
                            <FileCode className="w-4 h-4" />
                          ) : (
                            <Globe className="w-4 h-4" />
                          )}
                        </div>
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-bold text-slate-100 truncate group-hover:text-rose-300">
                              {source.name}
                            </span>
                            <span
                              className={`shrink-0 text-[9px] px-1.5 rounded uppercase font-mono font-semibold ${
                                source.kind === 'xbpq'
                                  ? 'bg-rose-500/20 text-rose-300 border border-rose-500/30'
                                  : 'bg-slate-800 text-slate-400'
                              }`}
                            >
                              {source.kind || 'api'}
                            </span>
                          </div>
                          <p className="text-[11px] text-slate-400 truncate mt-0.5">{source.base}</p>
                        </div>
                      </button>

                      <div className="flex items-center gap-1.5 shrink-0">
                        <button
                          onClick={() => onSaveSource({ ...source, enabled: !source.enabled })}
                          className={`text-[10px] px-2 py-1 rounded font-semibold transition-colors ${
                            source.enabled
                              ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                              : 'bg-slate-800 text-slate-500'
                          }`}
                        >
                          {source.enabled ? '已启用' : '已停用'}
                        </button>
                        <button
                          onClick={() => openEdit(source)}
                          className="p-1.5 text-slate-400 hover:text-sky-400 rounded-lg hover:bg-slate-800 transition-colors"
                          title="编辑"
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => setConfirmDelete(source)}
                          className="p-1.5 text-slate-400 hover:text-rose-400 rounded-lg hover:bg-slate-800 transition-colors"
                          title="删除"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {confirmDelete && (
                <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-200 space-y-2">
                  <p className="text-[11px]">确定删除「{confirmDelete.name}」吗？</p>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => {
                        onDeleteSource(confirmDelete.id);
                        setConfirmDelete(null);
                      }}
                      className="px-3 py-1 rounded-lg bg-rose-600 hover:bg-rose-500 text-white text-[11px] font-semibold"
                    >
                      删除
                    </button>
                    <button
                      onClick={() => setConfirmDelete(null)}
                      className="px-3 py-1 rounded-lg bg-slate-800 text-slate-300 text-[11px]"
                    >
                      取消
                    </button>
                  </div>
                </div>
              )}

              <div className="flex items-center justify-between pt-1 text-[11px] text-slate-500">
                <span>点击任意条目可编辑；改动即时存入本机浏览器</span>
                <button
                  onClick={handleCopy}
                  className="flex items-center gap-1 hover:text-slate-300"
                >
                  {copied ? <Check className="w-3 h-3 text-emerald-400" /> : <ClipboardPaste className="w-3 h-3" />}
                  {copied ? '已复制 JSON' : '复制 JSON'}
                </button>
              </div>
            </>
          )}

          {/* ---------------- 编辑器 ---------------- */}
          {view === 'editor' && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-bold text-slate-200 flex items-center gap-1.5">
                  <Plus className="w-3.5 h-3.5 text-rose-400" />
                  {editingId ? '编辑自定义源' : '新增自定义源'}
                </h3>
                <button
                  onClick={() => setView('list')}
                  className="text-[11px] text-slate-400 hover:text-slate-200"
                >
                  返回列表
                </button>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] text-slate-400 mb-1">源名称</label>
                  <input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="留空则用规则里的域名"
                    className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-slate-100 focus:outline-none focus:border-rose-500"
                  />
                </div>
                <div>
                  <label className="block text-[11px] text-slate-400 mb-1">源类型</label>
                  <select
                    value={kind}
                    onChange={(e) => setKind(e.target.value as SourceKind)}
                    className="w-full bg-slate-800 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-rose-500"
                  >
                    {KIND_OPTIONS.map((item) => (
                      <option key={item.value} value={item.value}>
                        {item.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-[11px] text-slate-400 mb-1">源网址（主页 / 接口地址）</label>
                <input
                  value={base}
                  onChange={(e) => setBase(e.target.value)}
                  placeholder="https://www.example.com"
                  className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-slate-100 focus:outline-none focus:border-rose-500"
                />
                <p className="text-[10px] text-slate-500 mt-1">{kindHint}</p>
              </div>

              <div className="rounded-xl bg-slate-900/80 border border-slate-800 p-3">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs font-semibold text-slate-200">XBPQ 爬虫规则</p>
                    <p className="text-[10px] text-slate-500">粘贴 JSON 规则后按字段逐项截取</p>
                  </div>
                  <button
                    onClick={() => setRuleMode((prev) => !prev)}
                    className={`w-10 h-5 rounded-full transition-colors relative shrink-0 ${
                      ruleMode ? 'bg-rose-500' : 'bg-slate-700'
                    }`}
                    aria-pressed={ruleMode}
                  >
                    <span
                      className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all ${
                        ruleMode ? 'left-[22px]' : 'left-0.5'
                      }`}
                    />
                  </button>
                </div>

                {ruleMode && (
                  <textarea
                    rows={9}
                    value={ruleText}
                    onChange={(e) => handleRuleChange(e.target.value)}
                    placeholder={'{\n  "主页url": "https://www.example.com",\n  "分类url": "https://www.example.com/vodshow/index-{cateId}-{catePg}.html",\n  "分类": "电影$1#剧集$2"\n}'}
                    className="mt-2.5 w-full bg-slate-800 font-mono border border-slate-700 rounded-lg p-2.5 text-[11px] text-slate-200 focus:outline-none focus:border-rose-500 leading-relaxed"
                  />
                )}
                {ruleMode && (
                  <p className="text-[10px] text-slate-500 mt-1">
                    兼容截取语法（A&amp;&amp;B / || / 修饰符）与 p: 选择器；保存时服务端会校验并套用模板家族。
                  </p>
                )}
              </div>

              {testResult && (
                <div
                  className={`p-2.5 rounded-lg text-xs flex items-start gap-2 ${
                    testResult.ok
                      ? 'bg-emerald-500/15 border border-emerald-500/30 text-emerald-300'
                      : 'bg-rose-500/15 border border-rose-500/30 text-rose-300'
                  }`}
                >
                  {testResult.ok ? (
                    <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
                  ) : (
                    <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                  )}
                  <span className="leading-relaxed break-all">{testResult.message}</span>
                </div>
              )}

              <div className="flex items-center justify-end gap-2 pt-1">
                <button
                  onClick={() => void handleTest()}
                  disabled={testing}
                  className="px-3 py-1.5 rounded-lg bg-slate-800 text-slate-300 text-xs font-medium border border-slate-700 flex items-center gap-1.5 disabled:opacity-60"
                >
                  {testing ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin text-sky-400" />
                  ) : (
                    <Wifi className="w-3.5 h-3.5 text-sky-400" />
                  )}
                  <span>{testing ? '在线探测中…' : '测试与校验'}</span>
                </button>
                <button
                  onClick={handleSave}
                  className="px-4 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-500 text-white text-xs font-semibold shadow-md shadow-rose-950/40"
                >
                  {editingId ? '保存修改' : '保存并加入'}
                </button>
              </div>
            </div>
          )}

          {/* ---------------- 导入 ---------------- */}
          {view === 'import' && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-bold text-slate-200 flex items-center gap-1.5">
                  <Upload className="w-3.5 h-3.5 text-rose-400" />
                  导入自定义源
                </h3>
                <button
                  onClick={() => setView('list')}
                  className="text-[11px] text-slate-400 hover:text-slate-200"
                >
                  返回列表
                </button>
              </div>

              <div className="flex items-center gap-1 bg-slate-900/80 border border-slate-800 rounded-lg p-1 w-fit">
                {(
                  [
                    { id: 'url', label: '网络地址', icon: Link },
                    { id: 'file', label: '本地文件', icon: FolderOpen },
                    { id: 'paste', label: '粘贴文本', icon: ClipboardPaste },
                  ] as { id: ImportTab; label: string; icon: any }[]
                ).map((tab) => (
                  <button
                    key={tab.id}
                    onClick={() => setImportTab(tab.id)}
                    className={`px-2.5 py-1 rounded-md text-[11px] font-medium flex items-center gap-1 transition-colors ${
                      importTab === tab.id
                        ? 'bg-rose-600 text-white'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    <tab.icon className="w-3 h-3" />
                    {tab.label}
                  </button>
                ))}
              </div>

              {importTab === 'url' && (
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <input
                      value={remoteUrl}
                      onChange={(e) => setRemoteUrl(e.target.value)}
                      placeholder="https://…/config.json"
                      className="flex-1 bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-xs text-slate-100 font-mono focus:outline-none focus:border-rose-500"
                    />
                    <button
                      onClick={() => void importFromUrl()}
                      disabled={busy || !remoteUrl.trim()}
                      className="px-4 py-2 rounded-lg bg-sky-600 hover:bg-sky-500 disabled:opacity-40 text-white text-xs font-semibold shrink-0 flex items-center gap-1.5"
                    >
                      {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
                      <span>{busy ? '拉取中…' : '导入'}</span>
                    </button>
                  </div>
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="text-[10px] text-slate-500">默认地址：</span>
                    {IMPORT_PRESETS.map((preset) => (
                      <button
                        key={preset.name}
                        onClick={() => setRemoteUrl(preset.url)}
                        className={`px-2 py-0.5 rounded text-[10px] font-medium border transition-colors ${
                          remoteUrl.trim() === preset.url
                            ? 'bg-rose-500/20 text-rose-300 border-rose-500/40'
                            : 'bg-slate-800 text-slate-400 border-slate-700 hover:text-slate-200'
                        }`}
                      >
                        {preset.name}
                      </button>
                    ))}
                  </div>
                  <p className="text-[10px] text-slate-500 leading-relaxed">
                    订阅由本机抓取服务拉取（自动把 GitHub 网页链接转 raw 直链），
                    不经过浏览器直连，因此不会被站点 CORS / Referer 校验拦成 403。
                  </p>
                </div>
              )}

              {importTab === 'file' && (
                <div className="p-4 rounded-xl bg-slate-900/60 border border-dashed border-slate-700 text-center space-y-2">
                  <FolderOpen className="w-6 h-6 mx-auto text-slate-500" />
                  <p className="text-[11px] text-slate-400">选择本应用导出的 .json 备份，或 TVBox 配置 / TXT 列表</p>
                  <button
                    onClick={() => fileRef.current?.click()}
                    disabled={busy}
                    className="px-3.5 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-500 disabled:opacity-40 text-white text-xs font-semibold inline-flex items-center gap-1.5"
                  >
                    {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
                    选择文件
                  </button>
                  <input
                    ref={fileRef}
                    type="file"
                    accept=".json,.txt,application/json,text/plain"
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0] || null;
                      e.target.value = '';
                      void handleFilePick(file);
                    }}
                  />
                </div>
              )}

              {importTab === 'paste' && (
                <div className="space-y-2">
                  <textarea
                    rows={9}
                    value={pasteText}
                    onChange={(e) => setPasteText(e.target.value)}
                    placeholder={'{\n  "sites": [\n    { "name": "短剧站", "type": 3, "api": "csp_XBPQ", "ext": "……" }\n  ]\n}'}
                    className="w-full bg-slate-900 border border-slate-700 rounded-xl p-3 font-mono text-[11px] text-slate-200 focus:outline-none focus:border-rose-500"
                  />
                  <div className="flex justify-end">
                    <button
                      onClick={() => void importFromText(pasteText)}
                      disabled={busy || !pasteText.trim()}
                      className="px-4 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-500 disabled:opacity-40 text-white text-xs font-semibold flex items-center gap-1.5"
                    >
                      {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
                      解析并导入
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-4 py-2.5 border-t border-slate-800 flex items-center justify-between text-[11px] text-slate-500 shrink-0">
          <span className="flex items-center gap-1.5">
            <ServerCog className="w-3.5 h-3.5" />
            规则与抓取均在本机执行 · {customSources.length} 个自定义源
          </span>
          <button onClick={onClose} className="px-3 py-1 rounded-lg bg-slate-800 text-slate-300 hover:bg-slate-700">
            关闭
          </button>
        </div>
      </div>
    </div>
  );
};
