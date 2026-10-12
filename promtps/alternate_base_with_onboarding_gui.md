# POS to Zkong Integration: Architecture & Onboarding Specification

**Reference File:** `alternate_base_with_onboarding_gui_2.md`

---

## 1. Tech Stack & Goal

We are introducing a UI to onboard a business (ideally a grocery store or supermarket) that can bring any POS software (Square, Toast, Clover, or Lightspeed) and integrate it with their Zkong application.

| Layer | Technology |
|-------|------------|
| **Frontend** | React, TypeScript, Vite, Tailwind CSS |
| **Goal** | Universal POS ↔ Zkong integration with configurable field mapping & sync automation |

---

## 2. Infrastructure & Database

### 2.1 Environment Variables

The `.env` file should contain **only** the following values. All other configurations are stored in the database, set dynamically by the user, and read by the middleware.

```env
PORT=
ZKONG_POLL_INTERVAL_MS=
POSTGRES_DB=
POSTGRES_USER=
POSTGRES_PASSWORD=
DATABASE_URL=
```

### 2.2 Database Schema: `integrations` Table

A new `integrations` table tracks the user, their opted POS system, configuration details, and mapping rules.

| Column | Type | Description |
|--------|------|-------------|
| `id` | Primary Key | Auto-incrementing ID |
| `integration_id` | UUID (unique) | Random UUID for this integration. Used by external applications to refer to this integration |
| `registering_business_name` | String | Business name entered by user |
| `registering_business_email` | String | Business email entered by user |
| `selected_pos` | Enum | Selected POS: `square`, `toast`, `clover`, `lightspeed` |
| `pos_configuration` | JSON | POS API keys, base URLs, auth tokens |
| `zkong_configuration` | JSON | Zkong credentials |
| `field_mappings` | JSON | Dynamic mapping between POS fields and Zkong fields |
| `sync_rules` | JSON | User-defined automation & bi-directional sync rules |
| `status` | Integer | `0 = PENDING SETUP`, `1 = CONFIG VERIFIED`, `2 = PAUSED`, `3 = LIVE`, `-1 = DELETED` |
| `created_at` | Timestamp | Record creation time |
| `updated_at` | Timestamp | Last update time |

---

### 2.3 Backend Architecture: Adapter Pattern & Rule Engine

To support any POS system without altering core Zkong logic:

**POS Adapters** — Files specific to each POS (e.g., `CloverAdapter.ts`) that:
- Translate incoming webhooks into a standard data model
- Handle POS-specific API calls

**Rule Engine** — A core processor that:
- Reads `sync_rules` and `field_mappings` JSON from the database
- Runs calculations based on trigger events
- Dispatches actions to Zkong and/or back to the POS

---

### 2.4 Dynamic Webhook Routing

Instead of a generic webhook URL (`https://clokong.fullform.one/webhooks/clover`), the application uses **dynamic routing**:

```
https://clokong.fullform.one/webhooks/<integrationId>
```

- `<integrationId>` is the `integration_id` from the `integrations` table
- On webhook receipt, the middleware queries the `integrations` table to determine:
  - Which POS adapter to invoke
  - Which Zkong account to update

---

## 3. Onboarding Workflow (GUI Stepper)

The onboarding URL is `/onboarding`. The page features a **sequential stepper view**.

---

### Step 1: Business Details

- Business Name (text input)
- Business Email (text input)

---

### Step 2: POS Selection

- Display options: Square, Toast, Clover, Lightspeed
- **For now:** Only Clover is enabled
- On "Next": API call creates record in `integrations` table
- Populates: business name, email, selected POS, auto-generated `integration_id`
- API response returns `integration_id` (used in later steps)
- Status → `0` (PENDING SETUP)

---

### Step 3: Clover Configuration & Validation

Collect POS environment details using realistic label names:

| Field | Description |
|-------|-------------|
| **Clover API Base URL** | Default: `https://sandbox.dev.clover.com/v3/merchants` (trailing slash stripped) |
| **Clover Merchant ID** | From Clover Dashboard |
| **Clover Client App ID** | From Clover Developer Dashboard |
| **Clover API Token** | From Clover Test Merchants → API Token |
| **Clover Auth Code** | Immutable display field + "Refresh" button to fetch latest from DB |

#### Auth Code Webhook Flow

1. Display the dynamic webhook URL generated in Step 2: `https://clokong.fullform.one/webhooks/<integrationId>`
2. Instruct user to provide this URL as the webhook URL in their Clover sandbox application and initiate a test
3. The test webhook automatically sends an auth code
4. Backend saves this auth code under `pos_configuration` JSON field `clover_auth_token`
4. User clicks UI "Refresh" button to fetch the auth code from the DB
5. User copies the auth code from our application and pastes it into the Clover sandbox application to finalize

#### Validation Checkpoint

Once completed, the backend validates the Clover connection.
> **Note:** The above is Clover-specific. Architecture assumes no assumptions for future POS integrations.

---

### Step 4: Zkong Configuration & Schema Fetching

Collect Zkong environment details with tooltips/popovers explaining how to find each in the Zkong dashboard:

| Field | Example |
|-------|---------|
| **ZKONG_ACCOUNT** | `VensweGlobalLLC` |
| **ZKONG_PASSWORD** | `zkong@123` |
| **ZKONG_MERCHANT_ID** | `1786427294219` |
| **ZKONG_AGENCY_ID** | `1558577702698` |
| **ZKONG_STORE_ID** | `1607566698661` |

#### Validation & Schema Pull

- User clicks **"Verify Zkong"**
- Backend attempts authentication using provided credentials
- If both POS and Zkong validations succeed → status → `1` (CONFIG VERIFIED)
- Concurrently, backend dynamically fetches fields supported by this user's Zkong store/template (e.g., `sellingPrice`, `originalPrice`, `productName`, `barcode`) and passes them to the frontend for Step 5

---

### Step 5: Field Mapping & Sync Automation (The Rule Engine)

Dictates how data flows between POS and Zkong. UI displays dynamically fetched fields from Step 4.

#### Part A: Static Field Mapping

**Dual-column layout:**

| Left Column (Zkong) | Right Column (POS) |
|---------------------|---------------------|
| Dynamically populated Zkong fields from Step 4 | Dropdowns populated by POS schema (e.g., Clover raw fields like `price`, `vat_percentage`, system-calculated macros like `calculated_final_price`) |

- User maps POS fields to Zkong fields (e.g., Clover's `calculated_final_price` → Zkong's `sellingPrice` or `originalPrice`)
- Selection saved to `field_mappings` JSON column

#### Part B: Automation & Sync Rules

Interface for defining dynamic **If-This-Then-That (IFTTT)** logic based on POS webhook events.

| Component | Options |
|-----------|---------|
| **Trigger (IF)** | Select a POS event (e.g., "If VAT Percent changes", "If Discount changes") |
| **Action (THEN)** | Configure system response: |

**Action Types:**
- **Action 1 (Unidirectional):** Recalculate Final Price using Rule Engine, then push update to Zkong
- **Action 2 (Bi-directional):** Write newly calculated Final Price back to POS (via POS Adapter)

- Configuration saved to `sync_rules` JSON column

#### Completion

Upon saving:
- Onboarding complete
- Database status → `3` (LIVE)

---

## 4. Execution Flow (Webhook Lifecycle)

When the system is **LIVE (status = 3)**, runtime execution follows:

```mermaid
graph TD
    A[Clover fires webhook to /webhooks/{integrationId}] --> B[Middleware fetches record, verifies LIVE, loads mappings & rules]
    B --> C[Payload passes to CloverAdapter.ts for normalization]
    C --> D[Rule Engine evaluates payload against sync_rules]
    D --> E[Calculate new price]
    E --> F[Format JSON for Zkong using field_mappings]
    F --> G[Push to Zkong via Zkong Service]
    D --> H{Sync Rule: Bi-directional?}
    H -->|Yes| I[Trigger Adapter.updateItemField() to push price back to Clover]
    H -->|No| J[Done]
```

### Detailed Steps

1. **Event:** Clover fires a webhook to `/webhooks/<integrationId>` (e.g., VAT percentage changes)
2. **Lookup:** Middleware fetches the `integrations` record using the ID, verifies status is `LIVE`, loads `field_mappings` and `sync_rules`
3. **Adapt:** Payload passes to `CloverAdapter.ts` to normalize the data
4. **Process:** Rule Engine evaluates normalized payload against `sync_rules`, calculates new price based on VAT change trigger
5. **Execute Zkong Sync:** Rule Engine uses `field_mappings` to format exact JSON required by Zkong, pushes via Zkong Service
6. **Execute POS Write-back:** If configured in `sync_rules`, Rule Engine triggers Adapter's `updateItemField()` method to push new price back to Clover

---

## Summary of Key Files (Proposed Structure)

---

## 5. Integrations Management Page

A dedicated admin page at `/integrations` to list all users and their integrations with full lifecycle controls.

### 5.1 Page Layout

| Column | Description |
|--------|-------------|
| **Business Name** | `registering_business_name` |
| **Business Email** | `registering_business_email` |
| **POS** | `selected_pos` badge |
| **Integration ID** | `integration_id` (copyable) |
| **Status** | Badge with color: `0=PENDING`, `1=VERIFIED`, `2=PAUSED`, `3=LIVE`, `-1=DELETED` |
| **Created** | `created_at` |
| **Actions** | Dropdown/menu with state transitions |

---

### 5.2 State Transitions (Dropdown Actions)

| Current Status | Allowed Actions | Target Status |
|----------------|-----------------|---------------|
| `0` PENDING SETUP | Verify Config | `1` CONFIG VERIFIED |
| `1` CONFIG VERIFIED | Go Live | `3` LIVE |
| `2` PAUSED | Resume / Go Live | `3` LIVE |
| `3` LIVE | Pause | `2` PAUSED |
| `3` LIVE | Delete (Soft) | `-1` DELETED |
| `2` PAUSED | Delete (Soft) | `-1` DELETED |
| `-1` DELETED | Restore | `2` PAUSED |

> **Rules:**
> - "Go Live" only allowed from `CONFIG VERIFIED` or `PAUSED`
> - "Pause" only allowed from `LIVE`
> - "Delete" is **soft delete** (status = `-1`), preserves all config for audit/restore
> - "Restore" from `DELETED` goes to `PAUSED` (requires re-verification before going live)

---

### 5.3 UI Behavior

- **Table** with pagination, search (by business name, email, integration_id), filter by POS type and status
- **Action column** shows a dropdown with only valid transitions for the current status
- **Confirmation modal** for destructive actions (Pause, Delete) showing impact summary
- **Audit trail** link per row → opens `sync_log` filtered by this integration

---

### 5.4 Backend Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/integrations` | List with pagination, search, filters |
| `GET` | `/api/integrations/:id` | Get single integration detail |
| `PATCH` | `/api/integrations/:id/status` | Transition status (body: `{ action: "pause" \| "live" \| "pause" \| "delete" \| "restore" }`) |
| `DELETE` | `/api/integrations/:id` | Soft delete (alias for status=DELETED) |

### 5.5 Proposed File Additions

```
src/
├── api/
│   └── integrations/
│       ├── routes.ts
│       ├── controller.ts
│       └── validation.ts
├── db/
│   └── repositories/
│       └── IntegrationsRepo.ts      # Add: findAll, findById, updateStatus
└── onboarding/
    └── steps/
        └── step6-management.ts      # (Optional) Admin-only step in onboarding flow
```