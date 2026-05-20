import { useEffect } from 'react';
import { useApi } from '../hooks/useApi';
import { getSiteScreenshot } from '../api/screenshots';
import { GlobeIcon } from './icons/GlobeIcon';
import './SiteScreenshot.css';

export type SiteScreenshotSize = 'thumbnail' | 'hero';

interface SiteScreenshotProps {
  siteId: string;
  size: SiteScreenshotSize;
  /** Optional alt text for the rendered image. Defaults to "Site screenshot". */
  alt?: string;
}

export function SiteScreenshot({ siteId, size, alt = 'Site screenshot' }: SiteScreenshotProps) {
  const { data, isLoading, error, execute } = useApi(getSiteScreenshot);

  useEffect(() => {
    void execute(siteId);
  }, [execute, siteId]);

  const containerClass = `site-screenshot site-screenshot--${size}`;
  const testId = `site-screenshot-${siteId}`;

  if (isLoading) {
    return <div className={containerClass} data-testid={testId} />;
  }

  if (error === null && data?.kind === 'ok') {
    return (
      <div className={containerClass} data-testid={testId}>
        <img src={data.url} alt={alt} className="site-screenshot__img" />
      </div>
    );
  }

  return (
    <div
      className={`${containerClass} site-screenshot--placeholder`}
      data-testid={testId}
    >
      <GlobeIcon className="site-screenshot__icon" />
    </div>
  );
}
