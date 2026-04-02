# Exact Step-by-Step Migration Plan: Azure VNet & Git Patch Strategy

This plan provides the exact commands and steps needed to synchronize your fork safely without losing history, set up a secure Azure VNet, Dockerize your applications using Bun, and deploy them.

## 1. Safe Git Synchronization: The "Patch and Branch" Strategy

This approach extracts your custom work as a patch file, syncs the official code, and applies your patch on a pristine new branch. This is 100% safe as it never touches or rewrites your existing `main` branch.

**Step 1.1: Ensure your working directory is clean**

```bash
git checkout main
git status # Ensure there are no uncommitted changes
```

**Step 1.2: Connect to the original repository**

```bash
# Replace with the actual URL of the original repository
git remote add upstream <ORIGINAL_REPO_URL>
git fetch upstream
```

**Step 1.3: Extract your custom changes**

```bash
# This creates a single file containing all your custom commits from 'main'
git format-patch upstream/main --stdout > my_custom_changes.patch
```

**Step 1.4: Create the new migration branch**

```bash
# Create a fresh branch exactly mirroring the original repository's main branch
git checkout -b azure-migration upstream/main
```

**Step 1.5: Apply your custom changes to the new branch**

```bash
git apply my_custom_changes.patch
git add .
git commit -m "Applied custom comp-ai changes"
```

_You are now on `azure-migration`. It has the latest original code + your custom features. Your old `main` is untouched._

---

## 2. Infrastructure: Azure VNet & Securing Services (Cost-Effective Approach)

Instead of using **Private Endpoints** (which incur an hourly charge of ~$7.30/month each + data processing fees), you can achieve the exact same secure network boundary for **free** using:
1. **VNet Injection (Delegated Subnet)** for Azure PostgreSQL Flexible Server.
2. **VNet Service Endpoints** for Azure Storage (Blob Storage).

Both of these options keep all traffic within the Microsoft backbone network and block all public internet access, but cost **$0**.

### How Container App Isolation Works (Internal vs. External)
Even though your Container Apps Environment is **External** (has a public IP), individual apps within it are isolated using **Ingress** settings:
* **External Ingress:** `/apps/app` and `/apps/portal` will have Ingress set to **External (Anywhere)**. They get a public URL (e.g., `https://app.australiaeast.azurecontainerapps.io`) and are accessible to users.
* **Internal Ingress:** `bn-comp-s3-proxy` and `pgvector-proxy` will have Ingress set to **Internal (Limited to Container Apps Environment)**. They get an internal-only DNS URL (e.g., `http://bn-comp-s3-proxy.internal.australiaeast.azurecontainerapps.io`) and are **completely invisible** to the public internet. Only your frontend/backend apps inside the environment can call them.

---

**Step 2.1: Create the Virtual Network (VNet) & Subnets**

1. In Azure Portal, search for **Virtual Networks** and click **Create**.
2. Name it: `bn-comp-vnet`.
3. Under the **IP Addresses** tab, create three subnets:
   - `aca-subnet` (Size: /23 - e.g., 10.0.0.0/23). *This size is strictly required by Azure Container Apps.*
     - **Subnet Delegation:** Select **`Microsoft.App/environments`**.
     - **Service Endpoints:** Select **`Microsoft.Storage`** and **`Microsoft.Sql`** from the dropdown. (This allows free private routing to Storage and DB).
     - **Enable private subnet:** **Uncheck this** (so your apps have outbound access to trigger.dev and upstash).
   - `db-subnet` (Size: /24 - e.g., 10.0.2.0/24).
     - **Subnet Delegation:** Select **`Microsoft.DBforPostgreSQL/flexibleServers`**. (Required for Postgres VNet Integration).
     - **Enable private subnet:** **Check this** (No outbound internet needed).
   - `private-endpoints-subnet` (Size: /24 - e.g., 10.0.3.0/24) - *Keep this only if you prefer Private Endpoints for storage, otherwise it's optional.*

**Step 2.2: Lock Down the Database (VNet Integration - Free)**

If you are using Azure PostgreSQL Flexible Server:
1. Go to your Azure PostgreSQL Flexible Server.
2. Select **Networking** in the left menu.
3. Choose **Private access (VNet Integration)**.
4. Select `bn-comp-vnet` and the delegated `db-subnet` you created.
5. Save the changes. The database will now get a private IP inside `db-subnet` and be fully private and inaccessible from the public internet.

**Step 2.3: Lock Down Blob Storage (Service Endpoints - Free)**

1. Go to your Azure Storage Account (`bn-comp-ai`).
2. Go to **Networking** in the left menu.
3. Under **Public network access**, select **Enabled from selected virtual networks and IP addresses**.
4. Under **Virtual networks**, click **+ Add existing virtual network**.
5. Select `bn-comp-vnet` and `aca-subnet` (which has the `Microsoft.Storage` Service Endpoint enabled).
6. Click **Save**. Now, the storage account will block all public internet access, but will perfectly trust traffic coming out of your Container Apps subnet.

**Step 2.4: Create the Secured Container Apps Environment**

1. In Azure Portal, create a new **Container Apps Environment** (e.g., `bn-comp-secured-env`).
2. Under the **Networking** tab:
   - Set **Use your own virtual network** to **Yes**.
   - Select `bn-comp-vnet` and `aca-subnet`.
   - Set **Virtual IP** to **External** (so your frontends can be reached by clients).
3. *Once created, you must recreate your existing apps in this new environment.*

---

## 3. Dockerizing the Next.js Apps

Your project uses Bun. Here is the exact `Dockerfile` required to build a Next.js Turborepo with Bun and standalone output.

**Step 3.1: Create `/apps/app/Dockerfile`**
Create a new file at `apps/app/Dockerfile` and paste exactly this content:

```dockerfile
FROM node:20-alpine AS base
RUN apk update && apk add --no-cache libc6-compat
RUN npm install -g bun@1.3.3

FROM base AS builder
WORKDIR /app
RUN bun add -g turbo
COPY . .
RUN turbo prune @trycompai/app --docker

FROM base AS installer
WORKDIR /app
COPY --from=builder /app/out/json/ .
COPY --from=builder /app/out/bun.lockb ./bun.lockb
RUN bun install
COPY --from=builder /app/out/full/ .
COPY turbo.json turbo.json
ENV NEXT_OUTPUT_STANDALONE=true
RUN turbo build --filter=@trycompai/app

FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_OUTPUT_STANDALONE=true
COPY --from=installer /app/apps/app/.next/standalone ./
COPY --from=installer /app/apps/app/.next/static ./apps/app/.next/static
COPY --from=installer /app/apps/app/public ./apps/app/public

EXPOSE 3000
CMD ["node", "server.js"]
```

**Step 3.2: Create `/apps/portal/Dockerfile`**
Create a new file at `apps/portal/Dockerfile` and paste the exact same content as above, but change `@trycompai/app` to `@trycompai/portal` (on lines 9 and 20), and `apps/app` to `apps/portal` (on lines 27, 28, 29).

---

## 4. Deploying to Azure

**Step 4.1: Build and Push the Docker Images**
_(This can be done locally via CLI or added to GitHub Actions)_

```bash
# Login to Azure Container Registry
az acr login --name <YOUR_ACR_NAME>

# Build and Push 'app'
docker build -f apps/app/Dockerfile -t <YOUR_ACR_NAME>.azurecr.io/comp-app:latest .
docker push <YOUR_ACR_NAME>.azurecr.io/comp-app:latest

# Build and Push 'portal'
docker build -f apps/portal/Dockerfile -t <YOUR_ACR_NAME>.azurecr.io/comp-portal:latest .
docker push <YOUR_ACR_NAME>.azurecr.io/comp-portal:latest
```

**Step 4.2: Create the Frontend Container Apps**

1. In the Azure Portal, create a new **Container App**.
2. Name it `bn-comp-frontend-app`.
3. Select your new **secured environment** (`bn-comp-secured-env`).
4. Select the image you just pushed to ACR.
5. In **Ingress**, enable it, allow traffic from **Anywhere**, and set Target Port to **3000**.
6. In **Environment Variables**, copy your Vercel variables.
   - Ensure `DATABASE_URL` uses the private endpoint hostname.
   - Ensure your S3 variables route to the internal DNS of your `bn-comp-s3-proxy` app.

## Open Questions

- Do these exact steps make sense?
- Would you like me to go ahead and run the Git patch commands to setup your `azure-migration` branch right now?
- Would you like me to write the two Dockerfiles into the codebase for you?
