export interface Env {
  MEDIA_BUCKET: R2Bucket;
  CSS_BASE_URL: string;
  CDN_BASE_URL: string;
  CSS_SERVICE?: Fetcher;
  MAX_UPLOAD_BYTES?: string;
  IMAGES: ImagesBinding;
}

export interface MediaItem {
  key: string;
  url: string;
  filename: string;
  size?: number;
  lastModified?: string;
}
