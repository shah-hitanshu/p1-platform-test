/**
 * Phase 10.2: Metrics Service Tests (TDD)
 *
 * Tests for observability metrics collection and push to Grafana Cloud.
 * Follows the Cloudflare Workers pattern with request-scoped buffering.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock the global fetch function for metrics push
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

describe('Phase 10.2: Metrics Service', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mockFetch.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // ===========================================================================
  // initializeMetrics
  // ===========================================================================

  describe('initializeMetrics', () => {
    it('should initialize with enabled config', async () => {
      const {
        initializeMetrics,
        incrementCounter,
        getMetricsBuffer,
      } = await import('../../src/services/metrics-service');

      initializeMetrics({
        enabled: true,
        pushEndpoint: 'https://metrics.example.com/push',
        apiKey: 'test-api-key',
        environment: 'test',
        version: '1.0.0',
      });

      // After initialization, metrics should be enabled and buffer should be empty
      incrementCounter('test_counter');
      const buffer = getMetricsBuffer();
      expect(buffer.length).toBe(1);
    });

    it('should initialize with disabled config', async () => {
      const {
        initializeMetrics,
        incrementCounter,
        getMetricsBuffer,
      } = await import('../../src/services/metrics-service');

      initializeMetrics({
        enabled: false,
        environment: 'test',
        version: '1.0.0',
      });

      // When disabled, buffer should remain empty even after incrementing
      incrementCounter('test_counter');
      const buffer = getMetricsBuffer();
      expect(buffer.length).toBe(0);
    });

    it('should reset buffer on re-initialization', async () => {
      const {
        initializeMetrics,
        incrementCounter,
        getMetricsBuffer,
      } = await import('../../src/services/metrics-service');

      initializeMetrics({
        enabled: true,
        pushEndpoint: 'https://metrics.example.com/push',
        apiKey: 'test-api-key',
        environment: 'test',
        version: '1.0.0',
      });

      incrementCounter('test_counter');
      expect(getMetricsBuffer().length).toBe(1);

      // Re-initialize should reset the buffer
      initializeMetrics({
        enabled: true,
        pushEndpoint: 'https://metrics.example.com/push',
        apiKey: 'test-api-key',
        environment: 'test',
        version: '1.0.0',
      });

      const buffer = getMetricsBuffer();
      expect(buffer.length).toBe(0);
    });
  });

  // ===========================================================================
  // incrementCounter
  // ===========================================================================

  describe('incrementCounter', () => {
    it('should buffer counter metric with default value of 1', async () => {
      const {
        initializeMetrics,
        incrementCounter,
        getMetricsBuffer,
      } = await import('../../src/services/metrics-service');

      initializeMetrics({
        enabled: true,
        pushEndpoint: 'https://metrics.example.com/push',
        apiKey: 'test-api-key',
        environment: 'test',
        version: '1.0.0',
      });

      incrementCounter('css_http_request_total');

      const buffer = getMetricsBuffer();
      expect(buffer.length).toBe(1);
      expect(buffer[0]).toMatchObject({
        name: 'css_http_request_total',
        type: 'counter',
        value: 1,
      });
    });

    it('should buffer counter metric with custom value', async () => {
      const {
        initializeMetrics,
        incrementCounter,
        getMetricsBuffer,
      } = await import('../../src/services/metrics-service');

      initializeMetrics({
        enabled: true,
        pushEndpoint: 'https://metrics.example.com/push',
        apiKey: 'test-api-key',
        environment: 'test',
        version: '1.0.0',
      });

      incrementCounter('css_http_request_total', { method: 'GET' }, 5);

      const buffer = getMetricsBuffer();
      expect(buffer.length).toBe(1);
      expect(buffer[0]).toMatchObject({
        name: 'css_http_request_total',
        type: 'counter',
        value: 5,
        labels: { method: 'GET' },
      });
    });

    it('should buffer counter metric with labels', async () => {
      const {
        initializeMetrics,
        incrementCounter,
        getMetricsBuffer,
      } = await import('../../src/services/metrics-service');

      initializeMetrics({
        enabled: true,
        pushEndpoint: 'https://metrics.example.com/push',
        apiKey: 'test-api-key',
        environment: 'test',
        version: '1.0.0',
      });

      incrementCounter('css_http_request_total', {
        method: 'POST',
        path_pattern: '/api/sites/:id',
        status_class: '2xx',
      });

      const buffer = getMetricsBuffer();
      expect(buffer.length).toBe(1);
      expect(buffer[0].labels).toEqual({
        method: 'POST',
        path_pattern: '/api/sites/:id',
        status_class: '2xx',
      });
    });

    it('should not buffer when metrics are disabled', async () => {
      const {
        initializeMetrics,
        incrementCounter,
        getMetricsBuffer,
      } = await import('../../src/services/metrics-service');

      initializeMetrics({
        enabled: false,
        environment: 'test',
        version: '1.0.0',
      });

      incrementCounter('css_http_request_total');

      const buffer = getMetricsBuffer();
      expect(buffer.length).toBe(0);
    });
  });

  // ===========================================================================
  // recordTiming
  // ===========================================================================

  describe('recordTiming', () => {
    it('should buffer timing metric with duration', async () => {
      const {
        initializeMetrics,
        recordTiming,
        getMetricsBuffer,
      } = await import('../../src/services/metrics-service');

      initializeMetrics({
        enabled: true,
        pushEndpoint: 'https://metrics.example.com/push',
        apiKey: 'test-api-key',
        environment: 'test',
        version: '1.0.0',
      });

      recordTiming('css_http_request_duration_ms', 150.5);

      const buffer = getMetricsBuffer();
      expect(buffer.length).toBe(1);
      expect(buffer[0]).toMatchObject({
        name: 'css_http_request_duration_ms',
        type: 'histogram',
        value: 150.5,
      });
    });

    it('should buffer timing metric with labels', async () => {
      const {
        initializeMetrics,
        recordTiming,
        getMetricsBuffer,
      } = await import('../../src/services/metrics-service');

      initializeMetrics({
        enabled: true,
        pushEndpoint: 'https://metrics.example.com/push',
        apiKey: 'test-api-key',
        environment: 'test',
        version: '1.0.0',
      });

      recordTiming('css_http_request_duration_ms', 250, {
        method: 'GET',
        path_pattern: '/health',
        status_class: '2xx',
      });

      const buffer = getMetricsBuffer();
      expect(buffer[0].labels).toEqual({
        method: 'GET',
        path_pattern: '/health',
        status_class: '2xx',
      });
    });

    it('should not buffer when metrics are disabled', async () => {
      const {
        initializeMetrics,
        recordTiming,
        getMetricsBuffer,
      } = await import('../../src/services/metrics-service');

      initializeMetrics({
        enabled: false,
        environment: 'test',
        version: '1.0.0',
      });

      recordTiming('css_http_request_duration_ms', 150.5);

      const buffer = getMetricsBuffer();
      expect(buffer.length).toBe(0);
    });
  });

  // ===========================================================================
  // setGauge
  // ===========================================================================

  describe('setGauge', () => {
    it('should buffer gauge metric with value', async () => {
      const {
        initializeMetrics,
        setGauge,
        getMetricsBuffer,
      } = await import('../../src/services/metrics-service');

      initializeMetrics({
        enabled: true,
        pushEndpoint: 'https://metrics.example.com/push',
        apiKey: 'test-api-key',
        environment: 'test',
        version: '1.0.0',
      });

      setGauge('css_ws_connections_active', 42);

      const buffer = getMetricsBuffer();
      expect(buffer.length).toBe(1);
      expect(buffer[0]).toMatchObject({
        name: 'css_ws_connections_active',
        type: 'gauge',
        value: 42,
      });
    });

    it('should buffer gauge metric with labels', async () => {
      const {
        initializeMetrics,
        setGauge,
        getMetricsBuffer,
      } = await import('../../src/services/metrics-service');

      initializeMetrics({
        enabled: true,
        pushEndpoint: 'https://metrics.example.com/push',
        apiKey: 'test-api-key',
        environment: 'test',
        version: '1.0.0',
      });

      setGauge('css_worker_info', 1, {
        version: '1.0.0',
        environment: 'production',
      });

      const buffer = getMetricsBuffer();
      expect(buffer[0].labels).toEqual({
        version: '1.0.0',
        environment: 'production',
      });
    });

    it('should not buffer when metrics are disabled', async () => {
      const {
        initializeMetrics,
        setGauge,
        getMetricsBuffer,
      } = await import('../../src/services/metrics-service');

      initializeMetrics({
        enabled: false,
        environment: 'test',
        version: '1.0.0',
      });

      setGauge('css_ws_connections_active', 42);

      const buffer = getMetricsBuffer();
      expect(buffer.length).toBe(0);
    });
  });

  // ===========================================================================
  // flushMetrics
  // ===========================================================================

  describe('flushMetrics', () => {
    it('should push buffered metrics to endpoint', async () => {
      const {
        initializeMetrics,
        incrementCounter,
        flushMetrics,
        getMetricsBuffer,
      } = await import('../../src/services/metrics-service');

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
      });

      initializeMetrics({
        enabled: true,
        pushEndpoint: 'https://metrics.example.com/push',
        apiKey: 'test-api-key',
        environment: 'test',
        version: '1.0.0',
      });

      incrementCounter('css_http_request_total');
      incrementCounter('css_http_request_total');

      await flushMetrics();

      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(mockFetch).toHaveBeenCalledWith(
        'https://metrics.example.com/push',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Authorization': 'Bearer test-api-key',
            'Content-Type': 'application/json',
          }),
        }),
      );

      // Buffer should be cleared after flush
      const buffer = getMetricsBuffer();
      expect(buffer.length).toBe(0);
    });

    it('should not push if buffer is empty', async () => {
      const {
        initializeMetrics,
        flushMetrics,
      } = await import('../../src/services/metrics-service');

      initializeMetrics({
        enabled: true,
        pushEndpoint: 'https://metrics.example.com/push',
        apiKey: 'test-api-key',
        environment: 'test',
        version: '1.0.0',
      });

      await flushMetrics();

      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('should not push when metrics are disabled', async () => {
      const {
        initializeMetrics,
        incrementCounter,
        flushMetrics,
      } = await import('../../src/services/metrics-service');

      initializeMetrics({
        enabled: false,
        environment: 'test',
        version: '1.0.0',
      });

      // This shouldn't buffer anyway, but let's be explicit
      incrementCounter('css_http_request_total');

      await flushMetrics();

      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('should not push if no push endpoint configured', async () => {
      const {
        initializeMetrics,
        incrementCounter,
        flushMetrics,
      } = await import('../../src/services/metrics-service');

      initializeMetrics({
        enabled: true,
        // No pushEndpoint
        environment: 'test',
        version: '1.0.0',
      });

      incrementCounter('css_http_request_total');

      await flushMetrics();

      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('should handle push errors gracefully', async () => {
      const {
        initializeMetrics,
        incrementCounter,
        flushMetrics,
        getMetricsBuffer,
      } = await import('../../src/services/metrics-service');

      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      initializeMetrics({
        enabled: true,
        pushEndpoint: 'https://metrics.example.com/push',
        apiKey: 'test-api-key',
        environment: 'test',
        version: '1.0.0',
      });

      incrementCounter('css_http_request_total');

      // Should not throw
      await expect(flushMetrics()).resolves.toBeUndefined();

      // Buffer should still be cleared to prevent memory growth
      const buffer = getMetricsBuffer();
      expect(buffer.length).toBe(0);
    });

    it('should handle non-ok response gracefully', async () => {
      const {
        initializeMetrics,
        incrementCounter,
        flushMetrics,
        getMetricsBuffer,
      } = await import('../../src/services/metrics-service');

      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
      });

      initializeMetrics({
        enabled: true,
        pushEndpoint: 'https://metrics.example.com/push',
        apiKey: 'test-api-key',
        environment: 'test',
        version: '1.0.0',
      });

      incrementCounter('css_http_request_total');

      // Should not throw
      await expect(flushMetrics()).resolves.toBeUndefined();

      // Buffer should still be cleared
      const buffer = getMetricsBuffer();
      expect(buffer.length).toBe(0);
    });

    it('should include environment and version labels in all metrics', async () => {
      const {
        initializeMetrics,
        incrementCounter,
        flushMetrics,
      } = await import('../../src/services/metrics-service');

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
      });

      initializeMetrics({
        enabled: true,
        pushEndpoint: 'https://metrics.example.com/push',
        apiKey: 'test-api-key',
        environment: 'production',
        version: '2.0.0',
      });

      incrementCounter('css_http_request_total', { method: 'GET' });

      await flushMetrics();

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          body: expect.stringContaining('"environment":"production"'),
        }),
      );
      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          body: expect.stringContaining('"version":"2.0.0"'),
        }),
      );
    });
  });

  // ===========================================================================
  // normalizePathPattern
  // ===========================================================================

  describe('normalizePathPattern', () => {
    it('should replace UUIDs with :id placeholder', async () => {
      const { normalizePathPattern } = await import(
        '../../src/services/metrics-service'
      );

      expect(
        normalizePathPattern('/api/sites/123e4567-e89b-12d3-a456-426614174000'),
      ).toBe('/api/sites/:id');

      expect(
        normalizePathPattern(
          '/api/sites/123e4567-e89b-12d3-a456-426614174000/branches/987fcdeb-51a2-3bc4-def5-678901234567',
        ),
      ).toBe('/api/sites/:id/branches/:id');
    });

    it('should not modify paths without dynamic segments', async () => {
      const { normalizePathPattern } = await import(
        '../../src/services/metrics-service'
      );

      expect(normalizePathPattern('/health')).toBe('/health');
      expect(normalizePathPattern('/api/auth/token')).toBe('/api/auth/token');
      expect(normalizePathPattern('/api/auth/users')).toBe('/api/auth/users');
    });

    it('should normalize multiple UUID segments', async () => {
      const { normalizePathPattern } = await import(
        '../../src/services/metrics-service'
      );

      const path = '/api/sites/abc12345-1234-5678-9abc-def012345678/branches/def67890-4321-8765-cba9-210fedcba987/documents/fed09876-5432-1098-7654-321098fedcba';
      expect(normalizePathPattern(path)).toBe(
        '/api/sites/:id/branches/:id/documents/:id',
      );
    });

    it('should handle paths with trailing slashes', async () => {
      const { normalizePathPattern } = await import(
        '../../src/services/metrics-service'
      );

      expect(
        normalizePathPattern('/api/sites/123e4567-e89b-12d3-a456-426614174000/'),
      ).toBe('/api/sites/:id/');
    });

    it('should handle query strings correctly', async () => {
      const { normalizePathPattern } = await import(
        '../../src/services/metrics-service'
      );

      expect(
        normalizePathPattern('/api/sites/123e4567-e89b-12d3-a456-426614174000?limit=10'),
      ).toBe('/api/sites/:id');
    });
  });

  // ===========================================================================
  // classifyError
  // ===========================================================================

  describe('classifyError', () => {
    it('should classify Error instances by name', async () => {
      const { classifyError } = await import(
        '../../src/services/metrics-service'
      );

      const error = new Error('Something went wrong');
      expect(classifyError(error)).toBe('Error');

      const typeError = new TypeError('Type mismatch');
      expect(classifyError(typeError)).toBe('TypeError');
    });

    it('should classify custom errors with name property', async () => {
      const { classifyError } = await import(
        '../../src/services/metrics-service'
      );

      const customError = { name: 'ValidationError', message: 'Invalid input' };
      expect(classifyError(customError)).toBe('ValidationError');
    });

    it('should classify string errors', async () => {
      const { classifyError } = await import(
        '../../src/services/metrics-service'
      );

      expect(classifyError('string error')).toBe('StringError');
    });

    it('should classify unknown errors', async () => {
      const { classifyError } = await import(
        '../../src/services/metrics-service'
      );

      expect(classifyError(null)).toBe('UnknownError');
      expect(classifyError(undefined)).toBe('UnknownError');
      expect(classifyError(42)).toBe('UnknownError');
      expect(classifyError({})).toBe('UnknownError');
    });
  });

  // ===========================================================================
  // getStatusClass
  // ===========================================================================

  describe('getStatusClass', () => {
    it('should classify 2xx status codes', async () => {
      const { getStatusClass } = await import(
        '../../src/services/metrics-service'
      );

      expect(getStatusClass(200)).toBe('2xx');
      expect(getStatusClass(201)).toBe('2xx');
      expect(getStatusClass(204)).toBe('2xx');
      expect(getStatusClass(299)).toBe('2xx');
    });

    it('should classify 3xx status codes', async () => {
      const { getStatusClass } = await import(
        '../../src/services/metrics-service'
      );

      expect(getStatusClass(301)).toBe('3xx');
      expect(getStatusClass(302)).toBe('3xx');
      expect(getStatusClass(304)).toBe('3xx');
    });

    it('should classify 4xx status codes', async () => {
      const { getStatusClass } = await import(
        '../../src/services/metrics-service'
      );

      expect(getStatusClass(400)).toBe('4xx');
      expect(getStatusClass(401)).toBe('4xx');
      expect(getStatusClass(403)).toBe('4xx');
      expect(getStatusClass(404)).toBe('4xx');
      expect(getStatusClass(499)).toBe('4xx');
    });

    it('should classify 5xx status codes', async () => {
      const { getStatusClass } = await import(
        '../../src/services/metrics-service'
      );

      expect(getStatusClass(500)).toBe('5xx');
      expect(getStatusClass(502)).toBe('5xx');
      expect(getStatusClass(503)).toBe('5xx');
      expect(getStatusClass(599)).toBe('5xx');
    });

    it('should classify other status codes', async () => {
      const { getStatusClass } = await import(
        '../../src/services/metrics-service'
      );

      expect(getStatusClass(100)).toBe('1xx');
      expect(getStatusClass(101)).toBe('1xx');
    });
  });

  // ===========================================================================
  // Multiple metrics in single request
  // ===========================================================================

  describe('Multiple metrics per request', () => {
    it('should accumulate multiple metrics in buffer', async () => {
      const {
        initializeMetrics,
        incrementCounter,
        recordTiming,
        setGauge,
        getMetricsBuffer,
      } = await import('../../src/services/metrics-service');

      initializeMetrics({
        enabled: true,
        pushEndpoint: 'https://metrics.example.com/push',
        apiKey: 'test-api-key',
        environment: 'test',
        version: '1.0.0',
      });

      // Simulate a typical request
      incrementCounter('css_http_request_total', { method: 'GET', path_pattern: '/api/sites/:id', status_class: '2xx' });
      recordTiming('css_http_request_duration_ms', 45.2, { method: 'GET', path_pattern: '/api/sites/:id', status_class: '2xx' });
      setGauge('css_db_health_status', 1);
      recordTiming('css_db_health_latency_ms', 12.5);

      const buffer = getMetricsBuffer();
      expect(buffer.length).toBe(4);

      // Verify each metric type is present
      expect(buffer.find((m) => m.name === 'css_http_request_total')).toBeDefined();
      expect(buffer.find((m) => m.name === 'css_http_request_duration_ms')).toBeDefined();
      expect(buffer.find((m) => m.name === 'css_db_health_status')).toBeDefined();
      expect(buffer.find((m) => m.name === 'css_db_health_latency_ms')).toBeDefined();
    });

    it('should include timestamp on all metrics', async () => {
      const {
        initializeMetrics,
        incrementCounter,
        getMetricsBuffer,
      } = await import('../../src/services/metrics-service');

      initializeMetrics({
        enabled: true,
        pushEndpoint: 'https://metrics.example.com/push',
        apiKey: 'test-api-key',
        environment: 'test',
        version: '1.0.0',
      });

      const beforeTime = Date.now();
      incrementCounter('css_http_request_total');
      const afterTime = Date.now();

      const buffer = getMetricsBuffer();
      expect(buffer[0].timestamp).toBeGreaterThanOrEqual(beforeTime);
      expect(buffer[0].timestamp).toBeLessThanOrEqual(afterTime);
    });
  });
});
