# Master Production Deployment Run-Sheet: Secure VNet Container Architecture

This runsheet provides the step-by-step instructions to initialize, secure, build, and deploy the secure VNet-integrated container architecture for the Comp AI platform.

---

## 🔑 Phase 1: Key Vault Secrets Setup (`brokernote-prod`)

To achieve zero-trust secrets management, all confidential credentials are stored securely in your Azure Key Vault (`brokernote-prod`) and dynamically pulled by your Container Apps using **System-Assigned Managed Identity**.

### 1.1 Automated Secret Provisioning
To avoid checking sensitive production credentials into Git, we have created an automated PowerShell script:
* **[upload-secrets.ps1](file:///c:/Users/mail/Development/comp-ai/upload-secrets.ps1)** (Automatically excluded via `.gitignore`)

Run the script locally to set up all 18 secrets inside the Key Vault:
```powershell
# Authenticate with Azure CLI first
az login

# Run the gitignored upload script
.\upload-secrets.ps1
```

### 1.2 Secret Checklist
Verify in the Azure Portal or via CLI that these exact secret keys are now present in `brokernote-prod`:

| Key Vault Secret Name | Purpose |
| :--- | :--- |
| `DATABASE-URL` | PostgreSQL connection string for API, App, Portal and Migrator |
| `VECTOR-DATABASE-URL` | PGVector connection string for pgvector-proxy |
| `PGVECTOR-PROXY-TOKEN` | API Token verifying pgvector-proxy connections |
| `AUTH-SECRET` | Better Auth secret key |
| `BETTER-AUTH-SECRET` | Better Auth primary application secret |
| `OPENAI-API-KEY` | OpenAI API access token |
| `TRIGGER-SECRET-KEY` | Trigger.dev secret key |
| `RESEND-API-KEY` | Email provider integration key |
| `SECRET-KEY` | Cryptographic secret key |
| `ENCRYPTION-KEY` | Application payload encryption key |
| `FIRECRAWL-API-KEY` | Firecrawl parsing crawler token |
| `UPSTASH-REDIS-REST-TOKEN` | Rate limiting and redis cache token |
| `UPSTASH-VECTOR-REST-TOKEN` | Vector cache verification token |
| `REVALIDATION-SECRET` | Next.js cache revalidation trigger token |
| `S3PROXY-IDENTITY` | S3 Proxy access key ID |
| `S3PROXY-CREDENTIAL` | S3 Proxy secret access key |
| `JCLOUDS-IDENTITY` | Blob storage backend account |
| `JCLOUDS-CREDENTIAL` | Blob storage backend primary access key |

---

## 🛠️ Phase 2: Local Container Compilation

Ensure you are logged into your Azure Container Registry, then build and push your clean container stack:

```bash
# 1. Authenticate with Azure Container Registry
az acr login --name bncompairegistry

# 2. Build & Push Compliance Frontend ('comp-app')
docker build --target app -f Dockerfile \
  --build-arg NEXT_PUBLIC_API_URL=https://compliance-api.businesstitan.com.au \
  --build-arg NEXT_PUBLIC_BETTER_AUTH_URL=https://compliance-api.businesstitan.com.au \
  --build-arg NEXT_PUBLIC_PORTAL_URL=https://trust.businesstitan.com.au \
  -t bncompairegistry.azurecr.io/comp-app:latest .
docker push bncompairegistry.azurecr.io/comp-app:latest

# 3. Build & Push Employee Portal ('comp-portal')
docker build --target portal -f Dockerfile \
  --build-arg NEXT_PUBLIC_API_URL=https://compliance-api.businesstitan.com.au \
  --build-arg NEXT_PUBLIC_BETTER_AUTH_URL=https://compliance-api.businesstitan.com.au \
  -t bncompairegistry.azurecr.io/comp-portal:latest .
docker push bncompairegistry.azurecr.io/comp-portal:latest

# 4. Build & Push API Backend ('comp-api')
docker build -f apps/api/Dockerfile.multistage -t bncompairegistry.azurecr.io/comp-api:latest .
docker push bncompairegistry.azurecr.io/comp-api:latest

# 5. Build & Push Database Migrator ('comp-migrator')
docker build --target migrator -f Dockerfile -t bncompairegistry.azurecr.io/comp-migrator:latest .
docker push bncompairegistry.azurecr.io/comp-migrator:latest
```

---

## 🚀 Phase 3: VNet Infrastructure & Proxy Deployment

Follow this exact deployment sequence to establish secure internal proxies and execute network-isolated database migrations.

> [!WARNING]
> **Name Conflict Cleanup:** Container App names are scoped strictly to the **Resource Group** in Azure. You cannot have two Container Apps with the same name inside the `brokernote` resource group, even if they reside in different Environments (`bn-comp-environment` vs `bn-comp-secured-env`). 
> 
> To deploy the new secure VNet-integrated containers under your active production names, you **must delete the old Container Apps first**:
> ```bash
> # 1. Delete old applications
> az containerapp delete --name bn-comp-app --resource-group brokernote --yes
> az containerapp delete --name bn-comp-portal --resource-group brokernote --yes
> az containerapp delete --name bn-comp-ai --resource-group brokernote --yes
> 
> # 2. Delete old proxies
> az containerapp delete --name bn-comp-s3-proxy --resource-group brokernote --yes
> az containerapp delete --name pgvector-proxy --resource-group brokernote --yes
> ```
> *(Note: Your databases and Azure Storage Accounts themselves are separate standalone resources and are **not** affected or deleted by deleting these stateless Container Apps. Your data is 100% safe!)*

---

### 3.1 Step 1: Deploy Proxies (Internal VNet Routing)
Deploy the private storage and vector databases:

```bash
# Deploy S3/Azure Storage Proxy Service
az containerapp create --name bn-comp-s3-proxy --resource-group brokernote --yaml bn-comp-s3-proxy.yaml

# Deploy PGVector proxy database router
az containerapp create --name pgvector-proxy --resource-group brokernote --yaml pgvector-proxy.yaml
```

---

### 3.2 Step 2: Grant Managed Identity Access to Key Vault (Azure RBAC)
Since `brokernote-prod` is configured with modern **Azure RBAC authorization** (rather than legacy Access Policies), you authorize the container apps by assigning the **"Key Vault Secrets User"** role.

For each Container App you deploy, follow this two-step process:

1. **Retrieve the App's Principal ID:**
   ```bash
   az containerapp show \
     --name <APP_NAME> \
     --resource-group brokernote \
     --query identity.principalId \
     -o tsv
   ```

2. **Assign the Key Vault Secrets User Role:** (Replace `<PRINCIPAL_ID>` with the value returned above):
   ```bash
   az role assignment create \
     --assignee <PRINCIPAL_ID> \
     --role "Key Vault Secrets User" \
     --scope /subscriptions/8dba55e9-48ec-42f1-862c-fc14449f7c8b/resourceGroups/brokernote/providers/Microsoft.KeyVault/vaults/brokernote-prod
   ```

*(Run this for `bn-comp-s3-proxy`, `pgvector-proxy` now, and `bn-comp-ai`, `bn-comp-app`, `bn-comp-portal` as you deploy them!).*

---

### 3.3 Step 3: Execute VNet Database Migrations
Run your manual migration container job to apply Prisma schemas securely within the VNet boundary:

```bash
# 1. Provision the manual container job
az containerapp job create --name bn-comp-migrator --resource-group brokernote --yaml comp-migrator-job.yaml

# 2. Trigger the migration run
az containerapp job start --name bn-comp-migrator --resource-group brokernote

# 3. Stream the migration logs in real-time (press Ctrl+C to exit once completed)
az containerapp job logs show --name bn-comp-migrator --resource-group brokernote --follow
```
*Tip: The `log show --follow` command will stream the standard console output of your Prisma migrations directly in your terminal, showing exactly which tables are created and when the migration finishes successfully.*

---

## 🌐 Phase 4: Deploy Main Applications (Auto-Endpoints First)

To prevent circular dependencies where custom domains or certificates are required before the apps exist, we deploy the applications first using their standard auto-generated Azure endpoints. Once the containers are running, we bind custom domains/certificates and finally lock them in.

### 4.1 Step 1: Clean customDomains from `comp-api.yaml` for Initial Deploy
If `comp-api.yaml` contains `customDomains` on the first run, the deployment will fail because the managed certificate doesn't exist yet.
*Comment out the `customDomains` block in `comp-api.yaml` (lines 20-23) temporarily before running the deployment command.*

### 4.2 Step 2: Deploy Container Services (The Chicken-and-Egg Fix)
Because our YAML files use `keyVaultUrl`, the apps must have `Key Vault Secrets User` permission *before* Azure can apply the YAML. However, the System-Assigned Identity isn't created until the app exists! 

To solve this, we create the apps as "empty shells", grant them permissions, and *then* apply the YAML.

**For `bn-comp-ai`:**
```bash
# 1. Create the empty shell to generate the Identity
az containerapp create --name bn-comp-ai --resource-group brokernote --environment bn-comp-secured-env --image mcr.microsoft.com/k8se/quickstart:latest --system-assigned

# 2. Get the Principal ID and Grant Key Vault Access
PRINCIPAL_ID=$(az containerapp show --name bn-comp-ai --resource-group brokernote --query identity.principalId -o tsv)
az role assignment create --assignee $PRINCIPAL_ID --role "Key Vault Secrets User" --scope /subscriptions/8dba55e9-48ec-42f1-862c-fc14449f7c8b/resourceGroups/brokernote/providers/Microsoft.KeyVault/vaults/brokernote-prod

# 3. Apply the YAML (now that it has permissions!)
az containerapp update --name bn-comp-ai --resource-group brokernote --yaml comp-api.yaml
```

**For `bn-comp-app`:**
```bash
az containerapp create --name bn-comp-app --resource-group brokernote --environment bn-comp-secured-env --image mcr.microsoft.com/k8se/quickstart:latest --system-assigned
PRINCIPAL_ID=$(az containerapp show --name bn-comp-app --resource-group brokernote --query identity.principalId -o tsv)
az role assignment create --assignee $PRINCIPAL_ID --role "Key Vault Secrets User" --scope /subscriptions/8dba55e9-48ec-42f1-862c-fc14449f7c8b/resourceGroups/brokernote/providers/Microsoft.KeyVault/vaults/brokernote-prod
az containerapp update --name bn-comp-app --resource-group brokernote --yaml comp-app.yaml
```

**For `bn-comp-portal`:**
```bash
az containerapp create --name bn-comp-portal --resource-group brokernote --environment bn-comp-secured-env --image mcr.microsoft.com/k8se/quickstart:latest --system-assigned
PRINCIPAL_ID=$(az containerapp show --name bn-comp-portal --resource-group brokernote --query identity.principalId -o tsv)
az role assignment create --assignee $PRINCIPAL_ID --role "Key Vault Secrets User" --scope /subscriptions/8dba55e9-48ec-42f1-862c-fc14449f7c8b/resourceGroups/brokernote/providers/Microsoft.KeyVault/vaults/brokernote-prod
az containerapp update --name bn-comp-portal --resource-group brokernote --yaml comp-portal.yaml
```

---

## 🔒 Phase 5: Custom Domain & Certificate Migration

Azure Container Apps requires DNS verification before binding custom domains. Here is how to complete DNS setup and bind domains:

### 5.1 Step 1: Remove Old Custom Domains from Vercel & Old Apps
1. **Remove domains from Vercel:** If your domains (e.g., `compliance.businesstitan.com.au`, `trust.businesstitan.com.au`, `compliance-api.businesstitan.com.au`) are currently delegated to active Vercel projects, they must be removed to avoid DNS routing conflicts:
   ```bash
   vercel domains rm compliance.businesstitan.com.au
   vercel domains rm trust.businesstitan.com.au
   vercel domains rm compliance-api.businesstitan.com.au
   ```
2. **Remove domains from old Container App:**
   ```bash
   az containerapp hostname remove --name bn-comp-ai --resource-group brokernote --hostname compliance-api.businesstitan.com.au
   ```

### 5.2 Step 2: Retrieve the Environment Domain Verification ID
Get the verification code for your secure environment (`bn-comp-secured-env`):
```bash
az containerapp env show \
  --name bn-comp-secured-env \
  --resource-group brokernote \
  --query properties.customDomainConfiguration.customDomainVerificationId \
  -o tsv
```

### 5.3 Step 3: Configure DNS Records in your Registrar
Add these records in your DNS provider (e.g. Cloudflare, Route53, GoDaddy) for **each domain**:

| Domain | DNS Record Type | Name / Host | Target / Value |
| :--- | :--- | :--- | :--- |
| **API Domain** | `TXT` | `asuid.compliance-api` | *[Your Environment Domain Verification ID]* |
| | `CNAME` | `compliance-api` | `bn-comp-ai.nicesky-[suffix].australiaeast.azurecontainerapps.io` |
| **App Domain** | `TXT` | `asuid.compliance` | *[Your Environment Domain Verification ID]* |
| | `CNAME` | `compliance` | `bn-comp-app.nicesky-[suffix].australiaeast.azurecontainerapps.io` |
| **Portal Domain** | `TXT` | `asuid.trust` | *[Your Environment Domain Verification ID]* |
| | `CNAME` | `trust` | `bn-comp-portal.nicesky-[suffix].australiaeast.azurecontainerapps.io` |

### 5.4 Step 4: Bind Custom Domains and Auto-Create Certificates
Once the DNS records have propagated, bind the custom domains to each Container App. Azure will automatically generate and bind the **Managed Certificate** under `bn-comp-secured-env` for you:

```bash
# 1. Bind API Custom Domain
az containerapp hostname bind \
  --name bn-comp-ai \
  --resource-group brokernote \
  --hostname compliance-api.businesstitan.com.au \
  --environment bn-comp-secured-env \
  --validation-method CNAME

# 2. Bind Next.js App Custom Domain
az containerapp hostname bind \
  --name bn-comp-app \
  --resource-group brokernote \
  --hostname compliance.businesstitan.com.au \
  --environment bn-comp-secured-env \
  --validation-method CNAME

# 3. Bind Next.js Portal Custom Domain
az containerapp hostname bind \
  --name bn-comp-portal \
  --resource-group brokernote \
  --hostname trust.businesstitan.com.au \
  --environment bn-comp-secured-env \
  --validation-method CNAME
```
*(After this step, you can uncomment the `customDomains` block in your `comp-api.yaml` file so future pipeline runs are locked in with the exact certificate mappings).*

## 🌐 Phase 6: Post-Deployment Verification Checklist

* [ ] Verify that `https://compliance-api.businesstitan.com.au` returns a `200 OK` (NestJS startup landing page).
* [ ] Verify that `https://compliance.businesstitan.com.au` loads properly and redirects to the Clerk / Better-Auth login page.
* [ ] Attempt user login and verify database reads/writes.
* [ ] Verify file uploads (evidences) to ensure the `bn-comp-s3-proxy` is routing blob storage traffic accurately.
