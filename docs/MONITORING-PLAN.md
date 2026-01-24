# Grafana Monitoring Integration Plan

**Status:** Draft - Awaiting Approval
**Created:** 2026-01-24
**Author:** Claude Code
**Approach:** Minimal viable telemetry for critical actions

---

## Executive Summary

This plan outlines a minimal, budget-conscious integration of monitoring into the Collaborative State System using Pantheon's existing Grafana Cloud infrastructure. The focus is on critical path instrumentation to diagnose failures and performance degradations without over-engineering.

### Key Constraints
- **Budget:** Minimal - start with essential metrics only
- **Retention:** 30 days (Pantheon Prometheus standard)
- **Infrastructure:** Grafana Cloud (pantheon.grafana.net)
- **Data Source:** grafanacloud-pantheon-metrics
- **On-call:** Not in scope for initial implementation

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [Implementation Phases](#2-implementation-phases)
3. [Metrics Specification](#3-metrics-specification)
4. [Instrumentation Points](#4-instrumentation-points)
5. [Dashboard Specifications](#5-dashboard-specifications)
6. [Alerting Rules](#6-alerting-rules)
7. [Infrastructure Requirements](#7-infrastructure-requirements)
8. [Testing Strategy](#8-testing-strategy)
9. [Rollout Plan](#9-rollout-plan)

---

## 1. Architecture Overview

### 1.1 Monitoring Stack (Minimal)

```
┌─────────────────────────────────────────────────────┐
│              Cloudflare Workers                      │
│         (Metrics Service - Statsd/Prometheus)        │
└─────────────────────┬───────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────────┐
│           Grafana Cloud (pantheon.grafana.net)       │
│         grafanacloud-pantheon-metrics datasource     │
└─────────────────────┬───────────────────────────────┘
                      │
                      ▼
               ┌──────────────┐
               │  Dashboard   │
               │  (1 unified) │
               └──────────────┘
```

### 1.2 Data Flow (Simplified)

1. **Application Metrics**: Workers emit Statsd-compatible metrics to Grafana Cloud
2. **Health Checks**: Enhanced `/health` endpoint for uptime monitoring
3. **Retention**: 30 days (Prometheus standard)

### 1.3 Critical Components Only

| Component | Priority | Rationale |
|-----------|----------|-----------|
| Health/Database Connectivity | P0 | System availability |
| HTTP Request Latency/Errors | P0 | User experience |
| WebSocket Connections | P0 | Real-time collaboration health |
| Merge Operations | P1 | Core workflow reliability |

---

## 2. Implementation Phases

### Phase 1: Foundation + Critical Metrics (Week 1)

**Objective:** Minimal viable instrumentation for critical paths.

#### 1.1 Create Lightweight Metrics Service
- [ ] Create `workers/src/services/metrics-service.ts`
- [ ] Implement: Counter, Timer (histogram), Gauge
- [ ] Statsd-compatible output for Grafana Cloud ingestion
- [ ] Batch buffering with flush on request completion

#### 1.2 Instrument Critical Paths Only
- [ ] HTTP request timing (method, path pattern, status class)
- [ ] Database health check latency
- [ ] WebSocket connection count (gauge)
- [ ] Error counter by type

#### 1.3 Enhance Health Endpoint
- [ ] Add database latency to `/health` response
- [ ] Add Worker version/environment info
- [ ] Ensure health endpoint is fast (<100ms)

**Deliverables:**
- Metrics service (~150 lines)
- 6-8 critical metrics emitting to Grafana Cloud
- Enhanced health endpoint

---

### Phase 2: Operational Metrics (Week 2)

**Objective:** Add visibility into core workflows.

#### 2.1 Merge Operation Instrumentation
- [ ] Merge request success/failure counter
- [ ] Merge duration timer
- [ ] Conflict detection counter

#### 2.2 WebSocket Activity
- [ ] Connection open/close events
- [ ] Message count (not size, to reduce cardinality)

#### 2.3 Single Unified Dashboard
- [ ] Create one dashboard covering all metrics
- [ ] Include health status panel
- [ ] Request rate and error rate graphs
- [ ] WebSocket connection gauge
- [ ] Merge operation stats

**Deliverables:**
- ~5 additional metrics
- Single "CSS Operations" dashboard in Grafana

---

### Phase 3: Basic Alerting (Week 3)

**Objective:** Notification for critical failures only.

#### 3.1 Critical Alerts Only
- [ ] Database connectivity failure (Slack notification)
- [ ] Error rate spike >10% (Slack notification)
- [ ] No on-call paging initially

#### 3.2 Simple Runbook
- [ ] Single markdown file with troubleshooting steps
- [ ] Link in alert annotations

**Deliverables:**
- 2 alert rules configured
- Basic runbook document

---

### Future Phases (Not in Scope)

The following are explicitly deferred:
- Distributed tracing
- Log aggregation (Loki)
- Per-document metrics (high cardinality)
- Authentication metrics (low priority initially)
- On-call/PagerDuty integration
- Graphite/Statsd long-term retention

---

## 3. Metrics Specification (Minimal Set)

### 3.1 Naming Convention

All metrics follow the pattern: `css_{subsystem}_{metric_name}_{unit}`

- **Prefix:** `css_` (Collaborative State System)
- **Subsystem:** `http`, `ws`, `db`, `merge`
- **Unit suffix:** `_total`, `_ms`

**Cardinality Control:** To minimize cost, labels are kept minimal. Avoid per-document or per-user labels.

### 3.2 Phase 1 Metrics (Critical - 8 metrics)

| Metric | Type | Labels | Description |
|--------|------|--------|-------------|
| `css_http_request_duration_ms` | Timer | `method`, `path_pattern`, `status_class` | Request latency (P50/P95/P99) |
| `css_http_request_total` | Counter | `method`, `path_pattern`, `status_class` | Request count |
| `css_http_errors_total` | Counter | `error_type` | Errors by type (validation, auth, internal) |
| `css_db_health_latency_ms` | Timer | - | Database ping latency |
| `css_db_health_status` | Gauge | - | 1 = healthy, 0 = unhealthy |
| `css_ws_connections_active` | Gauge | - | Current WebSocket connections (global) |
| `css_ws_connections_total` | Counter | `action` | Connection open/close events |
| `css_worker_info` | Gauge | `version`, `environment` | Static info gauge (always 1) |

**Label Value Guidelines:**
- `path_pattern`: Normalized (e.g., `/sites/:id/branches/:id` not `/sites/abc123/branches/def456`)
- `status_class`: `2xx`, `4xx`, `5xx` (not individual codes)
- `error_type`: `validation`, `auth`, `not_found`, `internal`
- `action`: `open`, `close`

### 3.3 Phase 2 Metrics (Operational - 5 metrics)

| Metric | Type | Labels | Description |
|--------|------|--------|-------------|
| `css_merge_request_total` | Counter | `outcome` | Merge outcomes (success, failed, cancelled) |
| `css_merge_duration_ms` | Timer | `has_conflicts` | End-to-end merge time |
| `css_conflict_detected_total` | Counter | - | Documents with conflicts |
| `css_ws_messages_total` | Counter | `direction` | Messages in/out |
| `css_db_query_duration_ms` | Timer | `query_category` | Query latency by category |

**Label Value Guidelines:**
- `outcome`: `success`, `failed`, `cancelled`
- `has_conflicts`: `true`, `false`
- `direction`: `in`, `out`
- `query_category`: `read`, `write`, `transaction` (not per-query)

### 3.4 Deferred Metrics (Future Phases)

The following are explicitly NOT included to control costs:
- Per-document metrics (high cardinality)
- Per-user/actor metrics (high cardinality)
- CRDT state size tracking
- Authentication/permission metrics
- Checkpoint metrics
- Branch lifecycle metrics

---

## 4. Instrumentation Points

### 4.1 Phase 1 Instrumentation (3 files)

| File | Changes | Metrics |
|------|---------|---------|
| `workers/src/router.ts` | Add timing middleware at entry/exit | `css_http_request_*`, `css_http_errors_total` |
| `workers/src/durable-objects/document-session.ts` | Track connection open/close | `css_ws_connections_*` |
| `workers/src/services/database-service.ts` | Add health check instrumentation | `css_db_health_*` |

### 4.2 Phase 2 Instrumentation (2 files)

| File | Changes | Metrics |
|------|---------|---------|
| `workers/src/services/merge-request-service.ts` | Wrap merge execution | `css_merge_*` |
| `workers/src/services/conflict-detection-service.ts` | Count conflicts | `css_conflict_detected_total` |

### 4.3 Instrumentation Pattern

```typescript
// Lightweight metrics wrapper example
import { metrics } from './metrics-service';

// In router.ts - request middleware
export async function handleRequest(request: Request, env: Env): Promise<Response> {
  const start = Date.now();
  const pathPattern = normalizePathPattern(request.url);

  try {
    const response = await routeRequest(request, env);

    metrics.timing('css_http_request_duration_ms', Date.now() - start, {
      method: request.method,
      path_pattern: pathPattern,
      status_class: `${Math.floor(response.status / 100)}xx`,
    });
    metrics.increment('css_http_request_total', {
      method: request.method,
      path_pattern: pathPattern,
      status_class: `${Math.floor(response.status / 100)}xx`,
    });

    return response;
  } catch (error) {
    metrics.increment('css_http_errors_total', { error_type: classifyError(error) });
    throw error;
  }
}
```

### 4.4 Path Normalization

To avoid high cardinality, paths must be normalized:

```typescript
function normalizePathPattern(url: string): string {
  const path = new URL(url).pathname;
  return path
    .replace(/\/sites\/[^/]+/, '/sites/:id')
    .replace(/\/branches\/[^/]+/, '/branches/:id')
    .replace(/\/documents\/[^/]+/, '/documents/:id')
    .replace(/\/versions\/[^/]+/, '/versions/:id');
}
```

---

## 5. Dashboard Specification

### 5.1 Single Unified Dashboard: "CSS Operations"

**Purpose:** All critical metrics in one view for quick diagnosis.

**Refresh Rate:** 30 seconds

**Layout (4 rows):**

#### Row 1: Health Status
| Panel | Type | Query | Description |
|-------|------|-------|-------------|
| Database Status | Stat | `css_db_health_status` | Green/Red indicator |
| DB Latency | Stat | `avg(css_db_health_latency_ms)` | Current ping time |
| Active WS Connections | Stat | `css_ws_connections_active` | Current count |
| Environment | Stat | `css_worker_info` | Version + env |

#### Row 2: Request Metrics
| Panel | Type | Query | Description |
|-------|------|-------|-------------|
| Request Rate | Time series | `rate(css_http_request_total[5m])` | Requests/sec |
| Error Rate | Time series | `rate(css_http_errors_total[5m]) / rate(css_http_request_total[5m])` | Error % |
| Latency P95 | Time series | `histogram_quantile(0.95, rate(css_http_request_duration_ms_bucket[5m]))` | P95 response time |

#### Row 3: WebSocket Activity
| Panel | Type | Query | Description |
|-------|------|-------|-------------|
| Connection Churn | Time series | `rate(css_ws_connections_total[5m])` by `action` | Opens vs closes |
| Message Rate | Time series | `rate(css_ws_messages_total[5m])` by `direction` | In/out messages |

#### Row 4: Merge Operations (Phase 2)
| Panel | Type | Query | Description |
|-------|------|-------|-------------|
| Merge Outcomes | Pie chart | `sum(css_merge_request_total) by (outcome)` | Success/fail/cancel |
| Merge Duration P95 | Stat | `histogram_quantile(0.95, rate(css_merge_duration_ms_bucket[5m]))` | P95 merge time |
| Conflicts Detected | Time series | `rate(css_conflict_detected_total[5m])` | Conflict rate |

### 5.2 Dashboard JSON Export

Dashboard configuration will be stored in:
```
docs/grafana/css-operations-dashboard.json
```

This allows version control of dashboard definitions.

---

## 6. Alerting Rules (Minimal)

### 6.1 Phase 3 Alerts (2 alerts only)

| Alert Name | Condition | Duration | Notification |
|------------|-----------|----------|--------------|
| `CSSHealthDatabaseDown` | `css_db_health_status == 0` | 2m | Slack |
| `CSSHighErrorRate` | `rate(css_http_errors_total[5m]) / rate(css_http_request_total[5m]) > 0.10` | 5m | Slack |

### 6.2 Notification Channel

**Slack only** - no PagerDuty/on-call for initial implementation.

| Channel | Target | Notes |
|---------|--------|-------|
| Slack | `#css-alerts` (or existing team channel) | Business hours monitoring |

### 6.3 Deferred Alerts

The following alerts are NOT in scope for initial implementation:
- WebSocket mass disconnect
- High latency warnings
- Merge failure spikes
- Connection pool saturation
- Authentication anomalies

These can be added after baseline metrics are established (~30 days of data).

---

## 7. Infrastructure Requirements

### 7.1 Grafana Instance

**Using Pantheon's Grafana Cloud:**
- Instance: `pantheon.grafana.net`
- Data source: `grafanacloud-pantheon-metrics`
- Retention: 30 days (Prometheus standard)
- No additional infrastructure required

### 7.2 Environment Variables

```bash
# Metrics configuration (add to wrangler.toml and .dev.vars)
METRICS_ENABLED=true
METRICS_PUSH_ENDPOINT=<grafana-cloud-push-endpoint>
METRICS_API_KEY=<secret>  # Store in Cloudflare secrets
METRICS_PUSH_INTERVAL_MS=60000
METRICS_BATCH_SIZE=100

# Environment identification
ENVIRONMENT=local|sbx1|production
APP_VERSION=<git-sha-or-version>
```

### 7.3 Secrets Management

For Cloudflare Workers:
```bash
# Set secret for production
wrangler secret put METRICS_API_KEY

# For local development, add to .dev.vars
METRICS_API_KEY=dev-key-for-testing
```

### 7.4 Cost Considerations

To minimize Grafana Cloud costs:
- **13 total metrics** (8 Phase 1 + 5 Phase 2)
- **Low cardinality labels** (no per-document/per-user dimensions)
- **30-day retention** (no long-term storage needed initially)
- **Single dashboard** (reduced query load)
- **2 alerts** (minimal evaluation overhead)

Estimated monthly cost: Minimal (within Pantheon's existing Grafana Cloud allocation)

---

## 8. Testing Strategy

### 8.1 Unit Tests for Metrics Service

```typescript
// workers/tests/services/metrics-service.spec.ts
describe('MetricsService', () => {
  it('should increment counters correctly');
  it('should record timing values');
  it('should set gauge values');
  it('should buffer metrics until flush');
  it('should normalize path patterns correctly');
  it('should handle flush failures gracefully (no throw)');
  it('should respect METRICS_ENABLED=false');
});
```

### 8.2 Integration Verification

Manual verification during development:
1. Make HTTP requests → confirm metrics appear in Grafana
2. Open/close WebSocket → confirm connection gauge updates
3. Trigger database health check → confirm latency recorded
4. Cause an error → confirm error counter increments

### 8.3 Performance Validation

- Metrics overhead should add <5ms to request latency
- Metrics flush should not block request response
- Buffer size should not exceed 1MB in memory

---

## 9. Rollout Plan

### 9.1 Development (Phase 1, Week 1)

1. Implement metrics service with unit tests
2. Add instrumentation to critical paths
3. Test locally with mock metrics endpoint
4. Verify no performance regression

### 9.2 Staging (Phase 2, Week 2)

1. Deploy to sbx1
2. Configure Grafana Cloud data source connection
3. Create CSS Operations dashboard
4. Verify metrics flowing correctly
5. Gather baseline data

### 9.3 Production (Phase 3, Week 3)

1. Deploy with `METRICS_ENABLED=true`
2. Verify metrics in Grafana
3. Configure 2 critical alerts
4. Create basic runbook
5. Monitor for 1 week before declaring complete

### 9.4 Timeline Summary

| Phase | Duration | Deliverables |
|-------|----------|--------------|
| Phase 1: Foundation + Critical | 1 week | Metrics service, 8 metrics, health endpoint |
| Phase 2: Operational Metrics | 1 week | 5 more metrics, unified dashboard |
| Phase 3: Basic Alerting | 1 week | 2 alerts, runbook |

**Total: 3 weeks**

---

## 10. Decisions Made

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Grafana hosting | Grafana Cloud (Pantheon) | Existing infrastructure |
| Retention | 30 days | Prometheus standard at Pantheon |
| Budget approach | Minimal | Start with essentials, expand later |
| On-call | Not included | Defer to future phase |
| Metrics count | 13 total | Balance visibility vs cost |

---

## 11. Appendix

### A. Runbook: Database Down

```markdown
# Alert: CSSHealthDatabaseDown

## Summary
The database health check has failed for 2+ minutes.

## Impact
- All API operations requiring database will fail
- Users cannot save changes
- Merge operations blocked

## Investigation Steps
1. Check CSS Operations dashboard for DB status
2. Verify PostgreSQL connectivity: `psql -h <host> -U cssuser -d css`
3. Check CloudSQL console for instance status
4. Review recent deployments/changes

## Resolution Steps
1. If connection timeout: Check network/firewall rules
2. If auth failure: Verify credentials in Cloudflare secrets
3. If instance down: Check CloudSQL console, may need restart
4. If persistent: Escalate to platform team

## Escalation
If unresolved after 15 minutes, escalate to platform team.
```

### B. Runbook: High Error Rate

```markdown
# Alert: CSSHighErrorRate

## Summary
More than 10% of requests are returning errors.

## Impact
- Users experiencing failures
- Potential data loss if writes failing

## Investigation Steps
1. Check CSS Operations dashboard for error patterns
2. Check Cloudflare Worker logs: `wrangler tail`
3. Identify error type (validation, auth, internal)
4. Check recent deployments

## Resolution Steps
1. If auth errors spiking: Check identity service
2. If validation errors: May be client bug, check API usage
3. If internal errors: Check database, review logs for stack traces
4. If deployment-related: Consider rollback

## Escalation
If unresolved after 15 minutes, escalate to team lead.
```

### C. Files to Create/Modify

| File | Action | Description |
|------|--------|-------------|
| `workers/src/services/metrics-service.ts` | Create | Core metrics service |
| `workers/src/router.ts` | Modify | Add request timing middleware |
| `workers/src/durable-objects/document-session.ts` | Modify | Add WebSocket metrics |
| `workers/src/services/database-service.ts` | Modify | Add health check metrics |
| `workers/tests/services/metrics-service.spec.ts` | Create | Unit tests |
| `docs/grafana/css-operations-dashboard.json` | Create | Dashboard export |
| `docs/runbooks/database-down.md` | Create | Runbook |
| `docs/runbooks/high-error-rate.md` | Create | Runbook |

---

## Approval

- [ ] Architecture review
- [ ] Security review (metrics endpoint authentication)

**Approved by:** ___________________
**Date:** ___________________
