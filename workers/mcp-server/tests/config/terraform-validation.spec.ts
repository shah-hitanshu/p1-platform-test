/**
 * Terraform Configuration Validation Tests
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '../../../../');

describe('Terraform MCP Module', () => {
  // Test 88: KV namespace resource
  it('should create KV namespace resource for OAuth', () => {
    const tfPath = resolve(repoRoot, 'terraform/modules/cloudflare-mcp/main.tf');
    const content = readFileSync(tfPath, 'utf-8');
    expect(content).toContain('cloudflare_workers_kv_namespace');
    expect(content).toContain('mcp_oauth_kv');
  });

  // Test 89: Output KV namespace ID
  it('should output KV namespace ID', () => {
    const tfPath = resolve(repoRoot, 'terraform/modules/cloudflare-mcp/main.tf');
    const content = readFileSync(tfPath, 'utf-8');
    expect(content).toContain('output "mcp_oauth_kv_id"');
  });

  // Test 90: sbx1 includes MCP module
  it('should include MCP module in sbx1 environment', () => {
    const tfPath = resolve(repoRoot, 'terraform/environments/sbx1/main.tf');
    const content = readFileSync(tfPath, 'utf-8');
    expect(content).toContain('module "cloudflare_mcp"');
    expect(content).toContain('../../modules/cloudflare-mcp');
  });

  // Test 91: sbx1 outputs MCP KV ID
  it('should output mcp_oauth_kv_id from sbx1', () => {
    const tfPath = resolve(repoRoot, 'terraform/environments/sbx1/main.tf');
    const content = readFileSync(tfPath, 'utf-8');
    expect(content).toContain('output "mcp_oauth_kv_id"');
    expect(content).toContain('module.cloudflare_mcp.mcp_oauth_kv_id');
  });
});
