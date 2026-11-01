// Web Request ↔ 「类 Node」req/res 适配层。
//
// server/router.mjs 是运行时无关的路由核心，它只认这些能力：
//   req: method / url / headers（小写键）/ 可异步迭代的 body
//   res: setHeader / writeHead / write / end / once('drain')
// 本文件负责在 Cloudflare Workers（Pages Functions）里把 Web 标准对象翻译成这套契约。
//
// 关键点：
// 1. 响应是**流式**的 —— write() 直接往 TransformStream 里推，response() 在第一次
//    写入时就返回，这样 /api/media 转发大分片不必先攒满内存。
// 2. Workers 没有背压信号，write() 恒返回 true，once('drain') 直接下一微任务放行。

function toBodyChunk(chunk) {
  if (chunk == null) return null;
  if (typeof chunk === 'string') return new TextEncoder().encode(chunk);
  if (chunk instanceof Uint8Array) return chunk;
  if (chunk instanceof ArrayBuffer) return new Uint8Array(chunk);
  if (ArrayBuffer.isView(chunk)) return new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength);
  return new TextEncoder().encode(String(chunk));
}

/** 把 Web Request 包装成 router 期望的 req。 */
export function toNodeRequest(request) {
  const url = new URL(request.url);
  const headers = {};
  for (const [key, value] of request.headers) headers[key.toLowerCase()] = value;

  return {
    method: request.method,
    url: `${url.pathname}${url.search}`,
    headers,
    // router 的 readBody() 用 `for await (const chunk of req)` 读请求体
    async *[Symbol.asyncIterator]() {
      if (!request.body) return;
      const reader = request.body.getReader();
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) return;
          if (value) yield toBodyChunk(value);
        }
      } finally {
        reader.releaseLock?.();
      }
    },
  };
}

/**
 * 造一套 req / res / response。
 * 调用方负责把 response() 的 Promise 交给运行时，并保证 handleRequest 一定走到 end()。
 */
export function createBridge(request) {
  const headers = new Headers();
  let status = 200;
  let wrote = false;
  let closed = false;

  let releaseStart;
  const started = new Promise((resolve) => {
    releaseStart = resolve;
  });

  const stream = new TransformStream();
  const writer = stream.writable.getWriter();
  let chain = Promise.resolve();

  function setHeader(name, value) {
    if (value == null) return;
    try {
      headers.set(String(name), String(value));
    } catch {
      /* 非法头名 / 非法值：忽略，不影响主流程 */
    }
  }

  const res = {
    setHeader,
    getHeader(name) {
      return headers.get(name) || undefined;
    },
    writeHead(code, extra) {
      status = Number(code) || 200;
      if (extra) {
        if (Array.isArray(extra)) {
          for (let i = 0; i + 1 < extra.length; i += 2) setHeader(extra[i], extra[i + 1]);
        } else {
          for (const [key, value] of Object.entries(extra)) setHeader(key, value);
        }
      }
      return res;
    },
    write(chunk) {
      const buf = toBodyChunk(chunk);
      if (buf) {
        wrote = true;
        chain = chain.then(() => writer.write(buf)).catch(() => {});
      }
      releaseStart();
      return true;
    },
    end(chunk) {
      const buf = toBodyChunk(chunk);
      if (buf) {
        wrote = true;
        chain = chain.then(() => writer.write(buf)).catch(() => {});
      }
      if (!closed) {
        closed = true;
        chain = chain.then(() => writer.close()).catch(() => {});
      }
      releaseStart();
      return res;
    },
    // router 在 /api/media 里等背压，Workers 侧恒为可写
    once(event, callback) {
      if (event === 'drain' && typeof callback === 'function') queueMicrotask(() => callback());
      return res;
    },
    on() {
      return res;
    },
    removeListener() {
      return res;
    },
    emit() {
      return true;
    },
  };

  async function response() {
    await started;
    if (!wrote) {
      // 204 / 304 / 空响应：不能带 body，等收尾再返回
      await chain.catch(() => {});
      return new Response(null, { status, headers });
    }
    return new Response(stream.readable, { status, headers });
  }

  return { req: toNodeRequest(request), res, response };
}
