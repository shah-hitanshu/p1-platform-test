# Puck + CSS Integration

Puck editor integration with the Collaborative State System (CSS).

## Packages

This monorepo contains two packages:

### @pantheon/css-client

Standalone TypeScript API client for the Collaborative State System.

```typescript
import { CSSClient } from '@pantheon/css-client';

const client = new CSSClient({
  baseUrl: 'http://localhost:8787',
  apiKey: 'your-api-key',
  principal: { id: 'user-123', type: 'user' },
});

// List sites
const sites = await client.sites.list();

// Get branches
const branches = await client.branches.list(siteId);

// Save document version (Puck data)
const version = await client.versions.create(siteId, {
  documentId,
  branchId,
  snapshot: puckData, // { content: [...], root: {...} }
});

// Create checkpoint
const checkpoint = await client.checkpoints.create(siteId, {
  branchId,
  name: 'Release v1.0',
});
```

### @pantheon/puck-css (coming soon)

React components and hooks for integrating Puck editor with CSS.

## Development

### Prerequisites

- Node.js 18+
- pnpm 9+

### Setup

```bash
# Install dependencies
pnpm install

# Build all packages
pnpm build

# Run tests
pnpm test

# Lint
pnpm lint
```

### Project Structure

```
puck-css-integration/
├── packages/
│   ├── css-client/          # @pantheon/css-client
│   └── puck-css/            # @pantheon/puck-css (coming soon)
└── apps/
    └── demo/                # Demo application (coming soon)
```

## Architecture

See the [integration plan](/.claude/plans/puck-css-integration.md) for detailed architecture decisions.

### Key Decisions

- **Data mapping**: Puck `Data` object stored as CSS document `snapshot`
- **Auto-save**: 3-second debounce creates document versions
- **Publish**: Manual action creates checkpoints
- **Version comparison**: Side-by-side render with change highlights
- **Authentication**: API key + user login with per-user attribution
- **Branch handling**: UI selector with future Change Set extensibility

## License

MIT
