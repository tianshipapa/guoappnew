import React, { useState } from 'react';
import {
  Layers,
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
  Copy,
  Check,
  Link,
  Loader2,
} from 'lucide-react';
import { CustomSourceSite } from '../../types';
import { apiService } from '../../services/api';
import {
  SAMPLE_XBPQ_TEMPLATES,
  XbpqRule,
  normalizeGitHubUrl,
  safeFetchHtml,
  normalizeGuoappxpRule,
} from '../../utils/xbpqParser';

interface CustomSourcesModalProps {
  isOpen: boolean;
  onClose: () => void;
  customSources: CustomSourceSite[];
  onSaveSource: (source: CustomSourceSite) => void;
  onDeleteSource: (id: string) => void;
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
  const [kind, setKind] = useState<'json' | 'xml' | 'web' | 'xbpq'>('xbpq');
  const [ruleText, setRuleText] = useState(
    JSON.stringify(SAMPLE_XBPQ_TEMPLATES[0], null, 2)
  );

  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);

  // Import Sub-Modal state
  const [importModalOpen, setImportModalOpen] = useState(false);
  const [batchImportText, setBatchImportText] = useState('');
  const [remoteUrlInput, setRemoteUrlInput] = useState('');
  const [importingRemote, setImportingRemote] = useState(false);
  const [batchNotice, setBatchNotice] = useState('');
  const [copied, setCopied] = useState(false);

  if (!isOpen) return null;

  // Load a preset template
  const handleLoadTemplate = (tpl: XbpqRule) => {
    setName(tpl.name);
    setBase(tpl.url);
    setKind('xbpq');
    setRuleText(JSON.stringify(tpl, null, 2));
    setTestResult(null);
  };

  // Auto populate name and base if user pastes an XBPQ rule
  const handleRuleChange = (text: string) => {
    setRuleText(text);
    try {
      const parsed = JSON.parse(text);
      if (parsed.name && !name) setName(parsed.name);
      if (parsed.url && !base) setBase(parsed.url);
    } catch (e) {}
  };

  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);

    let parsedXbpq: any = null;
    if (kind === 'xbpq') {
      try {
        parsedXbpq = JSON.parse(ruleText);
      } catch (err: any) {
        setTesting(false);
        setTestResult({ ok: false, message: `XBPQ JSON 语法错误: ${err.message}` });
        return;
      }
    }

    const res = await apiService.testCustomSource({
      base: base.trim(),
      kind,
      rule: ruleText.trim(),
      xbpqRule: parsedXbpq,
    });

    setTesting(false);
    setTestResult(res);
  };

  const handleAdd = (e: React.FormEvent) => {
    e.preventDefault();

    let targetName = name.trim();
    let targetBase = base.trim();
    let parsedXbpq: any = undefined;

    if (kind === 'xbpq') {
      try {
        parsedXbpq = JSON.parse(ruleText);
        if (!targetName && parsedXbpq.name) targetName = parsedXbpq.name;
        if (!targetBase && parsedXbpq.url) targetBase = parsedXbpq.url;
      } catch (err: any) {
        setTestResult({ ok: false, message: `请检查 XBPQ 规则 JSON 格式: ${err.message}` });
        return;
      }
    }

    if (!targetName) targetName = '自定义源';
    if (!targetBase && kind !== 'xbpq') return;

    const newSource: CustomSourceSite = {
      id: `custom:${Date.now()}`,
      name: targetName,
      base: targetBase || 'https://xbpq-rule.local',
      kind,
      rule: ruleText.trim(),
      xbpqRule: parsedXbpq,
      enabled: true,
      createdAt: Date.now(),
    };

    onSaveSource(newSource);
    setName('');
    setBase('');
    setRuleText('');
    setTestResult(null);
  };

  // Process and ingest JSON content (guoappxp config, TVBox config, or site array)
  const processAndIngestJson = (rawJsonStr: string) => {
    const parsed = JSON.parse(rawJsonStr);
    let count = 0;

    const sitesList = parsed.sites || (Array.isArray(parsed) ? parsed : [parsed]);

    if (Array.isArray(sitesList)) {
      sitesList.forEach((site: any, idx: number) => {
        let rawRule = site.rule || site.ext || site;
        if (typeof rawRule === 'string' && rawRule.startsWith('{')) {
          try {
            rawRule = JSON.parse(rawRule);
          } catch (e) {}
        }

        const normalized = normalizeGuoappxpRule(rawRule);
        const name = site.name || normalized.name || `导入源 ${idx + 1}`;
        const base = site.url || normalized.url || 'https://xbpq.local';

        const newSrc: CustomSourceSite = {
          id: `custom:${Date.now()}_${idx}`,
          name,
          base,
          kind: 'xbpq',
          rule: JSON.stringify(normalized, null, 2),
          xbpqRule: normalized,
          enabled: true,
          createdAt: Date.now(),
        };
        onSaveSource(newSrc);
        count++;
      });
    }

    return count;
  };

  // Handle batch text import
  const handleBatchImport = () => {
    if (!batchImportText.trim()) return;
    try {
      const count = processAndIngestJson(batchImportText);
      if (count > 0) {
        setBatchNotice(`成功导入 ${count} 个 XBPQ / 自定义站源！`);
        setTimeout(() => {
          setBatchNotice('');
          setImportModalOpen(false);
          setBatchImportText('');
        }, 1500);
      } else {
        setBatchNotice('未能识别出有效的 sites 或 XBPQ 规则结构');
      }
    } catch (err: any) {
      setBatchNotice(`导入解析失败: ${err.message}`);
    }
  };

  // Handle Fetching Remote URL (e.g. GitHub config.json url)
  const handleRemoteUrlImport = async () => {
    if (!remoteUrlInput.trim()) return;
    setImportingRemote(true);
    setBatchNotice('');

    try {
      const normalizedUrl = normalizeGitHubUrl(remoteUrlInput.trim());
      const rawText = await safeFetchHtml(normalizedUrl, undefined, 8000);
      const count = processAndIngestJson(rawText);

      if (count > 0) {
        setBatchNotice(`成功从远程 URL 导入 ${count} 个站源！`);
        setTimeout(() => {
          setBatchNotice('');
          setImportModalOpen(false);
          setRemoteUrlInput('');
        }, 1500);
      } else {
        setBatchNotice('远程 JSON 下载成功，但未识别到有效的源配置结构');
      }
    } catch (err: any) {
      setBatchNotice(`远程拉取失败: ${err.message}（请确认 GitHub URL 是否支持直连或已转换为 raw 链接）`);
    } finally {
      setImportingRemote(false);
    }
  };

  // Export sources JSON
  const handleExport = () => {
    const data = JSON.stringify(customSources, null, 2);
    navigator.clipboard?.writeText(data);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-3 sm:p-4">
      <div className="bg-[#121624] border border-slate-800 rounded-2xl w-full max-w-2xl max-h-[92vh] flex flex-col shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-200">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-slate-800 shrink-0">
          <div className="flex items-center gap-2">
            <div className="p-2 rounded-lg bg-rose-500/20 text-rose-400">
              <FileCode className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-100 flex items-center gap-2">
                <span>自定义源与 XBPQ 爬虫规则</span>
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-rose-500/20 text-rose-300 border border-rose-500/30">
                  支持 GitHub 远程导入
                </span>
              </h2>
              <p className="text-xs text-slate-400">
                支持 TVBox / CatVod XBPQ 规则引擎、GitHub 远程订阅源及 JSON 导入
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1.5">
            <button
              onClick={() => setImportModalOpen(true)}
              className="px-2.5 py-1 rounded-lg bg-rose-600 hover:bg-rose-500 text-white text-xs font-semibold flex items-center gap-1 transition-colors shadow-sm"
              title="从 GitHub 远程 URL 或本地批量导入源"
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
                {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Download className="w-3.5 h-3.5" />}
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
          {/* Add Form */}
          <form onSubmit={handleAdd} className="bg-slate-900/80 border border-slate-800 rounded-xl p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-xs font-bold text-slate-200 flex items-center gap-1.5">
                <Plus className="w-3.5 h-3.5 text-rose-400" />
                <span>配置与导入新站源</span>
              </h3>

              {/* Template shortcuts */}
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="text-[11px] text-slate-500">示例规则:</span>
                {SAMPLE_XBPQ_TEMPLATES.map((tpl) => (
                  <button
                    key={tpl.name}
                    type="button"
                    onClick={() => handleLoadTemplate(tpl)}
                    className="px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-rose-300 border border-rose-500/30 text-[10px] font-medium transition-colors"
                  >
                    {tpl.name.replace(/\s*\(XBPQ\)/, '')}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] text-slate-400 mb-1">源类型 (Kind)</label>
                  <select
                    value={kind}
                    onChange={(e) => setKind(e.target.value as any)}
                    className="w-full bg-slate-800 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-rose-500"
                  >
                    <option value="xbpq">XBPQ 爬虫规则 (TVBox 小白规则)</option>
                    <option value="json">MacCMS JSON (直连 API)</option>
                    <option value="xml">MacCMS XML</option>
                    <option value="web">网页 HTML 采集源</option>
                  </select>
                </div>

                <div>
                  <label className="block text-[11px] text-slate-400 mb-1">站源名称</label>
                  <input
                    type="text"
                    placeholder="例如：短剧天堂 (XBPQ)"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-slate-100 focus:outline-none focus:border-rose-500"
                  />
                </div>
              </div>

              <div>
                <label className="block text-[11px] text-slate-400 mb-1">目标站点域名或主页 (URL)</label>
                <input
                  type="text"
                  placeholder="https://www.example.com"
                  value={base}
                  onChange={(e) => setBase(e.target.value)}
                  className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-slate-100 focus:outline-none focus:border-rose-500"
                />
              </div>

              {/* XBPQ Rule Editor */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-[11px] text-slate-400">
                    {kind === 'xbpq' ? 'XBPQ 规则 JSON 内容' : '规则配置 (选填)'}
                  </label>
                  {kind === 'xbpq' && (
                    <span className="text-[10px] text-slate-500">
                      支持 class_name、fenye、list、title、dt_url、dt_title 等通用字段
                    </span>
                  )}
                </div>
                <textarea
                  rows={kind === 'xbpq' ? 7 : 3}
                  placeholder={
                    kind === 'xbpq'
                      ? '{\n  "name": "站点名称",\n  "url": "https://...",\n  "class_name": "都市&战神",\n  "class_url": "dushi&zhanshen",\n  "list": "div.module-item",\n  "title": "h4&&Text",\n  "pic": "img&&data-original",\n  "dt_url": "a&&href"\n}'
                      : '选填请求头或过滤规则'
                  }
                  value={ruleText}
                  onChange={(e) => handleRuleChange(e.target.value)}
                  className="w-full bg-slate-800 font-mono border border-slate-700 rounded-lg p-2.5 text-[11px] text-slate-200 focus:outline-none focus:border-rose-500 leading-relaxed"
                />
              </div>

              {/* Test response message */}
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
                  <span className="leading-relaxed">{testResult.message}</span>
                </div>
              )}

              <div className="flex items-center justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={handleTest}
                  disabled={testing}
                  className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-750 text-slate-300 text-xs font-medium border border-slate-700 transition-colors flex items-center gap-1.5"
                >
                  <Wifi className="w-3.5 h-3.5 text-sky-400" />
                  <span>{testing ? '测试中…' : '测试与校验规则'}</span>
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

          {/* Existing Custom Sources List */}
          <div>
            <h3 className="text-xs font-bold text-slate-300 mb-2">已生效的自定义站源</h3>
            {customSources.length === 0 ? (
              <p className="text-xs text-slate-500 py-4 text-center bg-slate-900/40 rounded-xl border border-slate-800">
                暂无自定义源，上方点击示例规则即可一键添加测试
              </p>
            ) : (
              <div className="space-y-2">
                {customSources.map((s) => (
                  <div
                    key={s.id}
                    className="p-3 rounded-xl bg-slate-900/60 border border-slate-800 flex items-center justify-between gap-3"
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <div className="p-1.5 rounded-lg bg-slate-800 text-rose-400 shrink-0">
                        {s.kind === 'xbpq' ? <FileCode className="w-4 h-4" /> : <Globe className="w-4 h-4" />}
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-bold text-slate-100">{s.name}</span>
                          <span
                            className={`text-[9px] px-1.5 py-0.2 rounded uppercase font-mono font-semibold ${
                              s.kind === 'xbpq'
                                ? 'bg-rose-500/20 text-rose-300 border border-rose-500/30'
                                : 'bg-slate-800 text-slate-400'
                            }`}
                          >
                            {s.kind === 'xbpq' ? 'XBPQ 爬虫' : s.kind}
                          </span>
                        </div>
                        <p className="text-[11px] text-slate-400 truncate mt-0.5">{s.base}</p>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        onClick={() =>
                          onSaveSource({ ...s, enabled: !s.enabled })
                        }
                        className={`text-[10px] px-2 py-1 rounded font-semibold transition-colors ${
                          s.enabled
                            ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                            : 'bg-slate-800 text-slate-500'
                        }`}
                      >
                        {s.enabled ? '已启用' : '已停用'}
                      </button>

                      <button
                        onClick={() => onDeleteSource(s.id)}
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

        {/* Batch Import & Remote URL Sub-Modal */}
        {importModalOpen && (
          <div className="absolute inset-0 bg-black/90 backdrop-blur-md p-4 flex flex-col z-50 animate-in fade-in">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <h3 className="text-sm font-bold text-slate-100 flex items-center gap-2">
                <Upload className="w-4 h-4 text-rose-400" />
                <span>从远程 URL 或文本批量导入源/订阅</span>
              </h3>
              <button
                onClick={() => setImportModalOpen(false)}
                className="p-1 rounded-lg text-slate-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="flex-1 py-3 flex flex-col gap-4 overflow-y-auto">
              {/* Section 1: Remote URL Import (GitHub blob etc.) */}
              <div className="bg-slate-900 border border-slate-800 rounded-xl p-3.5 space-y-2">
                <label className="block text-xs font-semibold text-slate-200 flex items-center gap-1.5">
                  <Link className="w-3.5 h-3.5 text-sky-400" />
                  <span>输入远程 JSON 订阅地址 (支持 GitHub 网页链接)</span>
                </label>
                <div className="flex items-center gap-2">
                  <input
                    type="url"
                    value={remoteUrlInput}
                    onChange={(e) => setRemoteUrlInput(e.target.value)}
                    placeholder="https://github.com/wokaotianshi123/wokaotianshi123.github.io/blob/main/hongguo/config.json"
                    className="flex-1 bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-xs text-slate-100 focus:outline-none focus:border-rose-500 font-mono"
                  />
                  <button
                    type="button"
                    onClick={handleRemoteUrlImport}
                    disabled={importingRemote || !remoteUrlInput.trim()}
                    className="px-4 py-2 rounded-lg bg-sky-600 hover:bg-sky-500 disabled:opacity-40 text-white text-xs font-semibold shrink-0 flex items-center gap-1.5 transition-colors"
                  >
                    {importingRemote ? (
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
                  提示：系统会自动将 GitHub `blob` 网页链接转换为 `raw.githubusercontent.com` 原始数据链接进行跨域拉取。
                </p>
              </div>

              {/* Section 2: Paste JSON Text */}
              <div className="flex-1 flex flex-col gap-1.5 min-h-[160px]">
                <label className="block text-xs font-semibold text-slate-200">
                  或者直接粘贴 TVBox / 自定义源 JSON 文本内容
                </label>
                <textarea
                  value={batchImportText}
                  onChange={(e) => setBatchImportText(e.target.value)}
                  placeholder='{"sites": [{"name": "短剧", "type": 3, "api": "csp_xBPQ", "ext": {...}}]}'
                  className="flex-1 w-full bg-slate-900 border border-slate-700 rounded-xl p-3 font-mono text-xs text-slate-200 focus:outline-none focus:border-rose-500"
                />
              </div>

              {batchNotice && (
                <div className="p-2.5 rounded-lg bg-rose-500/20 text-rose-300 text-xs border border-rose-500/30 font-medium">
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
                onClick={handleBatchImport}
                disabled={!batchImportText.trim()}
                className="px-4 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-500 disabled:opacity-40 text-white text-xs font-semibold"
              >
                解析文本并导入
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
