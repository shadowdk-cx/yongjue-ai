import { persistDataUrlAsPublicUrl } from '@/lib/persist-artifact';

/**
 * 将 Veo 返回的 data:video/mp4;base64,... 落盘并返回 URL（避免 JSON 塞入几十 MB base64）
 */
export function persistMp4DataUrlToPublic(dataUrl: string): string {
  return persistDataUrlAsPublicUrl(dataUrl);
}
