# Bootstrap Guide: New Local Environment Setup

This guide walks you through setting up a fresh local development environment from scratch.

## Prerequisites

Before starting, ensure you have:

1. **PostgreSQL running** via Docker/Podman:
   ```bash
   make docker-up
   ```

2. **Database migrations applied**:
   ```bash
   make migrate
   ```

3. **Workers dev server running**:
   ```bash
   cd workers && pnpm dev --local
   # Or from root: make dev
   ```

4. **Frontend dev server running** (optional, for UI testing):
   ```bash
   cd frontend && pnpm dev
   ```

---

## Step 1: Add Yourself as an Admin User

When the database is empty, the system runs in "bootstrap mode" and skips the user allowlist. Once you add the first user, the allowlist is enforced for all requests.

**Add yourself as an admin:**

```bash
podman exec css-postgres psql -U cssuser -d cssdb -c \
  "INSERT INTO app.users (email, name, system_role, is_active) 
   VALUES ('your.email@pantheon.io', 'Your Name', 'admin', true) 
   RETURNING id, email, name, system_role;"
```

Replace `your.email@pantheon.io` with the email address from your OAuth provider (Auth0 or Google).

**Verify the user was created:**

```bash
podman exec css-postgres psql -U cssuser -d cssdb -c \
  "SELECT id, email, name, system_role, is_active FROM app.users;"
```

---

## Step 2: Create Your First Site

Sites are created via the REST API. You'll need to authenticate first.

### Option A: Using Mock Login (Development)

If you're running with mock authentication enabled (no real OAuth configured):

```bash
# Get a mock token for the first mock user
MOCK_TOKEN="mock-user-1"

# Create a site
curl -X POST http://localhost:8787/api/sites \
  -H "Authorization: Bearer ${MOCK_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "My First Site",
    "pantheonSiteId": "00000000-0000-0000-0000-000000000001"
  }'
```

### Option B: Using Real Authentication (Broker + Auth0)

If you're using the broker authentication flow:

1. **Get a Site API Token (SAT)** - see Step 3 below first
2. **Use the SAT to authenticate** instead of a user token

---

## Step 3: Create a Site API Token (SAT)

Site API Tokens allow applications (like the frontend) to make authenticated requests scoped to a specific site.

### Using cURL (with mock auth):

```bash
SITE_ID="<your-site-id-from-step-2>"
MOCK_TOKEN="mock-user-1"

curl -X POST http://localhost:8787/api/sites/${SITE_ID}/tokens \
  -H "Authorization: Bearer ${MOCK_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Local Development Token",
    "expiresInDays": 90
  }'
```

**Save the response** - it contains your SAT:

```json
{
  "id": "...",
  "siteId": "...",
  "name": "Local Development Token",
  "token": "sat_xxxxxxxxxxxxxxxxxxxxx",
  "createdAt": "...",
  "expiresAt": "..."
}
```

**⚠️ Important**: The `token` field is only shown once. Save it securely.

### Verify the SAT works:

```bash
SAT="sat_xxxxxxxxxxxxxxxxxxxxx"

curl http://localhost:8787/api/sites/${SITE_ID} \
  -H "Authorization: Bearer ${SAT}"
```

You should see your site details returned.

---

## Step 4: Set Up Frontend Environment (Optional)

If you're using the frontend, configure it to use your site:

1. **Copy the example env file:**
   ```bash
   cp frontend/.env.example frontend/.env
   ```

2. **Edit `frontend/.env`** to configure authentication:
   - For **mock auth**: Set `VITE_ENABLE_MOCK_LOGIN=true`
   - For **Auth0**: Set the Auth0 credentials (see `frontend/.env.example`)

3. **Start the frontend:**
   ```bash
   cd frontend && pnpm dev
   ```

4. **Access the UI** at http://localhost:5173

---

## Step 5: Create Your First Document

With a site and authentication set up, you can create documents:

```bash
SITE_ID="<your-site-id>"
SAT="sat_xxxxxxxxxxxxxxxxxxxxx"

# Get the main branch ID
BRANCH_RESPONSE=$(curl -s http://localhost:8787/api/sites/${SITE_ID}/branches \
  -H "Authorization: Bearer ${SAT}")

MAIN_BRANCH_ID=$(echo $BRANCH_RESPONSE | jq -r '.branches[] | select(.name == "main") | .id')

# Create a document
curl -X POST http://localhost:8787/api/sites/${SITE_ID}/branches/${MAIN_BRANCH_ID}/documents \
  -H "Authorization: Bearer ${SAT}" \
  -H "Content-Type: application/json" \
  -d '{
    "path": "/homepage",
    "snapshot": {
      "title": "Welcome to My Site",
      "content": "Hello, world!"
    }
  }'
```

---

## Step 6: Verify Everything Works

Run a quick verification:

```bash
# 1. Check database connectivity
podman exec css-postgres psql -U cssuser -d cssdb -c "SELECT 1;"

# 2. Check worker is running
curl http://localhost:8787/health

# 3. List your sites
curl http://localhost:8787/api/sites \
  -H "Authorization: Bearer ${SAT}"

# 4. List documents on main branch
curl http://localhost:8787/api/sites/${SITE_ID}/branches/${MAIN_BRANCH_ID}/documents \
  -H "Authorization: Bearer ${SAT}"
```

---

## Troubleshooting

### "User not authorized" (403 Error)

- Ensure your email in `app.users` matches the email from your OAuth provider
- Check that `is_active = true` in the database
- Verify you're using the correct authentication method (mock vs. real OAuth)

### "Transaction not found" during broker login

- The broker flow requires a SAT to initiate the login transaction
- You need to create a site and SAT first using mock auth, then use the broker for subsequent logins

### Documents failing to create with UUID errors

- Ensure you've logged out and back in after adding yourself to `app.users`
- The system needs to link your `principal_id` to your database user record
- Check worker logs: `tail -f /tmp/css-worker-dev.log`

### Database connection errors

- Verify PostgreSQL is running: `podman ps | grep css-postgres`
- Check connection string in `workers/.dev.vars`
- Restart database: `make docker-restart`

---

## Common Workflows

### Add Another User

```bash
podman exec css-postgres psql -U cssuser -d cssdb -c \
  "INSERT INTO app.users (email, name, system_role, is_active) 
   VALUES ('colleague@pantheon.io', 'Colleague Name', 'member', true);"
```

### List All Sites

```bash
curl http://localhost:8787/api/sites \
  -H "Authorization: Bearer ${SAT}"
```

### Create a New Branch

```bash
curl -X POST http://localhost:8787/api/sites/${SITE_ID}/branches \
  -H "Authorization: Bearer ${SAT}" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "feature-branch",
    "sourceBranchId": "'${MAIN_BRANCH_ID}'"
  }'
```

### Reset Your Local Environment

```bash
# WARNING: This deletes all data!
make docker-clean
make docker-up
make migrate
# Then repeat Steps 1-3 above
```

---

## Next Steps

- **Read the API documentation**: See `README.md` for the full API reference
- **Explore real-time collaboration**: Connect multiple clients to the same document via WebSocket
- **Set up branch-based workflows**: Create branches, make edits, and merge back to main
- **Test conflict resolution**: Make concurrent edits and observe CRDT merge behavior

For more information, see:
- `README.md` - Full project documentation
- `CLAUDE.md` - Development guidelines and architecture
- `PROGRESS.md` - Implementation status and decisions
