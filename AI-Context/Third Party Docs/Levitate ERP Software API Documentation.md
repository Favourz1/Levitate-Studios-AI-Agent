# Levitate ERP Software API Documentation

This API allows for the management of Quotations, Sales Invoices, Items/Products, and Customers within the Levitate/ERPNext environment.

## 1\. Setup & Authentication

### Base Configuration

- **Base URL**: `{{base_url}}` (e.g., `https://your-domain.com`)
- **Authentication Method**: Token-based Authentication

### Headers

All requests must include the following headers:

- `Content-Type`: `application/json`
- `Authorization`: `token {api_key}:{api_secret}`

To generate credentials:

1.  Login to ERPNext.
2.  Go to **User Profile \> API Access**.
3.  Click "Generate Keys".
4.  Use the generated **API Key** and **API Secret**.

---

## 2\. Quotation APIs

### Create Quotation

Creates a new Quotation with multiple items.

- **Endpoint**: `POST /api/method/levitate_integration.api.create_quotation`
- **Body Parameters**:
  - `customer` (Required): Customer name or ID.
  - `items` (Required): Array of objects containing `item_code`, `qty`, `rate`, and `description`.
  - `transaction_date` (Optional): YYYY-MM-DD (Defaults to today).
  - `valid_till` (Optional): YYYY-MM-DD.
  - `order_type`: "Sales".
  - `taxes_and_charges`: Tax template name (e.g., "Nigeria Tax - L").

**Request Example:**

```json
{
  "data": {
    "customer": "Test Favour 2",
    "taxes_and_charges": "Nigeria Tax - L",
    "items": [
      {
        "item_code": "test UI",
        "qty": 5,
        "rate": 200.0,
        "description": "Sample item for quotation"
      }
    ],
    "transaction_date": "2025-11-13",
    "valid_till": "2025-11-30",
    "order_type": "Sales"
  }
}
```

### Get Quotation (Single)

Fetches a single Quotation by its ID.

- **Endpoint**: `GET /api/method/levitate_integration.api.get_quotation`
- **Query Parameters**:
  - `name`: The Quotation ID (e.g., `SAL-QTN-2025-00001`).

**Response Example:**

```json
{
    "success": true,
    "data": {
        "name": "SAL-QTN-2025-00002",
        "party_name": "Usman Fodio",
        "status": "Open",
        "docstatus": 1,
        "grand_total": 1000,
        "items": [ ... ]
    }
}
```

### Get Quotations (List/Filter)

Fetches multiple Quotations based on filter criteria.

- **Endpoint**: `POST /api/method/levitate_integration.api.get_quotations`
- **Body Parameters**:
  - `filters`: Object containing filter keys (e.g., `docstatus`, `party_name`).
  - `fields`: Array of field names to retrieve.
  - `limit`: Integer (default 20).
  - `order_by`: String (e.g., "transaction_date desc").

**Request Example:**

```json
{
  "data": {
    "filters": {
      "docstatus": 0
    },
    "fields": [
      "name",
      "party_name",
      "grand_total",
      "transaction_date",
      "docstatus"
    ],
    "limit": 10,
    "order_by": "transaction_date desc"
  }
}
```

### Update Quotation

Updates an existing Quotation. **Note:** The quotation must be in Draft state (`docstatus: 0`).

- **Endpoint**: `POST /api/method/levitate_integration.api.update_quotation`
- **Body Parameters**:
  - `name`: Quotation ID.
  - `items`: Array of items.
  - Any other field to update (e.g., `valid_till`).

**Request Example:**

```json
{
  "data": {
    "name": "SAL-QTN-2025-00002",
    "valid_till": "2025-12-31",
    "items": [
      {
        "item_code": "ITEM-001",
        "qty": 8,
        "rate": 110.0,
        "description": "Updated item quantity and rate"
      }
    ]
  }
}
```

### Submit Quotation

Finalizes a quotation, changing its status from Draft (0) to Submitted (1). Once submitted, it cannot be edited.

- **Endpoint**: `POST /api/method/levitate_integration.api.submit_quotation`
- **Body Parameters**:
  - `name`: Quotation ID.

**Request Example:**

```json
{
  "name": "SAL-QTN-2025-00002"
}
```

### Cancel Quotation

Cancels a submitted quotation.

- **Endpoint**: `POST /api/method/levitate_integration.api.cancel_quotation`
- **Query Parameters**:
  - `name`: Quotation ID.

### Amend Quotation

Creates a new draft from a cancelled quotation.

- **Endpoint**: `POST /api/method/levitate_integration.api.amend_quotation`
- **Body Parameters**:
  - `name`: The ID of the **Cancelled** Quotation.
  - `data`: The new data to populate the amended quote with.

**Request Example:**

```json
{
    "name": "SAL-QTN-2025-00198",
    "data": {
        "customer": "CUST-001",
        "items": [ ... ],
        "transaction_date": "2025-11-08"
    }
}
```

---

## 3\. Sales Invoice APIs

### Create Sales Invoice

Creates a new invoice. Can optionally be linked to a Quotation.

- **Endpoint**: `POST /api/method/levitate_integration.api.create_sales_invoice`
- **Body Parameters**:
  - `customer` (Required).
  - `items` (Required).
  - `quotation` (Optional): Link to an existing quotation ID.
  - `posting_date`: Invoice date.
  - `due_date`: Payment due date.
  - `update_stock`: `0` (No) or `1` (Yes).

**Request Example (Linked to Quote):**

```json
{
  "data": {
    "customer": "CUST-001",
    "quotation": "SAL-QTN-2025-00002",
    "taxes_and_charges": "Nigeria Tax - L",
    "items": [
      {
        "item_code": "ITEM-001",
        "qty": 5,
        "rate": 100.0
      }
    ],
    "posting_date": "2025-10-27",
    "due_date": "2025-11-27",
    "update_stock": 0
  }
}
```

### Get Sales Invoice (Single)

Fetches a single Invoice by ID.

- **Endpoint**: `GET /api/method/levitate_integration.api.get_sales_invoice`
- **Query Parameters**:
  - `name`: Invoice ID (e.g., `ACC-SINV-2025-00001`).

### Get Sales Invoices (List/Filter)

Fetches multiple invoices based on filters.

- **Endpoint**: `POST /api/method/levitate_integration.api.get_sales_invoices`
- **Body Parameters**:
  - `filters`: e.g., `{"customer": "Name"}`.
  - `fields`: Array of fields.
  - `limit`: Integer.
  - `order_by`: String.

**Request Example:**

```json
{
  "filters": {
    "customer": "Usman Fodio"
  },
  "fields": [
    "name",
    "customer",
    "grand_total",
    "posting_date",
    "outstanding_amount"
  ],
  "limit": 20,
  "order_by": "posting_date desc"
}
```

### Update Sales Invoice

Updates a draft invoice.

- **Endpoint**: `POST /api/method/levitate_integration.api.update_sales_invoice`
- **Body Parameters**:
  - `name`: Invoice ID.
  - `items`: Array of updated items.
  - Other fields (e.g., `due_date`).

### Submit Sales Invoice

Finalizes the invoice (Draft -\> Submitted).

- **Endpoint**: `POST /api/method/levitate_integration.api.submit_sales_invoice`
- **Body Parameters**:
  - `name`: Invoice ID.

---

## 4\. Item/Product APIs

### Get Item (Single)

Fetches details of a specific item.

- **Endpoint**: `GET /api/method/levitate_integration.api.get_item`
- **Query Parameters**:
  - `item_code`: The Item ID.

### Get Items (All)

Fetches a list of all active items.

- **Endpoint**: `GET /api/method/levitate_integration.api.get_items`
- **Query Parameters**:
  - `limit`: Number of items (default 100).

### Get Items (Filtered)

Fetches items based on specific criteria.

- **Endpoint**: `POST /api/method/levitate_integration.api.get_items`
- **Body Parameters**:
  - `filters`: e.g., `{"item_group": "Services", "disabled": 0}`.
  - `fields`: Array of fields to return.
  - `limit`: Integer.
  - `order_by`: String.

**Request Example:**

```json
{
  "filters": {
    "disabled": 0,
    "item_group": "Products"
  },
  "fields": [
    "name",
    "item_code",
    "item_name",
    "description",
    "standard_rate",
    "stock_uom"
  ],
  "limit": 100,
  "order_by": "item_name asc"
}
```

### Search Items

Search for items by keyword (searches Name, Code, and Description).

- **Endpoint**: `GET /api/method/levitate_integration.api.search_items`
- **Query Parameters**:
  - `search_term`: The keyword.
  - `limit`: Max results.

### Create Item

Creates a new item definition.

- **Endpoint**: `POST /api/method/levitate_integration.api.create_item`
- **Request Example:**

<!-- end list -->

```json
{
  "data": {
    "item_code": "test UI",
    "description": "UI Dev Test",
    "stock_uom": "Nos"
  }
}
```

---

## 5\. Customer APIs

### Get Customer (Single)

- **Endpoint**: `GET /api/method/levitate_integration.api.get_customer`
- **Query Parameters**:
  - `name`: Customer Name/ID.

### Get Customers (All)

- **Endpoint**: `GET /api/method/levitate_integration.api.get_customers`
- **Query Parameters**:
  - `limit`: Integer.

### Get Customers (Filtered)

- **Endpoint**: `POST /api/method/levitate_integration.api.get_customers`
- **Body Parameters**:
  - `filters`: e.g., `{"customer_group": "Commercial"}`.
  - `fields`: Array of fields.

### Search Customers

Searches Name, Email, Mobile, or Tax ID.

- **Endpoint**: `GET /api/method/levitate_integration.api.search_customers`
- **Query Parameters**:
  - `search_term`: Keyword.
  - `limit`: Integer.

### Get Customer Details

Fetches comprehensive details including addresses, contacts, outstanding balance, and recent invoices.

- **Endpoint**: `GET /api/method/levitate_integration.api.get_customer_details`
- **Query Parameters**:
  - `name`: Customer Name/ID.

### Create Customer

- **Endpoint**: `POST /api/method/levitate_integration.api.create_customer`
- **Request Example:**

<!-- end list -->

```json
{
  "customer_name": "Shinji Gagawa",
  "email": "email@gmail.com"
}
```

---

## 6\. Utilities

### Get PDF

Download the PDF version of a document.

- **Endpoint**: `GET /api/method/frappe.utils.print_format.download_pdf`
- **Query Parameters**:
  - `doctype`: e.g., "Quotation" or "Sales Invoice".
  - `name`: Document ID.
  - `format`: "Standard".
  - `no_letterhead`: "0" (Include letterhead) or "1".
- **Response**: Returns binary data with `Content-Type: application/pdf`.

---

## Notes During Usage

Please keep the following critical points in mind when integrating with these APIs:

### 1\. Success Validation

Do not rely solely on the HTTP Status Code (e.g., 200 OK). Always check the `success` field in the JSON response body.

- `true`: Operation was successful.
- `false` or missing: Operation failed.

### 2\. Updating Quotations & Invoices (Items Array Replacement)

When using the **Update** APIs (`update_quotation` or `update_sales_invoice`), the `items` array in your request payload **completely replaces** the existing items in the document.

- **Warning**: Do not send partial item lists. You must fetch the existing items, modify the array as needed, and send the _entire_ list back in the update request. If you send only one item, the document will be updated to contain _only_ that one item.

### 3\. Document Status (`docstatus`)

The system uses the following integer codes for document status:

- **0**: **Draft** (Editable).
- **1**: **Submitted** (Locked/Finalized).
- **2**: **Cancelled**.

### 4\. Handling Submitted Documents

You cannot use the `update_quotation` or `update_sales_invoice` APIs on a document with `docstatus: 1` (Submitted). To make changes:

1.  **Cancel** the document using the Cancel API.
2.  **Amend** the document using the Amend API (this creates a new Draft copy).

### 5\. Handling Cancelled Quotations

If you attempt to access a Quotation that has been cancelled (via a specific flow), the API might return a failure message indicating the document is not found (or cancelled), but it will provide the ID of the latest cancelled version.

**Response Example for Cancelled Quote:**

```json
{
  "success": false,
  "message": "Quotation not found",
  "quotation_canceled": true,
  "latest_canceled_id": "SAL-QTN-2025-00198-CANC-0"
}
```

You can then use `latest_canceled_id` to fetch the data needed to amend it.

### 6\. PDF Retrieval

The `download_pdf` endpoint does not return a JSON object. It returns the raw PDF file stream.

- **Content-Type**: `application/pdf`
- Ensure your HTTP client handles binary responses correctly to save the file.

### 7\. Limit Parameters Not Supported

**Important:** Do **not** use any `limit` (or similar pagination) parameters in your API calls. The Levitate ERP Software API does not support `limit` or pagination parameters on endpoints documented here. Including unsupported parameters may result in errors or unexpected behavior.
