#!/usr/bin/env node
/**
 * Local Metrics Receiver with macOS Notifications
 *
 * A self-contained development tool that:
 * - Receives metrics from the Cloudflare Worker
 * - Logs them in a readable format
 * - Sends macOS notifications for issues
 * - Monitors system resources
 *
 * Usage:
 *   node scripts/local-metrics-receiver.js
 *
 * Then configure .dev.vars:
 *   METRICS_ENABLED=true
 *   METRICS_PUSH_ENDPOINT=http://localhost:9091/push
 *   METRICS_API_KEY=local-dev
 */

const http = require('http');
const { execFile } = require('child_process');
const os = require('os');

// =============================================================================
// Configuration
// =============================================================================

const CONFIG = {
  port: 9091,

  // Alert thresholds
  errorRateThreshold: 0.1,        // 10% error rate triggers alert
  errorWindowSeconds: 60,          // Window for calculating error rate
  dbLatencyThresholdMs: 500,       // DB latency > 500ms triggers alert
  wsConnectionDropThreshold: 10,   // 10+ drops in 60s triggers alert

  // System resource thresholds
  cpuThresholdPercent: 80,
  memoryThresholdPercent: 85,
  diskThresholdPercent: 90,

  // Notification cooldown (don't spam)
  notificationCooldownMs: 60000,   // 1 minute between same alerts

  // System check interval
  systemCheckIntervalMs: 30000,    // Check every 30 seconds
};

// =============================================================================
// State
// =============================================================================

const state = {
  // Rolling windows for rate calculation
  requests: [],           // { timestamp, isError }
  wsEvents: [],           // { timestamp, action }

  // Last notification times (for cooldown)
  lastNotifications: {},

  // Counters for display
  totalRequests: 0,
  totalErrors: 0,
  totalWsConnections: 0,
};

// =============================================================================
// macOS Notification Helper (using execFile for safety)
// =============================================================================

function notify(title, message, subtitle = '', sound = 'default') {
  const key = `${title}:${subtitle}`;
  const now = Date.now();

  // Check cooldown
  if (state.lastNotifications[key] &&
      now - state.lastNotifications[key] < CONFIG.notificationCooldownMs) {
    return; // Skip - too soon
  }

  state.lastNotifications[key] = now;

  // Sanitize inputs (remove quotes and special chars)
  const safeTitle = title.replace(/['"\\]/g, '');
  const safeMessage = message.replace(/['"\\]/g, '');
  const safeSubtitle = subtitle.replace(/['"\\]/g, '');
  const safeSound = sound.replace(/['"\\]/g, '');

  // Build AppleScript command
  const script = `display notification "${safeMessage}" with title "${safeTitle}" subtitle "${safeSubtitle}" sound name "${safeSound}"`;

  // Use execFile with osascript for safer execution
  execFile('osascript', ['-e', script], (err) => {
    if (err) {
      console.error('Notification failed:', err.message);
    }
  });
}

// =============================================================================
// Metrics Processing
// =============================================================================

function processMetrics(metrics) {
  const now = Date.now();

  for (const metric of metrics) {
    logMetric(metric);

    // Track for alerting
    switch (metric.name) {
      case 'css_http_request_total':
        state.totalRequests++;
        state.requests.push({
          timestamp: now,
          isError: metric.labels?.status_class === '5xx',
        });
        break;

      case 'css_http_errors_total':
        state.totalErrors++;
        state.requests.push({
          timestamp: now,
          isError: true,
        });
        break;

      case 'css_db_health_latency_ms':
        if (metric.value > CONFIG.dbLatencyThresholdMs) {
          notify(
            'CSS: Slow Database',
            `Latency: ${metric.value.toFixed(0)}ms (threshold: ${CONFIG.dbLatencyThresholdMs}ms)`,
            'Performance Warning',
            'Basso'
          );
        }
        break;

      case 'css_db_health_status':
        if (metric.value === 0) {
          notify(
            'CSS: Database Down',
            'Health check failed - database unreachable',
            'Critical',
            'Sosumi'
          );
        }
        break;

      case 'css_ws_connections_total':
        state.wsEvents.push({
          timestamp: now,
          action: metric.labels?.action,
        });
        if (metric.labels?.action === 'open') {
          state.totalWsConnections++;
        }
        break;
    }
  }

  // Clean old entries (older than window)
  const cutoff = now - (CONFIG.errorWindowSeconds * 1000);
  state.requests = state.requests.filter(r => r.timestamp > cutoff);
  state.wsEvents = state.wsEvents.filter(e => e.timestamp > cutoff);

  // Check error rate
  checkErrorRate();
  checkWsDrops();
}

function logMetric(metric) {
  const typeIcon = {
    counter: '+',
    gauge: '=',
    histogram: '~',
  }[metric.type] || '?';

  const labels = metric.labels
    ? Object.entries(metric.labels)
        .filter(([k]) => !['environment', 'version'].includes(k))
        .map(([k, v]) => `${k}=${v}`)
        .join(' ')
    : '';

  const value = typeof metric.value === 'number'
    ? metric.value.toFixed(2).padStart(10)
    : String(metric.value).padStart(10);

  console.log(
    `${typeIcon} ${metric.name.padEnd(35)} ${value}  ${labels}`
  );
}

function checkErrorRate() {
  if (state.requests.length < 5) return; // Need minimum samples

  const errors = state.requests.filter(r => r.isError).length;
  const rate = errors / state.requests.length;

  if (rate > CONFIG.errorRateThreshold) {
    notify(
      'CSS: High Error Rate',
      `${(rate * 100).toFixed(1)}% errors in last ${CONFIG.errorWindowSeconds}s`,
      `${errors}/${state.requests.length} requests failed`,
      'Basso'
    );
  }
}

function checkWsDrops() {
  const drops = state.wsEvents.filter(e => e.action === 'close').length;

  if (drops > CONFIG.wsConnectionDropThreshold) {
    notify(
      'CSS: WebSocket Drops',
      `${drops} connections closed in last ${CONFIG.errorWindowSeconds}s`,
      'Connection Issues',
      'Basso'
    );
  }
}

// =============================================================================
// System Resource Monitoring
// =============================================================================

function checkSystemResources() {
  // CPU (load average as proxy)
  const loadAvg = os.loadavg()[0]; // 1-minute average
  const cpuCount = os.cpus().length;
  const cpuPercent = (loadAvg / cpuCount) * 100;

  if (cpuPercent > CONFIG.cpuThresholdPercent) {
    notify(
      'CSS: High CPU Usage',
      `Load: ${loadAvg.toFixed(2)} (${cpuPercent.toFixed(0)}% of ${cpuCount} cores)`,
      'System Resource',
      'Basso'
    );
  }

  // Memory
  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  const usedPercent = ((totalMem - freeMem) / totalMem) * 100;

  if (usedPercent > CONFIG.memoryThresholdPercent) {
    const usedGB = ((totalMem - freeMem) / 1024 / 1024 / 1024).toFixed(1);
    const totalGB = (totalMem / 1024 / 1024 / 1024).toFixed(1);
    notify(
      'CSS: High Memory Usage',
      `${usedGB}GB / ${totalGB}GB (${usedPercent.toFixed(0)}%)`,
      'System Resource',
      'Basso'
    );
  }

  // Disk (check root and home)
  checkDiskUsage('/');
  checkDiskUsage(os.homedir());
}

function checkDiskUsage(path) {
  // Use execFile with separate args for safety
  execFile('df', ['-h', path], (err, stdout) => {
    if (err) return;

    // Parse the output - second line, 5th column
    const lines = stdout.trim().split('\n');
    if (lines.length < 2) return;

    const parts = lines[1].split(/\s+/);
    if (parts.length < 5) return;

    const usedPercent = parseInt(parts[4].replace('%', ''), 10);
    if (usedPercent > CONFIG.diskThresholdPercent) {
      notify(
        'CSS: Low Disk Space',
        `${path}: ${usedPercent}% used`,
        'System Resource',
        'Basso'
      );
    }
  });
}

// =============================================================================
// HTTP Server
// =============================================================================

const server = http.createServer((req, res) => {
  if (req.method === 'POST' && req.url === '/push') {
    let body = '';

    req.on('data', chunk => {
      body += chunk.toString();
    });

    req.on('end', () => {
      try {
        const data = JSON.parse(body);

        if (data.metrics && Array.isArray(data.metrics)) {
          console.log('\n--- Metrics Received ---');
          processMetrics(data.metrics);
          console.log('------------------------\n');
        }

        res.writeHead(200);
        res.end('OK');
      } catch (e) {
        console.error('Failed to parse metrics:', e.message);
        res.writeHead(400);
        res.end('Bad Request');
      }
    });
  } else if (req.method === 'GET' && req.url === '/status') {
    // Status endpoint for checking if receiver is running
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: 'running',
      stats: {
        totalRequests: state.totalRequests,
        totalErrors: state.totalErrors,
        totalWsConnections: state.totalWsConnections,
        recentRequests: state.requests.length,
        recentErrors: state.requests.filter(r => r.isError).length,
      },
    }, null, 2));
  } else {
    res.writeHead(404);
    res.end('Not Found');
  }
});

// =============================================================================
// Startup
// =============================================================================

console.log(`
╔═══════════════════════════════════════════════════════════════════╗
║           CSS Local Metrics Receiver                               ║
╠═══════════════════════════════════════════════════════════════════╣
║  Listening on: http://localhost:${CONFIG.port}/push                     ║
║  Status at:    http://localhost:${CONFIG.port}/status                   ║
╠═══════════════════════════════════════════════════════════════════╣
║  Configure .dev.vars:                                              ║
║    METRICS_ENABLED=true                                            ║
║    METRICS_PUSH_ENDPOINT=http://localhost:${CONFIG.port}/push           ║
║    METRICS_API_KEY=local-dev                                       ║
╠═══════════════════════════════════════════════════════════════════╣
║  Alert Thresholds:                                                 ║
║    Error Rate:     > ${(CONFIG.errorRateThreshold * 100).toString().padEnd(3)}% over ${CONFIG.errorWindowSeconds}s                          ║
║    DB Latency:     > ${CONFIG.dbLatencyThresholdMs}ms                                       ║
║    WS Drops:       > ${CONFIG.wsConnectionDropThreshold} in ${CONFIG.errorWindowSeconds}s                                 ║
║    CPU:            > ${CONFIG.cpuThresholdPercent}%                                          ║
║    Memory:         > ${CONFIG.memoryThresholdPercent}%                                          ║
║    Disk:           > ${CONFIG.diskThresholdPercent}%                                          ║
╚═══════════════════════════════════════════════════════════════════╝

Waiting for metrics...
`);

// Start server
server.listen(CONFIG.port, () => {
  // Send test notification on startup
  notify(
    'CSS Metrics Receiver',
    'Started and ready to receive metrics',
    `Port ${CONFIG.port}`,
    'Glass'
  );
});

// Start system resource monitoring
setInterval(checkSystemResources, CONFIG.systemCheckIntervalMs);

// Initial check
checkSystemResources();

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\nShutting down...');
  server.close();
  process.exit(0);
});
