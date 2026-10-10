/** Media URLs from the local upload provider are relative; the LIFF app lives on another origin. */
export const absoluteUrl = (url: string | null | undefined, baseUrl: string | undefined): string | null => {
  if (!url) return null;
  if (/^https?:\/\//.test(url)) return url;
  if (baseUrl && /^https?:\/\//.test(baseUrl)) return `${baseUrl.replace(/\/+$/, '')}${url}`;
  return url;
};
