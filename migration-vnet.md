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

- **External Ingress:** `/apps/app` and `/apps/portal` will have Ingress set to **External (Anywhere)**. They get a public URL (e.g., `https://app.australiaeast.azurecontainerapps.io`) and are accessible to users.
- **Internal Ingress:** `bn-comp-s3-proxy` and `pgvector-proxy` will have Ingress set to **Internal (Limited to Container Apps Environment)**. They get an internal-only DNS URL (e.g., `http://bn-comp-s3-proxy.internal.australiaeast.azurecontainerapps.io`) and are **completely invisible** to the public internet. Only your frontend/backend apps inside the environment can call them.

---

**Step 2.1: Create the Virtual Network (VNet) & Subnets**

1. In Azure Portal, search for **Virtual Networks** and click **Create**.
2. Name it: `bn-comp-vnet`.
3. Under the **IP Addresses** tab, create three subnets:
   - `aca-subnet` (Size: /23 - e.g., 10.0.0.0/23). _This size is strictly required by Azure Container Apps._
     - **Subnet Delegation:** Select **`Microsoft.App/environments`**.
     - **Service Endpoints:** Select **`Microsoft.Storage`** and **`Microsoft.Sql`** from the dropdown. (This allows free private routing to Storage and DB).
     - **Enable private subnet:** **Uncheck this** (so your apps have outbound access to trigger.dev and upstash).
   - `db-subnet` (Size: /24 - e.g., 10.0.2.0/24).
     - **Subnet Delegation:** Select **`Microsoft.DBforPostgreSQL/flexibleServers`**. (Required for Postgres VNet Integration).
     - **Enable private subnet:** **Check this** (No outbound internet needed).
   - `private-endpoints-subnet` (Size: /24 - e.g., 10.0.3.0/24) - _Keep this only if you prefer Private Endpoints for storage, otherwise it's optional._

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
3. _Once created, you must recreate your existing apps in this new environment._

---

## 3. Dockerizing the Next.js Apps

Your repository already has a central, highly optimized multi-stage **`Dockerfile`** at the root of the workspace. Instead of using isolated sub-Dockerfiles (which prune dependencies and break package version hoisting), we will use the root `Dockerfile` with explicit target stages. This mirrors your local development environment perfectly.

### How it works:

- **`app` target:** Builds the compliance frontend (`@trycompai/app`) on top of Bun and produces a minimized Node runtime container using Next.js standalone outputs.
- **`portal` target:** Builds the employee portal (`@trycompai/portal`) using the same configuration.
- **`migrator` target:** Builds the ultra-minimal Prisma database migrator container.

---

## 4. Deploying to Azure

We will build all four core images locally and push them to your Azure Container Registry (`bncompairegistry.azurecr.io`). Once pushed, we will deploy them inside your secured environment using their respective `yaml` configuration files.

### Step 4.1: Build and Push All Production Images

Run these build commands from the root directory of your project:

```bash
# 1. Login to Azure Container Registry
az acr login --name bncompairegistry

# 2. Build and Push the Compliance Frontend ('comp-app')
docker build --target app -f Dockerfile --build-arg NEXT_PUBLIC_API_URL=https://compliance-api.businesstitan.com.au --build-arg NEXT_PUBLIC_BETTER_AUTH_URL=https://compliance-api.businesstitan.com.au --build-arg NEXT_PUBLIC_PORTAL_URL=https://trust.businesstitan.com.au --build-arg NEXT_PUBLIC_POSTHOG_KEY=phc_zCHDq4jAfWLpYrkYTewoWytfkmR46hVZ5hGTbS9JtjRt -t bncompairegistry.azurecr.io/comp-app:latest .
docker push bncompairegistry.azurecr.io/comp-app:latest

# 3. Build and Push the Employee Portal ('comp-portal')
docker build --target portal -f Dockerfile --build-arg NEXT_PUBLIC_API_URL=https://compliance-api.businesstitan.com.au --build-arg NEXT_PUBLIC_BETTER_AUTH_URL=https://compliance-api.businesstitan.com.au --build-arg NEXT_PUBLIC_PORTAL_URL=https://trust.businesstitan.com.au --build-arg NEXT_PUBLIC_POSTHOG_KEY=phc_zCHDq4jAfWLpYrkYTewoWytfkmR46hVZ5hGTbS9JtjRt -t bncompairegistry.azurecr.io/comp-portal:latest .
docker push bncompairegistry.azurecr.io/comp-portal:latest

# 4. Build and Push the API Backend ('comp-api')
docker build -f apps/api/Dockerfile.multistage -t bncompairegistry.azurecr.io/comp-api:latest .
docker push bncompairegistry.azurecr.io/comp-api:latest

# 5. Build and Push the Database Migrator ('comp-migrator')
docker build --target migrator -f Dockerfile -t bncompairegistry.azurecr.io/comp-migrator:latest .
docker push bncompairegistry.azurecr.io/comp-migrator:latest
```

---

### Step 4.2: Run Database Migrations in the VNet

Before deploying the services, we must execute the new Prisma database migrations securely inside the private VNet.

1. **Deploy the Migrator Job Configuration:**
   Apply the Manual Trigger job using the Azure CLI:
   ```bash
   az containerapp job create --name bn-comp-migrator --resource-group brokernote --yaml comp-migrator-job.yaml
   ```
2. **Execute Migrations:**
   Start the one-time job execution:
   ```bash
   az containerapp job start --name bn-comp-migrator --resource-group brokernote
   ```
   _This executes `bunx prisma migrate deploy` inside the VNet, upgrading your database in seconds. You can track progress in the Azure Portal under Container App Jobs -> Execution History._

---

### Step 4.3: Deploy and Update the Services

Once the migrations complete successfully, deploy/update your frontend and backend services using their respective VNet configurations:

```bash
# 1. Deploy the API Backend Service
az containerapp create --name bn-comp-ai --resource-group brokernote --yaml comp-api.yaml

# 2. Deploy the Compliance Frontend
az containerapp create --name bn-comp-app --resource-group brokernote --yaml comp-app.yaml

# 3. Deploy the Employee Portal
az containerapp create --name bn-comp-portal --resource-group brokernote --yaml comp-portal.yaml
```

---

## 5. Completed Tasks & Verification

### Done:

1. **Resolved esbuild conflicts:** Aligned entire workspace dependencies to use `esbuild@0.27.7` in the root `package.json` to prevent local hoisting version mismatches.
2. **Reverted AI SDK updates:** Reverted the root `package.json` back to `ai: ^5.0.179` and restored original lockfile dependency alignments. This fully resolves Next.js compile errors due to v6 breaking changes.
3. **Optimized build pipeline:** Migrated build commands to target the root `Dockerfile` multi-stage build, ensuring dependency hoisting and lockfile resolution are 100% consistent with local development.
4. **Aligned API Container Bun versions:** Updated `apps/api/Dockerfile.multistage` to run on Bun `1.2.8` to match the frontend apps perfectly.
5. **Configured YAML Deployment Descriptors:** Generated 4 premium, plug-and-play YAML deployment files (`comp-api.yaml`, `comp-app.yaml`, `comp-portal.yaml`, `comp-migrator-job.yaml`) to automate environment variable and secret injection.

### Ready for Execution:

- [ ] Spin up the `bn-comp-vnet` and delegated subnets in Azure.
- [ ] Build and push the 4 container images to `bncompairegistry`.
- [ ] Run the database migration job inside the VNet.
- [ ] Deploy the API and frontends using the new YAML configurations.
- [ ] Perform standard login validation checks.
- [ ] Decommission legacy database infrastructure.
