import React, { useMemo, useState } from 'react';
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
} from 'lucide-react';
import { CustomSourceSite } from '../../types';
import { apiService } from '../../services/api';
import { nativeCore } from '../../services/nativeCore';
import { SAMPLE_XBPQ_RULES, normalizeGitHubUrl } from '../../data/xbpqSamples';
import type { XbpqSample } from '../../data/xbpqSamples';

interface CustomSourcesModalProps {
  isOpen: boolean;
  onClose: () => void;
  customSources: CustomSourceSite[];
  onSaveSource: (source: CustomSourceSite) => void;
  onDeleteSource: (id: string) => void;
}

type SourceKind = 'xbpq' | 'json' | 'xml' | 'web';

const KIND_OPTIONS: { value: SourceKind; label: string; hint: string }[] = [
  { value: 'xbpq', label: 'XBPQ 爬虫规则', hint: 'TVBox / CatVod csp_XBPQ 规则，服务端按站点形态自动补全模板' },
  { value: 'json', label: 'MacCMS 接口 (JSON)', hint: 'api.php/provide/vod 接口源，自动补 /provide/vod/' },
  { value: 'xml', label: 'MacCMS 接口 (XML)', hint: '返回 XML 的苹果CMS 接口' },
  { value: 'web', label: '网页 HTML 采集', hint: '纯网页抓取，需配合规则使用' },
];

/** 把示例样例展开成编辑器里看到的完整规则 JSON。 */
function sampleToRuleText(sample: XbpqSample): string {
  return JSON.stringify({ name: sample.name, url: sample.url, ...sample.rule }, null, 2);
}

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

export const CustomSourcesModal: React.FC<CustomSourcesModalProps> = ({
  isOpen,
  onClose,
  customSources,
  onSaveSource,
  onDeleteSource,
}) => {
  const [name, setName] = useState('');
  const [base, setBase] = useState('');
  const [kind, setKind] = useState<SourceKind>('xbpq');
  const [ruleText, setRuleText] = useState(() => sampleToRuleText(SAMPLE_XBPQ_RULES[0]));

  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);

  // 批量导入面板
  const [importModalOpen, setImportModalOpen] = useState(false);
  const [batchImportText, setBatchImportText] = useState('');
  const [remoteUrlInput, setRemoteUrlInput] = useState('');
  const [importing, setImporting] = useState(false);
  const [batchNotice, setBatchNotice] = useState('');
  const [copied, setCopied] = useState(false);

  const kindHint = useMemo(
    () => KIND_OPTIONS.find((item) => item.value === kind)?.hint || '',
    [kind]
  );

  if (!isOpen) return null;

  const handleLoadTemplate = (sample: XbpqSample) => {
    setName(sample.name);
    setBase(sample.url);
    setKind('xbpq');
    setRuleText(sampleToRuleText(sample));
    setTestResult(null);
  };

  const handleRuleChange = (text: string) => {
    setRuleText(text);
    const identity = peekRuleIdentity(text);
    if (identity.name && !name) setName(identity.name);
    if (identity.url && !base) setBase(identity.url);
  };

  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);

    let parsedRule: any = null;
    const trimmedRule = ruleText.trim();
    if (trimmedRule.startsWith('{') || trimmedRule.startsWith('[')) {
      try {
        parsedRule = JSON.parse(trimmedRule);
      } catch (error: any) {
        setTesting(false);
        setTestResult({ ok: false, message: `规则 JSON 语法错误：${error.message}` });
        return;
      }
    }

    const result = await apiService.testCustomSource({
      base: base.trim(),
      kind,
      rule: trimmedRule,
      xbpqRule: parsedRule,
    });
    setTesting(false);
    setTestResult(result);
  };

  const handleAdd = (event: React.FormEvent) => {
    event.preventDefault();

    let targetName = name.trim();
    let targetBase = base.trim();
    let parsedRule: any = undefined;
    const trimmedRule = ruleText.trim();

    if (trimmedRule.startsWith('{') || trimmedRule.startsWith('[')) {
      try {
        parsedRule = JSON.parse(trimmedRule);
      } catch (error: any) {
        setTestResult({ ok: false, message: `请检查规则 JSON 格式：${error.message}` });
        return;
      }
    }

    const identity = parsedRule ? peekRuleIdentity(trimmedRule) : {};
    if (!targetName) targetName = identity.name || '';
    if (!targetBase) targetBase = identity.url || '';

    if (kind === 'xbpq' && !parsedRule) {
      setTestResult({ ok: false, message: 'XBPQ 源必须填写规则 JSON，可先点上方示例规则' });
      return;
    }
    if (!targetName) targetName = targetBase ? safeHost(targetBase) : '自定义源';
    if (!targetBase && kind !== 'xbpq') {
      setTestResult({ ok: false, message: '请填写目标站点地址' });
      return;
    }

    const newSource: CustomSourceSite = {
      id: `custom:${Date.now()}`,
      name: targetName,
      base: targetBase || 'https://xbpq-rule.local',
      kind,
      rule: trimmedRule,
      xbpqRule: parsedRule,
      enabled: true,
      createdAt: Date.now(),
    };

    onSaveSource(newSource);
    setName('');
    setBase('');
    setRuleText('');
    setTestResult({ ok: true, message: `已加入「${targetName}」` });
  };

  /** 服务端导入的草稿统一落到本地存储（草稿没有 xbpqRule，这里补齐）。 */
  const ingestDrafts = (drafts: CustomSourceSite[]): number => {
    let count = 0;
    drafts.forEach((draft, index) => {
      let parsedRule: any = undefined;
      if (draft.rule && (draft.rule.trim().startsWith('{') || draft.rule.trim().startsWith('['))) {
        try {
          parsedRule = JSON.parse(draft.rule);
        } catch {
          parsedRule = undefined;
        }
      }
      onSaveSource({
        ...draft,
        id: draft.id || `custom:${Date.now()}_${index}`,
        kind: draft.kind || (parsedRule ? 'xbpq' : 'json'),
        xbpqRule: parsedRule,
        enabled: draft.enabled !== false,
        createdAt: draft.createdAt || Date.now(),
      });
      count += 1;
    });
    return count;
  };

  const handleBatchImport = async () => {
    const text = batchImportText.trim();
    if (!text) return;
    setImporting(true);
    setBatchNotice('');
    try {
      const drafts = await apiService.importSources(text);
      if (!drafts.length) {
        setBatchNotice('未能从内容里识别出有效站源，请确认是 TVBox / guoappxp 的 sites 配置');
        return;
      }
      const count = ingestDrafts(drafts);
      setBatchNotice(`成功导入 ${count} 个站源`);
      setBatchImportText('');
      setTimeout(() => {
        setBatchNotice('');
        setImportModalOpen(false);
      }, 1200);
    } catch (error: any) {
      setBatchNotice(`导入失败：${error?.message || '未知错误'}`);
    } finally {
      setImporting(false);
    }
  };

  const handleRemoteUrlImport = async () => {
    const raw = remoteUrlInput.trim();
    if (!raw) return;
    setImporting(true);
    setBatchNotice('');
    try {
      const target = normalizeGitHubUrl(raw);
      const text = await nativeCore.fetchText(target);
      const drafts = await apiService.importSources(text);
      if (!drafts.length) {
        setBatchNotice('订阅内容已拉取，但没有识别到有效站源结构');
        return;
      }
      const count = ingestDrafts(drafts);
      setBatchNotice(`成功从订阅导入 ${count} 个站源`);
      setRemoteUrlInput('');
      setTimeout(() => {
        setBatchNotice('');
        setImportModalOpen(false);
      }, 1200);
    } catch (error: any) {
      setBatchNotice(`订阅拉取失败：${error?.message || '未知错误'}`);
    } finally {
      setImporting(false);
    }
  };

  const handleExport = () => {
    const data = JSON.stringify(customSources, null, 2);
    navigator.clipboard?.writeText(data).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-3 sm:p-4">
      <div className="relative bg-[#121624] border border-slate-800 rounded-2xl w-full max-w-2xl max-h-[92vh] flex flex-col shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-slate-800 shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <div className="p-2 rounded-lg bg-rose-500/20 text-rose-400 shrink-0">
              <FileCode className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <h2 className="text-base font-bold text-slate-100 flex items-center gap-2">
                <span>自定义源与 XBPQ 爬虫规则</span>
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-rose-500/20 text-rose-300 border border-rose-500/30 whitespace-nowrap">
                  服务端抓取
                </span>
              </h2>
              <p className="text-xs text-slate-400 truncate">
                规则解析、模板补全、在线探测全部在本地服务完成，不受浏览器跨域限制
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            <button
              onClick={() => setImportModalOpen(true)}
              className="px-2.5 py-1 rounded-lg bg-rose-600 hover:bg-rose-500 text-white text-xs font-semibold flex items-center gap-1 transition-colors shadow-sm"
              title="从远程订阅或 JSON 文本批量导入"
            >
              <Upload className="w-3.5 h-3.5" />
              <span>导入源/订阅</span>
            </button>

            {customSources.length > 0 && (
              <button
                onClick={handleExport}
                className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium flex items-center gap-1 transition-colors"
                title="导出所有自定义源为 JSON"
              >
                {copied ? (
                  <Check className="w-3.5 h-3.5 text-emerald-400" />
                ) : (
                  <Download className="w-3.5 h-3.5" />
                )}
                <span>{copied ? '已复制' : '导出'}</span>
              </button>
            )}

            <button
              onClick={onClose}
              className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 ml-1"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4 space-y-6 text-xs">
          <form onSubmit={handleAdd} className="bg-slate-900/80 border border-slate-800 rounded-xl p-4">
            <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
              <h3 className="text-xs font-bold text-slate-200 flex items-center gap-1.5">
                <Plus className="w-3.5 h-3.5 text-rose-400" />
                <span>新增站源</span>
              </h3>
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="text-[11px] text-slate-500">示例规则：</span>
                {SAMPLE_XBPQ_RULES.map((sample) => (
                  <button
                    key={sample.name}
                    type="button"
                    onClick={() => handleLoadTemplate(sample)}
                    className="px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-rose-300 border border-rose-500/30 text-[10px] font-medium transition-colors"
                  >
                    {sample.name}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
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

                <div>
                  <label className="block text-[11px] text-slate-400 mb-1">站源名称</label>
                  <input
                    type="text"
                    placeholder="例如：某某短剧站"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-slate-100 focus:outline-none focus:border-rose-500"
                  />
                </div>
              </div>

              <div>
                <label className="block text-[11px] text-slate-400 mb-1">
                  目标站点地址（主页 / 接口地址）
                </label>
                <input
                  type="text"
                  placeholder="https://www.example.com"
                  value={base}
                  onChange={(e) => setBase(e.target.value)}
                  className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-slate-100 focus:outline-none focus:border-rose-500"
                />
                <p className="text-[10px] text-slate-500 mt-1">{kindHint}</p>
              </div>

              <div>
                <div className="flex items-center justify-between mb-1 gap-2">
                  <label className="text-[11px] text-slate-400">
                    {kind === 'xbpq' ? 'XBPQ 规则 JSON' : '规则配置（选填）'}
                  </label>
                  <span className="text-[10px] text-slate-500 text-right">
                    只需写「分类url + 分类」，其余字段由服务端按模板补全
                  </span>
                </div>
                <textarea
                  rows={kind === 'xbpq' ? 8 : 3}
                  placeholder={
                    kind === 'xbpq'
                      ? '{\n  "name": "站点名称",\n  "url": "https://www.example.com",\n  "分类url": "https://www.example.com/vodshow/index-{cateId}-{catePg}.html",\n  "分类": "电影$1#剧集$2"\n}'
                      : '可留空；接口源只需填上面的地址'
                  }
                  value={ruleText}
                  onChange={(e) => handleRuleChange(e.target.value)}
                  className="w-full bg-slate-800 font-mono border border-slate-700 rounded-lg p-2.5 text-[11px] text-slate-200 focus:outline-none focus:border-rose-500 leading-relaxed"
                />
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
                    <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                  ) : (
                    <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                  )}
                  <span className="leading-relaxed break-all">{testResult.message}</span>
                </div>
              )}

              <div className="flex items-center justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={handleTest}
                  disabled={testing}
                  className="px-3 py-1.5 rounded-lg bg-slate-800 text-slate-300 text-xs font-medium border border-slate-700 transition-colors flex items-center gap-1.5 disabled:opacity-60"
                >
                  {testing ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin text-sky-400" />
                  ) : (
                    <Wifi className="w-3.5 h-3.5 text-sky-400" />
                  )}
                  <span>{testing ? '在线探测中…' : '测试与校验规则'}</span>
                </button>

                <button
                  type="submit"
                  className="px-4 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-500 text-white text-xs font-semibold shadow-md shadow-rose-950/40 transition-colors"
                >
                  保存并加入
                </button>
              </div>
            </div>
          </form>

          <div>
            <h3 className="text-xs font-bold text-slate-300 mb-2 flex items-center gap-1.5">
              <Layers className="w-3.5 h-3.5 text-slate-500" />
              已生效的自定义站源（{customSources.length}）
            </h3>
            {customSources.length === 0 ? (
              <p className="text-xs text-slate-500 py-4 text-center bg-slate-900/40 rounded-xl border border-slate-800">
                暂无自定义源，点上方示例规则可一键填充并测试
              </p>
            ) : (
              <div className="space-y-2">
                {customSources.map((source) => (
                  <div
                    key={source.id}
                    className="p-3 rounded-xl bg-slate-900/60 border border-slate-800 flex items-center justify-between gap-3"
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <div className="p-1.5 rounded-lg bg-slate-800 text-rose-400 shrink-0">
                        {source.kind === 'xbpq' ? (
                          <FileCode className="w-4 h-4" />
                        ) : (
                          <Globe className="w-4 h-4" />
                        )}
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-bold text-slate-100 truncate">
                            {source.name}
                          </span>
                          <span
                            className={`shrink-0 text-[9px] px-1.5 rounded uppercase font-mono font-semibold ${
                              source.kind === 'xbpq'
                                ? 'bg-rose-500/20 text-rose-300 border border-rose-500/30'
                                : 'bg-slate-800 text-slate-400'
                            }`}
                          >
                            {source.kind === 'xbpq' ? 'XBPQ' : source.kind}
                          </span>
                        </div>
                        <p className="text-[11px] text-slate-400 truncate mt-0.5">{source.base}</p>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
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
                        onClick={() => onDeleteSource(source.id)}
                        className="p-1.5 text-slate-400 hover:text-rose-400 rounded-lg hover:bg-slate-800 transition-colors"
                        title="删除该源"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* 批量导入 / 订阅 */}
        {importModalOpen && (
          <div className="absolute inset-0 bg-[#121624] p-4 flex flex-col z-50">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800 shrink-0">
              <h3 className="text-sm font-bold text-slate-100 flex items-center gap-2">
                <Upload className="w-4 h-4 text-rose-400" />
                <span>导入订阅 / JSON 站源</span>
              </h3>
              <button
                onClick={() => setImportModalOpen(false)}
                className="p-1 rounded-lg text-slate-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="flex-1 py-3 flex flex-col gap-4 overflow-y-auto">
              <div className="bg-slate-900 border border-slate-800 rounded-xl p-3.5 space-y-2">
                <label className="text-xs font-semibold text-slate-200 flex items-center gap-1.5">
                  <Link className="w-3.5 h-3.5 text-sky-400" />
                  <span>远程订阅地址（支持 GitHub 网页链接）</span>
                </label>
                <div className="flex items-center gap-2">
                  <input
                    type="url"
                    value={remoteUrlInput}
                    onChange={(e) => setRemoteUrlInput(e.target.value)}
                    placeholder="https://github.com/user/repo/blob/main/config.json"
                    className="flex-1 bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-xs text-slate-100 focus:outline-none focus:border-rose-500 font-mono"
                  />
                  <button
                    type="button"
                    onClick={() => void handleRemoteUrlImport()}
                    disabled={importing || !remoteUrlInput.trim()}
                    className="px-4 py-2 rounded-lg bg-sky-600 hover:bg-sky-500 disabled:opacity-40 text-white text-xs font-semibold shrink-0 flex items-center gap-1.5 transition-colors"
                  >
                    {importing ? (
                      <>
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        <span>拉取中…</span>
                      </>
                    ) : (
                      <span>从 URL 导入</span>
                    )}
                  </button>
                </div>
                <p className="text-[11px] text-slate-500">
                  订阅经本地服务抓取（自动把 GitHub `blob` 链接转为 raw 直链），不受浏览器跨域限制。
                </p>
              </div>

              <div className="flex-1 flex flex-col gap-1.5 min-h-[160px]">
                <label className="text-xs font-semibold text-slate-200">
                  或直接粘贴 TVBox / guoappxp 的站源 JSON
                </label>
                <textarea
                  value={batchImportText}
                  onChange={(e) => setBatchImportText(e.target.value)}
                  placeholder={'{\n  "sites": [\n    { "name": "短剧站", "type": 3, "api": "csp_XBPQ", "ext": "……" }\n  ]\n}'}
                  className="flex-1 w-full bg-slate-900 border border-slate-700 rounded-xl p-3 font-mono text-xs text-slate-200 focus:outline-none focus:border-rose-500"
                />
              </div>

              {batchNotice && (
                <div className="p-2.5 rounded-lg bg-rose-500/20 text-rose-300 text-xs border border-rose-500/30 font-medium break-all">
                  {batchNotice}
                </div>
              )}
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-slate-800 shrink-0">
              <button
                type="button"
                onClick={() => setImportModalOpen(false)}
                className="px-3.5 py-1.5 rounded-lg bg-slate-800 text-slate-300 text-xs hover:bg-slate-700"
              >
                关闭
              </button>
              <button
                type="button"
                onClick={() => void handleBatchImport()}
                disabled={importing || !batchImportText.trim()}
                className="px-4 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-500 disabled:opacity-40 text-white text-xs font-semibold flex items-center gap-1.5"
              >
                {importing && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                <span>解析文本并导入</span>
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

function safeHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return '自定义源';
  }
}
