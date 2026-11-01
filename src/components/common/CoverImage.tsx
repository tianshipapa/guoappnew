import React, { useEffect, useMemo, useState } from 'react';
import { coverProxyURL, coverURL } from '../../utils/cover';

interface CoverImageProps {
  src?: string;
  alt: string;
  /** 站源 id，服务端据此决定 Referer */
  source?: string;
  className?: string;
  loading?: 'lazy' | 'eager';
  draggable?: boolean;
}

/**
 * 统一封面图。
 *
 * 1. 需要 Referer 的图床（豆瓣）自动改走 /api/cover 代理；
 * 2. 直连失败时再兜底切一次代理（应对其它源将来加防盗链）；
 * 3. 都失败才显示占位渐变，不留浏览器破图图标。
 */
export const CoverImage: React.FC<CoverImageProps> = ({
  src,
  alt,
  source = '',
  className = '',
  loading = 'lazy',
  draggable = false,
}) => {
  const direct = useMemo(() => coverURL(src || '', source), [src, source]);
  const proxy = useMemo(
    () => (src && /^https?:\/\//i.test(src) ? coverProxyURL(src, source) : ''),
    [src, source]
  );
  const [current, setCurrent] = useState(direct);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setCurrent(direct);
    setFailed(false);
  }, [direct]);

  if (failed || !current) {
    return (
      <div
        className={`bg-gradient-to-br from-slate-800 via-slate-900 to-slate-950 flex items-center justify-center ${className}`}
        aria-label={alt}
      >
        <span className="text-[10px] text-slate-600 px-2 text-center leading-tight line-clamp-2">
          {alt}
        </span>
      </div>
    );
  }

  return (
    <img
      src={current}
      alt={alt}
      loading={loading}
      draggable={draggable}
      className={className}
      onError={() => {
        if (proxy && current !== proxy) {
          setCurrent(proxy);
          return;
        }
        setFailed(true);
      }}
    />
  );
};
