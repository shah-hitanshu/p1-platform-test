import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { SiteScreenshot } from '../../components/SiteScreenshot';
import { getSiteScreenshot } from '../../api/screenshots';

vi.mock('../../api/screenshots', () => ({
  getSiteScreenshot: vi.fn(),
}));

const mockedGetSiteScreenshot = vi.mocked(getSiteScreenshot);

beforeEach(() => {
  vi.clearAllMocks();
});

describe('SiteScreenshot', () => {
  it('renders the captured image when the API returns ok', async () => {
    mockedGetSiteScreenshot.mockResolvedValue({
      kind: 'ok',
      url: 'https://r2.example/site.png?sig=abc',
      expiresAt: '2026-05-11T00:05:00Z',
      capturedAt: '2026-05-10T22:00:00Z',
    });

    render(<SiteScreenshot siteId="site-abc" size="thumbnail" />);

    const img = await screen.findByRole('img', { name: 'Site screenshot' });
    expect(img).toHaveAttribute('src', 'https://r2.example/site.png?sig=abc');
  });

  it('renders the placeholder when no screenshot exists yet', async () => {
    mockedGetSiteScreenshot.mockResolvedValue({
      kind: 'missing',
      error: 'No screenshot has been captured yet',
    });

    render(<SiteScreenshot siteId="site-abc" size="thumbnail" />);

    await waitFor(() => {
      expect(screen.getByTestId('site-screenshot-site-abc')).toHaveClass(
        'site-screenshot--placeholder',
      );
    });
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });

  it('renders the placeholder when the last capture failed', async () => {
    mockedGetSiteScreenshot.mockResolvedValue({
      kind: 'failed',
      error: 'HTTP 404',
      capturedAt: '2026-05-09T10:00:00Z',
    });

    render(<SiteScreenshot siteId="site-abc" size="hero" />);

    await waitFor(() => {
      expect(screen.getByTestId('site-screenshot-site-abc')).toHaveClass(
        'site-screenshot--placeholder',
      );
    });
    expect(screen.queryByText(/HTTP 404/)).not.toBeInTheDocument();
  });

  it('renders the placeholder when the API throws', async () => {
    mockedGetSiteScreenshot.mockRejectedValue(new Error('boom'));

    render(<SiteScreenshot siteId="site-abc" size="thumbnail" />);

    await waitFor(() => {
      expect(screen.getByTestId('site-screenshot-site-abc')).toHaveClass(
        'site-screenshot--placeholder',
      );
    });
  });

  it('refetches when the siteId prop changes', async () => {
    mockedGetSiteScreenshot.mockResolvedValue({
      kind: 'missing',
      error: 'No screenshot has been captured yet',
    });

    const { rerender } = render(<SiteScreenshot siteId="site-a" size="thumbnail" />);
    await waitFor(() => {
      expect(mockedGetSiteScreenshot).toHaveBeenCalledWith('site-a');
    });

    rerender(<SiteScreenshot siteId="site-b" size="thumbnail" />);
    await waitFor(() => {
      expect(mockedGetSiteScreenshot).toHaveBeenCalledWith('site-b');
    });
  });
});
