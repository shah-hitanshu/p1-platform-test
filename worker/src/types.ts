export interface Env {
  MEDIA_BUCKET: R2Bucket;
  CSS_BASE_URL: string;
}

export interface MediaItem {
  key: string;
  url: string;
  filename: string;
  size?: number;
  lastModified?: string;
}
