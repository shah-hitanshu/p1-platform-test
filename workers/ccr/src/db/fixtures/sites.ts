/**
 * Organizations, users, agents, sites, and the grants between them.
 *
 * Ids are generated per run, so they change whenever the database is rebuilt.
 * The exceptions are the pinned constants, which code outside the fixtures
 * hardcodes.
 */

import { randomUUID } from 'node:crypto';
import * as schema from '../schema';
import {
  ALICE,
  AUDI_SITE,
  BOB,
  CAROL,
  DEMO_SITE_2,
  DEMO_SITE_3,
  HELPER_AGENT,
  PANTHEON_AGENT,
  MOCK_ORG,
  ZAPPY_AGENT,
  type Rows,
} from './ids';

export const users = [
  {
    id: ALICE,
    email: 'alice@example.com',
    name: 'Alice Developer',
    principalId: ALICE,
    authProvider: 'mock',
    systemRole: 'member',
  },
  {
    id: BOB,
    email: 'bob@example.com',
    name: 'Bob Reviewer',
    principalId: BOB,
    authProvider: 'mock',
    systemRole: 'member',
  },
  {
    id: CAROL,
    email: 'carol@example.com',
    name: 'Carol Editor',
    principalId: CAROL,
    authProvider: 'mock',
    systemRole: 'member',
  },
] satisfies Rows<typeof schema.users>;

const mockOrg = { id: MOCK_ORG, name: 'Mock Organization (Local Development)' };

// Every user owns an account of their own, named after their email domain, and
// every site belongs to one. Nothing reads a user who belongs to no account.
const aliceOrg = { id: randomUUID(), name: 'Example' };
const bobOrg = { id: randomUUID(), name: 'Example 2' };
const carolOrg = { id: randomUUID(), name: 'Example 3' };

export const organizations = [
  mockOrg,
  aliceOrg,
  bobOrg,
  carolOrg,
] satisfies Rows<typeof schema.organizations>;

export const organizationMembers = [
  { organizationId: aliceOrg.id, userId: ALICE, role: 'owner' },
  { organizationId: bobOrg.id, userId: BOB, role: 'owner' },
  { organizationId: carolOrg.id, userId: CAROL, role: 'owner' },
] satisfies Rows<typeof schema.organizationMembers>;

export const agents = [
  {
    id: ZAPPY_AGENT,
    organizationId: mockOrg.id,
    name: 'Zappy AI Assistant',
    description: 'Mock agent for local development and testing',
    capabilities: ['content_edit', 'content_create'],
  },
  {
    id: HELPER_AGENT,
    organizationId: mockOrg.id,
    name: 'Helper Bot',
    description: 'Secondary mock agent for testing',
    capabilities: ['content_edit'],
  },
  {
    id: PANTHEON_AGENT,
    organizationId: mockOrg.id,
    name: 'Pantheon Agent',
    description: 'Platform agent, visible on every site',
    capabilities: ['content_edit', 'content_create'],
    isGlobal: true,
  },
] satisfies Rows<typeof schema.agents>;

// The two sites with demo content: branches and documents reference these.
export const acme = {
  id: randomUUID(),
  organizationId: aliceOrg.id,
  pantheonSiteId: 'site-acme-corp',
  name: 'Acme Corp Website',
  workflowSettings: {
    approverMode: 'role_based',
    minApprovers: 1,
    approverMinRole: 'EDITOR',
    allowSelfApproval: false,
    mergeApprovalMode: 'required',
  },
};

export const demoStore = {
  id: randomUUID(),
  organizationId: aliceOrg.id,
  pantheonSiteId: 'site-demo-store',
  name: 'Demo Store',
  workflowSettings: {
    approverMode: 'both',
    minApprovers: 1,
    approverMinRole: 'EDITOR',
    allowSelfApproval: true,
    mergeApprovalMode: 'optional',
  },
};

/** The three sites the mock agents hold grants on. */
const agentGrantedSettings = {
  minApprovers: 1,
  allowSelfApproval: true,
  mergeApprovalMode: 'optional',
};
const audi = {
  id: AUDI_SITE,
  organizationId: aliceOrg.id,
  pantheonSiteId: 'audi-demo-site',
  name: 'Audi Demo Site',
  workflowSettings: agentGrantedSettings,
};
const demo2 = {
  id: DEMO_SITE_2,
  organizationId: aliceOrg.id,
  pantheonSiteId: 'demo-site-2',
  name: 'Demo Site 2',
  workflowSettings: agentGrantedSettings,
};
const demo3 = {
  id: DEMO_SITE_3,
  organizationId: aliceOrg.id,
  pantheonSiteId: 'demo-site-3',
  name: 'Demo Site 3',
  workflowSettings: agentGrantedSettings,
};

export const sites = [acme, demoStore, audi, demo2, demo3] satisfies Rows<typeof schema.sites>;

export const userSiteRoles = [
  { userId: ALICE, siteId: audi.id, role: 'admin' },
  { userId: BOB, siteId: audi.id, role: 'team_member' },
  { userId: CAROL, siteId: audi.id, role: 'developer' },
  { userId: ALICE, siteId: acme.id, role: 'owner', createdById: ALICE },
  { userId: ALICE, siteId: demoStore.id, role: 'owner', createdById: ALICE },
  { userId: ALICE, siteId: demo2.id, role: 'owner', createdById: ALICE },
  { userId: ALICE, siteId: demo3.id, role: 'owner', createdById: ALICE },
  { userId: CAROL, siteId: acme.id, role: 'owner', createdById: CAROL },
  { userId: CAROL, siteId: demoStore.id, role: 'owner', createdById: CAROL },
  { userId: CAROL, siteId: demo2.id, role: 'owner', createdById: CAROL },
  { userId: CAROL, siteId: demo3.id, role: 'owner', createdById: CAROL },
] satisfies Rows<typeof schema.userSiteRoles>;

export const agentSiteRoles = [
  { agentId: ZAPPY_AGENT, siteId: audi.id, role: 'admin' },
  { agentId: ZAPPY_AGENT, siteId: demo2.id, role: 'admin' },
  { agentId: ZAPPY_AGENT, siteId: demo3.id, role: 'admin' },
] satisfies Rows<typeof schema.agentSiteRoles>;
