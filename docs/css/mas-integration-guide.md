# Integrating Applications with MAS (Membership Authorization Service)

> **Last Updated:** January 2026  
> **Owner Team:** Workspace Management ([#ask-workspace-management](https://pantheon.slack.com/archives/C04CZJ801RN))  
> **Repository:** [pantheon-systems/membership-authorization-service](https://github.com/pantheon-systems/membership-authorization-service)

## Overview

MAS (Membership Authorization Service) is Pantheon's authorization service powered by [Auth0 FGA](https://auth0.com/fine-grained-authorization). It provides centralized authorization for Pantheon applications, replacing legacy authorization in Yggdrasil.

MAS exposes two primary services:

| Service | Description |
|---------|-------------|
| **Memberships API** | GraphQL + REST APIs for CRUD operations on all Pantheon membership and relationship types |
| **Authorization Token Signer API** | OAuth2 token exchange server capable of encoding memberships and relationships into token scopes |

### What MAS Provides

- User ↔ Site memberships (e.g., `user123` has role `team_member` on `siteXYZ`)
- User ↔ Workspace memberships (e.g., `user123` has role `admin` on `workspaceABC`)
- Workspace ↔ Site relationships (e.g., `workspaceABC` is `parent` of `siteXYZ`)
- JWT tokens reflecting a user's granted roles with automatic inheritance

### Available Roles

- `unprivileged`
- `developer`
- `team_member`
- `admin`

> **Note:** Roles are hierarchical. Having `admin` role means you also have all roles "below" admin (`team_member`, `developer`, `unprivileged`).

---

## Integration Steps

### Step 1: Add Your Service Account to Invokers

Your GCP service account must be granted invoker permissions to access MAS. Submit a PR to the [`invokers.tf`](https://github.com/pantheon-systems/membership-authorization-service/blob/master/devops/terraform/gcp/invokers.tf) file.

**Add your service account to the appropriate list:**

```hcl
# For production access
prod_api_invokers = [
  # ... existing entries
  "serviceAccount:your-service@your-project.iam.gserviceaccount.com",
]

# For sandbox access
sbx_api_invokers = [
  # ... existing entries
  "serviceAccount:your-service@your-sandbox-project.iam.gserviceaccount.com",
]
```

**For admin-level access** (read/write all resources without user context), also add your service account to the **bypass list** in the same file.

> **Reference:** [Adding applications access to MAS](https://getpantheon.atlassian.net/wiki/spaces/wkm/pages/3861708819/Adding+applications+access+to+MAS)

### Step 2: Configure Authentication

MAS requires two layers of authentication:

#### Layer 1: GCP IAM Authentication (Load Balancer)

Your service must authenticate with a GCP identity token. The token's audience should include the MAS hostname.

```bash
# Generate identity token
gcloud auth print-identity-token --audiences="membership-authorization-api"
```

#### Layer 2: Application Authentication

Depending on your use case:

| Scenario | Authentication Method |
|----------|----------------------|
| Acting on behalf of a user | Include `X-Pantheon-Access-Token` header with user's dashboard token |
| Service-to-service (admin access) | Add SA to bypass list (no `X-Pantheon-Access-Token` needed) |

### Step 3: Make API Requests

#### Service URLs

| Environment | URL |
|-------------|-----|
| **Production** | `https://memberships.svc.pantheon.io` |
| **Sandbox** | `https://memberships.sbx.pantheon.io` |

#### Example: Get Users with Access to a Site

```bash
curl -H "Authorization: Bearer $(gcloud auth print-identity-token)" \
  "https://memberships.svc.pantheon.io/site/{site-id}/memberships/user?inherited=true&role={role}"
```

#### Example: Get Workspaces for a Site

```bash
curl -H "Authorization: Bearer $(gcloud auth print-identity-token)" \
  "https://memberships.svc.pantheon.io/site/{site-id}/relationships/workspace"
```

#### Example: With User Context

```bash
curl -H "Authorization: Bearer $(gcloud auth print-identity-token)" \
     -H "X-Pantheon-Access-Token: <user-access-token>" \
  "https://memberships.svc.pantheon.io/site/{site-id}/memberships/user"
```

### Step 4: Handle Pagination

Responses may be paginated. Check the `page_info` key in responses:

```json
{
  "data": [...],
  "page_info": {
    "has_next_page": true,
    "next_page_token": "abc123..."
  }
}
```

To fetch the next page, include the `page_token` query parameter:

```bash
curl -H "Authorization: Bearer ..." \
  "https://memberships.svc.pantheon.io/site/{site-id}/memberships/user?page_token=abc123..."
```

---

## API Documentation

API documentation is served by the MAS service but is behind the CloudRun load balancer. To access it locally:

```bash
# Proxy the sandbox API locally
gcloud run services proxy membership-authorization-api --project=pantheon-memberships-sbx

# Then open in browser
open http://127.0.0.1:8080/docs
```

### Key REST Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/site/{site-id}/memberships/user` | GET | List users with membership to a site |
| `/site/{site-id}/relationships/workspace` | GET | List workspaces associated with a site |
| `/workspace/{workspace-id}/memberships/user` | GET | List users with membership to a workspace |
| `/workspace/{workspace-id}/relationships/site` | GET | List sites in a workspace |

### Query Parameters

| Parameter | Description |
|-----------|-------------|
| `inherited` | Include inherited memberships (e.g., from parent workspaces) |
| `role` | Filter by specific role |
| `page_token` | Pagination cursor |

---

## Local Development

### Prerequisites

1. [Docker Badge](https://getpantheon.atlassian.net/wiki/spaces/VULCAN/pages/111968298/Docker+Badge)
2. [Vault Badge](https://getpantheon.atlassian.net/wiki/spaces/VULCAN/pages/979566719/Vault+Badge)
3. [Devbox](https://www.jetify.com/devbox/docs/installing_devbox/)

### Quick Start

```bash
# Install devbox (one-time)
curl -fsSL https://get.jetify.com/devbox | bash

# Authenticate with GCP (one-time)
gcloud auth login

# Start development environment
devbox shell

# Run MAS locally with remote sandbox
task remote-dev-api  # or remote-dev-signer, remote-dev-rotator, remote-dev-pubsub
```

This exposes MAS at `127.0.0.1:8080`, **bypassing all IAM/JWT authentication** for easy local testing.

### Alternative: Proxy to Sandbox

If you just need to query the shared sandbox environment:

```bash
task proxy-sandbox-api
# MAS available at 127.0.0.1:8080
```

### Disable Token Authorization (Local Only)

For local development, you can disable the `X-Pantheon-Access-Token` requirement by setting in your deployment:

```python
# membershipauthorization/config/settings.py
disable_token_authorization = True
```

> **Warning:** Never deploy this setting to shared environments.

---

## Troubleshooting

### 401 Unauthorized

**Cause:** Missing or invalid GCP identity token.

**Solution:**
- Ensure your service account is in `invokers.tf`
- Verify token audience includes `membership-authorization-api`
- Check token hasn't expired (tokens are valid for ~1 hour)

```bash
# Verify your identity
gcloud auth list

# Get fresh token
gcloud auth print-identity-token
```

### 403 Forbidden

**Cause:** GCP authentication passed, but application-level authorization failed.

**Solution:**
- Include valid `X-Pantheon-Access-Token` header, OR
- Add your service account to the bypass list for admin access

### Missing or empty header: X-Pantheon-Access-Token

**Cause:** Application requires user context but no token provided.

**Solution:**
- For user-context requests: obtain and pass the user's access token
- For service-to-service: add your SA to the bypass list

---

## Architecture

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────┐
│  Your Service   │────▶│  Cloud Run LB    │────▶│    MAS      │
│                 │     │  (IAM Auth)      │     │   API       │
└─────────────────┘     └──────────────────┘     └──────┬──────┘
                                                        │
                                                        ▼
                                                 ┌─────────────┐
                                                 │  Auth0 FGA  │
                                                 │  (Storage)  │
                                                 └─────────────┘
```

### Components

| Component | Description |
|-----------|-------------|
| **MAS API** | REST and GraphQL APIs for membership CRUD operations |
| **MAS Signer** | OAuth2 token exchange for encoding memberships into JWTs |
| **MAS Rotator** | Key rotation service (triggered by Cloud Scheduler) |
| **MAS PubSub** | Event processing for data migration from Yggdrasil |

---

## Grafbase Integration

If your service uses the Grafbase GraphQL gateway, MAS integration is handled through the `@permissions` directive. See:

- [ROUT-2951: Updated authorization of Grafbase with MAS](https://getpantheon.atlassian.net/wiki/spaces/cat/pages/4059103261/ROUT-2951+Updated+authorization+of+Grafbase+with+MAS)
- [ROUT-2601: @permissions directive and its use](https://getpantheon.atlassian.net/wiki/spaces/cat/pages/3903651848/ROUT-2601+permissions+directive+and+its+use)

---

## Resources

### Documentation

- [MAS Overview (Confluence)](https://getpantheon.atlassian.net/wiki/spaces/Catalog/pages/3465281585/Membership+Authorization+Service+MAS)
- [Adding Applications to MAS](https://getpantheon.atlassian.net/wiki/spaces/wkm/pages/3861708819/Adding+applications+access+to+MAS)
- [MAS Technical Design Document](https://getpantheon.atlassian.net/wiki/spaces/VULCAN/pages/2750447617/TDD+-+Membership+and+Authorization+Service)

### Code

- [GitHub Repository](https://github.com/pantheon-systems/membership-authorization-service)
- [Invokers Configuration](https://github.com/pantheon-systems/membership-authorization-service/blob/master/devops/terraform/gcp/invokers.tf)
- [Taskfile (available commands)](https://github.com/pantheon-systems/membership-authorization-service/blob/master/Taskfile.yaml)

### Monitoring

- [MAS Grafana Dashboard](https://pantheon.grafana.net/d/ce4bt2ej62sqoa/membership-authorization-service-valet)
- [MAS SLI/SLO](https://getpantheon.atlassian.net/wiki/spaces/VULCAN/pages/3488088070/MAS+SLI+SLO)

### Support

- **Slack:** [#ask-workspace-management](https://pantheon.slack.com/archives/C04CZJ801RN)
- **Team:** Workspace Management ([#workspace-management](https://pantheon.slack.com/archives/C094SKD28BS))

---

## Changelog

| Date | Change |
|------|--------|
| 2025-12 | MAS migration from Yggdrasil completed |
| 2025-10 | First external service integrations |
| 2024-Q3 | Initial MAS development began |
