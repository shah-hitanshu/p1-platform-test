/**
 * Branches, documents, versions, checkpoints and structures for the demo sites,
 * declared in the order they are inserted: every reference points at a row
 * above it.
 */

import { randomUUID } from 'node:crypto';
import * as schema from '../schema';
import { ALICE, SYSTEM_ACTOR, type Rows } from './ids';
import { acme, demoStore } from './sites';

const acmeMain = {
  id: randomUUID(),
  siteId: acme.id,
  name: 'main',
  description: 'Production branch',
  isMain: true,
  createdById: SYSTEM_ACTOR,
  createdByType: 'system',
};

const storeMain = {
  id: randomUUID(),
  siteId: demoStore.id,
  name: 'main',
  description: 'Production branch',
  isMain: true,
  createdById: SYSTEM_ACTOR,
  createdByType: 'system',
};

const holidayCampaign = {
  id: randomUUID(),
  siteId: acme.id,
  name: 'holiday-campaign-2024',
  description: 'Q4 holiday promotional updates',
  sourceBranchId: acmeMain.id,
  createdById: ALICE,
  createdByType: 'user',
};

const fixAboutTypo = {
  id: randomUUID(),
  siteId: acme.id,
  name: 'fix-about-typo',
  description: 'Fix typo on about page',
  status: 'review',
  sourceBranchId: acmeMain.id,
  createdById: ALICE,
  createdByType: 'user',
};

// Main branches first: the branch trigger rejects a source branch that is not
// main, and rows earlier in an insert are visible to later ones.
export const branches = [
  acmeMain,
  storeMain,
  holidayCampaign,
  fixAboutTypo,
] satisfies Rows<typeof schema.branches>;

const acmeHome = { id: randomUUID(), siteId: acme.id, path: 'pages/home' };
const acmeAbout = { id: randomUUID(), siteId: acme.id, path: 'pages/about' };
const acmeContact = { id: randomUUID(), siteId: acme.id, path: 'pages/contact' };
const acmeHeader = { id: randomUUID(), siteId: acme.id, path: 'components/header' };
const acmeFooter = { id: randomUUID(), siteId: acme.id, path: 'components/footer' };
const storeHome = { id: randomUUID(), siteId: demoStore.id, path: 'pages/home' };
const storeProducts = { id: randomUUID(), siteId: demoStore.id, path: 'pages/products' };
const storeCart = { id: randomUUID(), siteId: demoStore.id, path: 'pages/cart' };

export const documents = [
  acmeHome,
  acmeAbout,
  acmeContact,
  acmeHeader,
  acmeFooter,
  storeHome,
  storeProducts,
  storeCart,
] satisfies Rows<typeof schema.documents>;

const mainNav = { id: randomUUID(), siteId: acme.id };
const blog = { id: randomUUID(), siteId: acme.id };

export const siteStructures = [mainNav, blog] satisfies Rows<typeof schema.siteStructures>;

const acmeHomeV1 = {
  id: randomUUID(),
  documentId: acmeHome.id,
  branchId: acmeMain.id,
  versionNumber: 1,
  snapshot: {
    type: 'page',
    title: 'Welcome to Acme Corp',
    components: [{ type: 'Hero', props: { heading: 'Building the Future' } }],
  },
  createdById: SYSTEM_ACTOR,
  createdByType: 'system',
};

const acmeAboutV1 = {
  id: randomUUID(),
  documentId: acmeAbout.id,
  branchId: acmeMain.id,
  versionNumber: 1,
  snapshot: {
    type: 'page',
    title: 'About Us',
    components: [{ type: 'TextBlock', props: { content: 'Learn more about Acme Corp' } }],
  },
  createdById: SYSTEM_ACTOR,
  createdByType: 'system',
};

const storeHomeV1 = {
  id: randomUUID(),
  documentId: storeHome.id,
  branchId: storeMain.id,
  versionNumber: 1,
  snapshot: {
    type: 'page',
    title: 'Demo Store Home',
    components: [{ type: 'ProductGrid', props: { columns: 3 } }],
  },
  createdById: SYSTEM_ACTOR,
  createdByType: 'system',
};

export const documentVersions = [
  acmeHomeV1,
  acmeAboutV1,
  storeHomeV1,
] satisfies Rows<typeof schema.documentVersions>;

const acmeInitialRelease = {
  id: randomUUID(),
  branchId: acmeMain.id,
  name: 'Initial Release',
  message: 'Initial site launch',
  createdById: SYSTEM_ACTOR,
  createdByType: 'system',
  isFullSnapshot: true,
};

const storeLaunch = {
  id: randomUUID(),
  branchId: storeMain.id,
  name: 'Store Launch',
  message: 'Initial store launch',
  createdById: SYSTEM_ACTOR,
  createdByType: 'system',
  isFullSnapshot: true,
};

export const checkpoints = [
  acmeInitialRelease,
  storeLaunch,
] satisfies Rows<typeof schema.checkpoints>;

export const checkpointDocuments = [
  {
    checkpointId: acmeInitialRelease.id,
    documentId: acmeHome.id,
    documentVersionId: acmeHomeV1.id,
  },
  {
    checkpointId: acmeInitialRelease.id,
    documentId: acmeAbout.id,
    documentVersionId: acmeAboutV1.id,
  },
  {
    checkpointId: storeLaunch.id,
    documentId: storeHome.id,
    documentVersionId: storeHomeV1.id,
  },
] satisfies Rows<typeof schema.checkpointDocuments>;

const homeNode = {
  id: randomUUID(),
  structureId: mainNav.id,
  position: 0,
  name: 'Home',
  slug: 'home',
  nodeType: 'document',
  documentId: acmeHome.id,
};

const aboutNode = {
  id: randomUUID(),
  structureId: mainNav.id,
  position: 1,
  name: 'About',
  slug: 'about',
  nodeType: 'document',
  documentId: acmeAbout.id,
};

const contactNode = {
  id: randomUUID(),
  structureId: mainNav.id,
  position: 2,
  name: 'Contact',
  slug: 'contact',
  nodeType: 'document',
  documentId: acmeContact.id,
};

export const structureNodes = [
  homeNode,
  aboutNode,
  contactNode,
] satisfies Rows<typeof schema.structureNodes>;

type StructureNode = (typeof structureNodes)[number];

/** branch_structure_state carries the node rows as a denormalised tree. */
function treeEntry(node: StructureNode): Record<string, unknown> {
  return {
    id: node.id,
    name: node.name,
    path: `/${node.slug}`,
    slug: node.slug,
    children: [],
    nodeType: node.nodeType,
    isVisible: true,
    documentId: node.documentId,
  };
}

export const branchStructureState = [
  {
    branchId: acmeMain.id,
    structureId: mainNav.id,
    name: 'Main Navigation',
    slug: 'main-nav',
    description: 'Primary site navigation structure',
    structureType: 'hierarchy',
    structureTree: structureNodes.map(treeEntry),
    metadataSchema: {
      type: 'object',
      required: ['title'],
      properties: {
        title: { type: 'string', maxLength: 100 },
        keywords: { type: 'array', items: { type: 'string' } },
        description: { type: 'string', maxLength: 300 },
      },
    },
  },
  {
    branchId: acmeMain.id,
    structureId: blog.id,
    name: 'Blog',
    slug: 'blog',
    description: 'Blog post collection',
    structureType: 'collection',
    structureTree: [],
    metadataSchema: {
      type: 'object',
      required: ['title'],
      properties: { title: { type: 'string' } },
    },
  },
] satisfies Rows<typeof schema.branchStructureState>;

export const branchDocumentMetadata = [
  {
    branchId: acmeMain.id,
    structureId: mainNav.id,
    documentId: acmeHome.id,
    metadata: {
      title: 'Welcome to Acme Corp',
      keywords: ['acme', 'technology', 'innovation'],
      description: 'The official website of Acme Corporation',
    },
  },
  {
    branchId: acmeMain.id,
    structureId: mainNav.id,
    documentId: acmeAbout.id,
    metadata: {
      title: 'About Acme Corp',
      description: 'Learn about our history and mission',
    },
  },
] satisfies Rows<typeof schema.branchDocumentMetadata>;
