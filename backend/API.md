# API Documentation

> **Base URL**: `http://localhost:3001/api`  
> **Authentication**: Bearer Token (JWT)

---

## Table of Contents

1. [Authentication](#authentication)
2. [Users](#users)
3. [Connections](#connections)
4. [Dashboards](#dashboards)
5. [Folders](#folders)
6. [Sessions](#sessions)

---

## Authentication

### Register User

```http
POST /api/auth/register
Content-Type: application/json
```

**Request Body:**
```json
{
  "email": "user@company.com",
  "password": "password123",
  "name": "John Doe",
  "phoneNumber": "+84123456789",
  "jobTitle": "Data Analyst",
  "level": "Senior",
  "department": "Analytics",
  "industry": "Technology",
  "companySize": "51-200"
}
```

**Response (201):**
```json
{
  "success": true,
  "message": "Verification code sent",
  "data": {
    "email": "user@company.com",
    "status": "Pending"
  }
}
```

> [!NOTE]
> Only corporate email domains are allowed. Gmail, Yahoo, etc. will be rejected.

---

### Verify Email

```http
POST /api/auth/verify
Content-Type: application/json
```

**Request Body:**
```json
{
  "email": "user@company.com",
  "code": "123456"
}
```

**Response (200):**
```json
{
  "success": true,
  "data": {
    "token": "eyJhbGciOiJIUzI1NiIs...",
    "user": {
      "id": "uuid",
      "email": "user@company.com",
      "name": "John Doe",
      "role": "Admin",
      "status": "Active",
      "workspaceId": "uuid",
      "workspaceDomain": "company.com"
    }
  }
}
```

---

### Resend Verification Code

```http
POST /api/auth/resend-code
Content-Type: application/json
```

**Request Body:**
```json
{
  "email": "user@company.com"
}
```

---

### Login

```http
POST /api/auth/login
Content-Type: application/json
```

**Request Body:**
```json
{
  "email": "user@company.com",
  "password": "password123"
}
```

**Response (200):**
```json
{
  "success": true,
  "data": {
    "token": "eyJhbGciOiJIUzI1NiIs...",
    "user": {
      "id": "uuid",
      "email": "user@company.com",
      "name": "John Doe",
      "role": "Admin",
      "status": "Active",
      "workspaceId": "uuid",
      "workspaceDomain": "company.com",
      "joinedAt": "2026-02-10T...",
      "jobTitle": "Data Analyst",
      "level": "Senior",
      "department": "Analytics",
      "industry": "Technology",
      "companySize": "51-200",
      "phoneNumber": "+84123456789"
    }
  }
}
```

---

### Logout

```http
POST /api/auth/logout
Authorization: Bearer <token>
```

---

### Get Current User

```http
GET /api/auth/me
Authorization: Bearer <token>
```

---

## Users

> Requires Authentication

### List Workspace Users

```http
GET /api/users
Authorization: Bearer <token>
```

**Response (200):**
```json
{
  "success": true,
  "data": [
    {
      "id": "uuid",
      "email": "user@company.com",
      "name": "John Doe",
      "role": "Admin",
      "status": "Active",
      "joinedAt": "2026-02-10T...",
      "lastLogin": "2026-02-10T...",
      "jobTitle": "Data Analyst",
      "level": "Senior",
      "department": "Analytics",
      "phoneNumber": "+84123456789",
      "industry": "Technology",
      "companySize": "51-200"
    }
  ]
}
```

---

### Update User (Admin Only)

```http
PUT /api/users/:id
Authorization: Bearer <token>
Content-Type: application/json
```

**Request Body:**
```json
{
  "name": "John Doe Updated",
  "role": "Editor",
  "status": "Active",
  "jobTitle": "Senior Analyst",
  "level": "Lead",
  "department": "BI",
  "phoneNumber": "+84987654321"
}
```

---

### Delete User (Admin Only)

```http
DELETE /api/users/:id
Authorization: Bearer <token>
```

---

## Connections

> Requires Authentication

### List Connections

```http
GET /api/connections
Authorization: Bearer <token>
```

**Response (200):**
```json
{
  "success": true,
  "data": [
    {
      "id": "uuid",
      "name": "Main BigQuery",
      "type": "BigQuery",
      "authType": "ServiceAccount",
      "email": "sa@project.iam.gserviceaccount.com",
      "status": "Connected",
      "projectId": "my-gcp-project",
      "tableCount": 15,
      "createdAt": "2026-02-10T..."
    }
  ]
}
```

---

### Create Connection

```http
POST /api/connections
Authorization: Bearer <token>
Content-Type: application/json
```

**Request Body:**
```json
{
  "name": "Production BigQuery",
  "type": "BigQuery",
  "authType": "ServiceAccount",
  "email": "sa@project.iam.gserviceaccount.com",
  "projectId": "my-gcp-project",
  "serviceAccountKey": "{...service account JSON...}"
}
```

---

### Update Connection

```http
PUT /api/connections/:id
Authorization: Bearer <token>
Content-Type: application/json
```

---

### Delete Connection

```http
DELETE /api/connections/:id
Authorization: Bearer <token>
```

---

### List Synced Tables

```http
GET /api/connections/:id/tables
Authorization: Bearer <token>
```

---

### Upsert Synced Tables

```http
POST /api/connections/:id/tables
Authorization: Bearer <token>
Content-Type: application/json
```

**Request Body:**
```json
{
  "tables": [
    {
      "tableName": "sales_data",
      "datasetName": "analytics",
      "rowCount": 50000,
      "schema": {
        "fields": [
          { "name": "id", "type": "INTEGER" },
          { "name": "amount", "type": "FLOAT" }
        ]
      }
    }
  ]
}
```

---

## Dashboards

> Requires Authentication

### List Dashboards

```http
GET /api/dashboards
Authorization: Bearer <token>
```

---

### Get Dashboard

```http
GET /api/dashboards/:id
Authorization: Bearer <token>
```

**Response (200):**
```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "title": "Sales Dashboard",
    "description": "Monthly sales overview",
    "dataSourceId": "conn-uuid",
    "dataSourceName": "Main BigQuery",
    "enableCrossFilter": true,
    "activePageId": "page-uuid",
    "layout": {},
    "theme": { "mode": "dark" },
    "calculatedFields": [],
    "quickMeasures": [],
    "pages": [
      {
        "id": "page-uuid",
        "title": "Overview",
        "position": 0,
        "widgets": [
          {
            "id": "widget-uuid",
            "type": "chart",
            "chartType": "bar",
            "title": "Revenue by Month",
            "x": 0, "y": 0, "w": 6, "h": 4,
            "config": {}
          }
        ]
      }
    ],
    "globalFilters": []
  }
}
```

---

### Create Dashboard

```http
POST /api/dashboards
Authorization: Bearer <token>
Content-Type: application/json
```

**Request Body:**
```json
{
  "title": "New Dashboard",
  "description": "Dashboard description",
  "folderId": "folder-uuid",
  "dataSourceId": "conn-uuid",
  "dataSourceName": "Main BigQuery"
}
```

---

### Update Dashboard

```http
PUT /api/dashboards/:id
Authorization: Bearer <token>
Content-Type: application/json
```

**Request Body:**
```json
{
  "title": "Updated Title",
  "description": "Updated description",
  "enableCrossFilter": true,
  "activePageId": "page-uuid",
  "layout": {},
  "theme": { "mode": "light" },
  "calculatedFields": [],
  "quickMeasures": []
}
```

---

### Delete Dashboard

```http
DELETE /api/dashboards/:id
Authorization: Bearer <token>
```

---

### Dashboard Pages

```http
# Add Page
POST /api/dashboards/:id/pages
{ "title": "New Page", "dataSourceId": "...", "dataSourceName": "..." }

# Update Page
PUT /api/dashboards/:id/pages/:pageId
{ "title": "Updated Page", "position": 1 }

# Delete Page
DELETE /api/dashboards/:id/pages/:pageId
```

---

### Dashboard Widgets

```http
# Add Widget
POST /api/dashboards/:id/widgets
{
  "pageId": "page-uuid",
  "type": "chart",
  "chartType": "line",
  "title": "Trend Chart",
  "x": 0, "y": 0, "w": 6, "h": 4,
  "config": { "xAxis": "date", "yAxis": "value" }
}

# Update Widget
PUT /api/dashboards/:id/widgets/:widgetId
{ "title": "Updated Title", "x": 2, "y": 0 }

# Delete Widget
DELETE /api/dashboards/:id/widgets/:widgetId
```

**Widget Types:**
- `chart` - Line, Bar, Area, Pie charts
- `table` - Data table
- `card` - Single metric card
- `gauge` - Gauge meter
- `pivot` - Pivot table
- `slicer` - Filter slicer
- `date-range` - Date range picker
- `search` - Search filter

---

### Global Filters

```http
# Add Filter
POST /api/dashboards/:id/global-filters
{
  "name": "Date Filter",
  "field": "order_date",
  "operator": "between",
  "value": ["2026-01-01", "2026-12-31"],
  "appliedToWidgets": ["widget-1", "widget-2"]
}

# Delete Filter
DELETE /api/dashboards/:id/global-filters/:filterId
```

---

## Folders

> Requires Authentication

### List Folders

```http
GET /api/folders
Authorization: Bearer <token>
```

**Response (200):**
```json
{
  "success": true,
  "data": [
    {
      "id": "uuid",
      "name": "Sales Reports",
      "parentId": null,
      "icon": "📈",
      "color": "#4f46e5",
      "createdAt": "2026-02-10T...",
      "dashboardCount": 5,
      "childCount": 2
    }
  ]
}
```

---

### Create Folder

```http
POST /api/folders
Authorization: Bearer <token>
Content-Type: application/json
```

**Request Body:**
```json
{
  "name": "New Folder",
  "parentId": "parent-folder-uuid",
  "icon": "📁",
  "color": "#22c55e"
}
```

---

### Update Folder

```http
PUT /api/folders/:id
Authorization: Bearer <token>
Content-Type: application/json
```

---

### Delete Folder

```http
DELETE /api/folders/:id
Authorization: Bearer <token>
```

> [!WARNING]
> Deleting a folder will cascade delete all child folders. Dashboards will have their `folderId` set to null.

---

## Sessions (AI Chat)

> Requires Authentication

### List Sessions

```http
GET /api/sessions
Authorization: Bearer <token>
```

---

### Create Session

```http
POST /api/sessions
Authorization: Bearer <token>
Content-Type: application/json
```

**Request Body:**
```json
{
  "title": "Revenue Analysis"
}
```

---

### Get Session with Messages

```http
GET /api/sessions/:id
Authorization: Bearer <token>
```

---

### Update Session

```http
PUT /api/sessions/:id
Authorization: Bearer <token>
Content-Type: application/json
```

---

### Delete Session

```http
DELETE /api/sessions/:id
Authorization: Bearer <token>
```

---

### Add Message

```http
POST /api/sessions/:id/messages
Authorization: Bearer <token>
Content-Type: application/json
```

**Request Body:**
```json
{
  "role": "user",
  "content": "Show me sales by region",
  "visualData": {
    "type": "chart",
    "chartType": "bar",
    "data": [...]
  },
  "sqlTrace": "SELECT region, SUM(sales) FROM ...",
  "executionTime": 1234
}
```

---

## Error Codes

| Code | HTTP | Description |
|------|------|-------------|
| `NO_TOKEN` | 401 | Missing Authorization header |
| `INVALID_TOKEN` | 401 | JWT verification failed |
| `INVALID_SESSION` | 401 | Session expired or revoked |
| `DOMAIN_RESTRICTED` | 403 | Non-corporate email domain |
| `USER_EXISTS` | 400 | Email already registered |
| `USER_PENDING` | 400 | Account pending verification |
| `INVALID_CREDENTIALS` | 401 | Wrong email or password |
| `ACCOUNT_DISABLED` | 403 | User account is disabled |
| `FORBIDDEN` | 403 | Insufficient role permissions |
| `INVALID_CODE` | 400 | Wrong verification code |
| `CODE_EXPIRED` | 400 | Verification code expired |
| `VALIDATION_ERROR` | 400 | Request body validation failed |
| `SELF_DELETE` | 400 | Cannot delete yourself |

---

*Document generated by Antigravity Agent*
