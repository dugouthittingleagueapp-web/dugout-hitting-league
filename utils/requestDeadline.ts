/** Bounds both the request and response body, including transports that ignore abort. */
export const withRequestDeadline = async <T>(work: (signal: AbortSignal) => Promise<T>, milliseconds: number): Promise<T> => {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout>;
  try {
    return await Promise.race([
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          reject(new Error('Request could not be confirmed in time.'));
          controller.abort();
        }, milliseconds);
      }),
      work(controller.signal)
    ]);
  } finally { clearTimeout(timer!); }
};
