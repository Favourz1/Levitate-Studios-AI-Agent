# ERP Integration Patterns Guide

This guide documents the patterns and best practices for integrating with the Levitate ERP Software API.

## Overview

The ERP integration (`src/integrations/levitateStudiosErp.js`) handles all interactions with the Levitate ERP Software API, which is based on ERPNext. The integration follows a consistent pattern for all API operations.

## Architecture

### Singleton Pattern

The integration uses a singleton pattern to ensure only one instance exists:

```javascript
const { erpIntegration } = require("@/integrations/levitateStudiosErp");
```

### Authentication

All API requests use token-based authentication:
- Format: `Authorization: token {api_key}:{api_secret}`
- Configured via environment variables: `LEVITATE_ERP_API_KEY` and `LEVITATE_ERP_API_SECRET`

## Critical Patterns

### 1. Customer Management (CRITICAL - Must be done first)

**Pattern**: Always search for customer by exact name before creating quotes.

**Why**: The customer `name` field is the primary key used in quote creation. Duplicate customers cause quote creation failures.

**Implementation**:
```javascript
// Search for customer by exact name
const customerName = await erpIntegration.searchOrCreateCustomer(
  client.name,
  client.primaryEmail
);
```

**Key Methods**:
- `searchCustomers(searchTerm)` - Search by keyword (name, email, mobile, tax ID)
- `getCustomer(customerName)` - Get single customer by name/ID
- `createCustomer(customerData)` - Create new customer
- `searchOrCreateCustomer(customerName, email)` - **Recommended**: Search first, create if not found

**Important**: Always use the `name` field returned from these methods as the customer identifier in quotes.

### 2. Item Management (CRITICAL - Must be done for each item)

**Pattern**: Always search for each item by exact `item_code` or `item_name` before using in quotes.

**Why**: Items must exist in ERP before they can be added to quotes. Missing items cause quote creation/update failures.

**Implementation**:
```javascript
// For each quote item, ensure it exists
const validatedItemCode = await erpIntegration.searchOrCreateItem(
  item.item_code,
  item.description,
  "Nos" // Default stock UOM
);
```

**Key Methods**:
- `searchItems(searchTerm)` - Search by keyword (name, code, description)
- `getItem(itemCode)` - Get single item by item_code
- `createItem(itemData)` - Create new item
- `searchOrCreateItem(itemCode, description, stockUom)` - **Recommended**: Search first, create if not found

**Important**: Default `stock_uom` to "Nos" when creating new items.

### 3. Response Validation

**Pattern**: Always check the `success` field in JSON responses, not just HTTP status codes.

**Why**: The ERP API may return HTTP 200 with `success: false` for business logic failures.

**Implementation**:
```javascript
const response = await this.makeRequest(endpoint, "POST", body);

// CRITICAL: Check success field
if (response.success === false) {
  throw new Error(response.message || "Operation failed");
}
```

### 4. Quote Cancellation Verification

**Pattern**: Always verify quote cancellation status with `getQuotation()` after cancellation.

**Why**: The cancellation API has a quirk where it may return `success: false` but cancellation actually worked.

**Implementation**:
```javascript
// Cancel quote
await erpIntegration.cancelQuotation(quoteId);

// CRITICAL: Verify cancellation
const quoteDetails = await erpIntegration.getQuotation(quoteId);
if (!quoteDetails.quotation_canceled) {
  throw new Error("Cancellation may have failed");
}
```

### 5. Quote Amendment Handling

**Pattern**: Always use the new quote ID from `data.name` in amend response, not the cancelled ID.

**Why**: Amending a cancelled quote creates a new draft quote with a different ID.

**Implementation**:
```javascript
const amendResult = await erpIntegration.amendQuotation(cancelledQuoteId, data);

// CRITICAL: Use new quote ID from response
const newQuoteId = amendResult.newQuoteId; // or amendResult.data.name
// Use newQuoteId for subsequent operations, NOT cancelledQuoteId
```

### 6. Items Array Replacement

**Pattern**: When updating quotes, fetch existing items first, modify, then send complete array.

**Why**: The update API completely replaces the items array. Partial updates will remove items not included.

**Implementation**:
```javascript
// Step 1: Get existing quote
const existingQuote = await erpIntegration.getQuotation(quoteId);

// Step 2: Modify items array
const updatedItems = existingQuote.items.map(item => {
  // Modify as needed
  return { ...item, qty: newQty };
});

// Step 3: Send complete array
await erpIntegration.updateQuotation(quoteId, {
  items: updatedItems // Complete array, not partial
});
```

## Error Handling

### Retry Logic

All API methods use exponential backoff retry logic:
- Max attempts: 3
- Initial delay: 1000ms (1 second)
- Backoff multiplier: 2

### Error Types

The integration throws `IntegrationError` for all failures:
```javascript
throw new IntegrationError("ERP", "methodName", error, {
  context: "additional context"
});
```

### Logging

All API calls are logged with:
- Integration name: "ERP"
- Method name
- Success/failure status
- Duration
- Error details (if failed)

## Workflow Examples

### Creating a Quote

```javascript
// Step 1: Ensure customer exists
const customerName = await erpIntegration.searchOrCreateCustomer(
  client.name,
  client.primaryEmail
);

// Step 2: Ensure all items exist
const validatedItems = await Promise.all(
  quoteItems.map(item =>
    erpIntegration.searchOrCreateItem(
      item.item_code,
      item.description,
      "Nos"
    )
  )
);

// Step 3: Create quote (customer and items now guaranteed to exist)
const quote = await erpIntegration.createQuotation({
  customer: customerName,
  items: validatedItems.map(item => ({
    item_code: item.item_code,
    qty: item.qty,
    rate: item.rate,
    description: item.description
  }))
});
```

### Updating a Quote

```javascript
// Step 1: Verify quote is not cancelled
const existingQuote = await erpIntegration.getQuotation(quoteId);
if (existingQuote.quotation_canceled) {
  // Use amend instead
  const newQuote = await erpIntegration.amendQuotation(quoteId, data);
  quoteId = newQuote.newQuoteId; // Update to new ID
}

// Step 2: Ensure new items exist (if any)
for (const newItem of newItems) {
  await erpIntegration.searchOrCreateItem(
    newItem.item_code,
    newItem.description,
    "Nos"
  );
}

// Step 3: Fetch existing items and modify
const updatedItems = [
  ...existingQuote.items,
  ...newItems.map(item => ({
    item_code: item.item_code,
    qty: item.qty,
    rate: item.rate,
    description: item.description
  }))
];

// Step 4: Update with complete array
await erpIntegration.updateQuotation(quoteId, {
  items: updatedItems
});
```

## Best Practices

1. **Always search before creating**: Use `searchOrCreateCustomer` and `searchOrCreateItem` to prevent duplicates.

2. **Verify before operations**: Always call `getQuotation()` before updating/submitting to check cancellation status.

3. **Handle cancellation gracefully**: Use `amendQuotation()` to create new draft from cancelled quotes.

4. **Complete items array**: Always send full items array in updates, not partial arrays.

5. **Use new IDs**: After amending, always use the new quote ID from `data.name`, not the cancelled ID.

6. **Error context**: Include relevant context in error messages for easier debugging.

7. **Logging**: All operations are automatically logged. Check logs for troubleshooting.

## Common Pitfalls

1. **Using customer name directly**: Always use the `name` field returned from search/create, not the input name.

2. **Missing items**: Ensure all items exist before quote creation/update.

3. **Partial updates**: Sending partial items array removes items not included.

4. **Cancelled quote operations**: Cannot update/submit cancelled quotes. Use amend instead.

5. **Ignoring success field**: HTTP 200 doesn't mean success. Always check `success` field.

6. **Using cancelled ID**: After amending, use the new quote ID, not the cancelled one.

## Testing

When testing ERP integration:

1. **Test customer search/create**: Verify exact name matching works correctly.

2. **Test item search/create**: Verify items are created with correct codes.

3. **Test quote lifecycle**: Create → Update → Submit → Cancel → Amend flow.

4. **Test error cases**: Cancelled quotes, missing items, invalid customers.

5. **Test retry logic**: Simulate network failures and verify retries work.

## References

- ERP API Documentation: `AI-Context/Third Party Docs/Levitate ERP Software API Documentation.md`
- Integration Code: `src/integrations/levitateStudiosErp.js`
- Quote Service: `src/services/quoteService.js`

