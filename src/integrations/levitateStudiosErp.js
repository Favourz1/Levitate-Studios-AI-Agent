const { appConfig } = require("@/config");
const { IntegrationError } = require("@/utils/errors");
const { createLogger, logIntegrationCall } = require("@/utils/logger");
const { retry } = require("@/utils");

const logger = createLogger("integration:erp");

/**
 * Levitate ERP Software Integration
 * Handles all interactions with the Levitate ERP Software API
 * Based on ERPNext API structure
 */
class LevitateStudiosErpIntegration {
  constructor() {
    // Validate required configuration
    if (!appConfig.erp?.baseUrl) {
      throw new Error("ERP base URL is not configured");
    }

    if (!appConfig.erp?.apiKey || !appConfig.erp?.apiSecret) {
      throw new Error("ERP API credentials are not configured");
    }

    this.baseUrl = appConfig.erp.baseUrl.replace(/\/$/, ""); // Remove trailing slash
    this.apiKey = appConfig.erp.apiKey;
    this.apiSecret = appConfig.erp.apiSecret;

    // Create authentication token
    this.authToken = `${this.apiKey}:${this.apiSecret}`;

    logger.info("Levitate ERP integration initialized successfully");
  }

  /**
   * Generic API request method
   * @private
   */
  async makeRequest(endpoint, method = "GET", body = null) {
    const url = `${this.baseUrl}${endpoint}`;
    const headers = {
      "Content-Type": "application/json",
      Authorization: `token ${this.authToken}`,
    };

    const config = {
      method,
      headers,
    };

    if (body && (method === "POST" || method === "PUT")) {
      config.body = JSON.stringify(body);
    }

    const response = await fetch(url, config);

    // Handle binary responses (PDF downloads)
    if (response.headers.get("content-type")?.includes("application/pdf")) {
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(
          `ERP API error: ${response.status} ${response.statusText} - ${errorText}`
        );
      }
      const arrayBuffer = await response.arrayBuffer();
      return Buffer.from(arrayBuffer);
    }

    // Handle JSON responses
    const responseText = await response.text();
    let responseData;

    try {
      responseData = responseText ? JSON.parse(responseText) : {};
    } catch (parseError) {
      throw new Error(
        `Failed to parse ERP API response: ${
          parseError.message
        }. Response: ${responseText.substring(0, 200)}`
      );
    }

    // Always check success field in JSON response (not just HTTP status)
    if (responseData.success === false) {
      const errorMessage =
        responseData.message ||
        `ERP API operation failed: ${response.statusText}`;
      const error = new Error(errorMessage);
      error.responseData = responseData;
      error.statusCode = response.status;
      throw error;
    }

    if (!response.ok && responseData.success !== true) {
      const errorMessage =
        responseData.message ||
        `ERP API error: ${response.status} ${response.statusText}`;
      const error = new Error(errorMessage);
      error.responseData = responseData;
      error.statusCode = response.status;
      throw error;
    }

    return responseData;
  }

  // ==================== CUSTOMER MANAGEMENT ====================

  /**
   * Search for customers by keyword
   * Searches Name, Email, Mobile, or Tax ID
   * @param {string} searchTerm - Search keyword
   * @returns {Promise<Array>} Array of customer objects
   */
  async searchCustomers(searchTerm) {
    const startTime = Date.now();

    try {
      const result = await retry(
        async () => {
          const endpoint = `/api/method/levitate_integration.api.search_customers?search_term=${encodeURIComponent(
            searchTerm
          )}`;
          const response = await this.makeRequest(endpoint);

          if (!response.success && response.success !== undefined) {
            throw new Error(
              response.message ||
                "Customer search failed - success field is false"
            );
          }

          return {
            customers: response.data || [],
            count: response.count || 0,
          };
        },
        3,
        1000
      );

      const duration = Date.now() - startTime;
      logIntegrationCall(logger, "ERP", "searchCustomers", true, duration);

      return result;
    } catch (error) {
      const duration = Date.now() - startTime;
      logIntegrationCall(
        logger,
        "ERP",
        "searchCustomers",
        false,
        duration,
        error
      );
      throw new IntegrationError("ERP", "searchCustomers", error, {
        searchTerm,
      });
    }
  }

  /**
   * Get single customer by name/ID
   * @param {string} customerName - Customer name or ID
   * @returns {Promise<Object>} Customer details
   */
  async getCustomer(customerName) {
    const startTime = Date.now();

    try {
      const result = await retry(
        async () => {
          const endpoint = `/api/method/levitate_integration.api.get_customer?name=${encodeURIComponent(
            customerName
          )}`;
          const response = await this.makeRequest(endpoint);

          if (!response.success && response.success !== undefined) {
            throw new Error(
              response.message || "Get customer failed - success field is false"
            );
          }

          return response.data || null;
        },
        3,
        1000
      );

      const duration = Date.now() - startTime;
      logIntegrationCall(logger, "ERP", "getCustomer", true, duration);

      return result;
    } catch (error) {
      const duration = Date.now() - startTime;
      logIntegrationCall(logger, "ERP", "getCustomer", false, duration, error);
      throw new IntegrationError("ERP", "getCustomer", error, { customerName });
    }
  }

  /**
   * Create new customer
   * @param {Object} customerData - Customer data
   * @param {string} customerData.customer_name - Customer name (required)
   * @param {string} customerData.email - Customer email (optional)
   * @returns {Promise<Object>} Created customer data with name field
   */
  async createCustomer(customerData) {
    const startTime = Date.now();

    try {
      const result = await retry(
        async () => {
          if (!customerData.customer_name) {
            throw new Error("customer_name is required");
          }

          const endpoint = `/api/method/levitate_integration.api.create_customer`;
          const body = {
            customer_name: customerData.customer_name,
            email: customerData.email || undefined,
          };

          const response = await this.makeRequest(endpoint, "POST", body);

          if (!response.success && response.success !== undefined) {
            throw new Error(
              response.message ||
                "Customer creation failed - success field is false"
            );
          }

          // Return customer name (primary key) from response
          return {
            name: response.data?.name || customerData.customer_name,
            ...response.data,
          };
        },
        3,
        1000
      );

      const duration = Date.now() - startTime;
      logIntegrationCall(logger, "ERP", "createCustomer", true, duration);

      return result;
    } catch (error) {
      const duration = Date.now() - startTime;
      logIntegrationCall(
        logger,
        "ERP",
        "createCustomer",
        false,
        duration,
        error
      );
      throw new IntegrationError("ERP", "createCustomer", error, {
        customerData,
      });
    }
  }

  /**
   * Search for customer by exact name, create if not found
   * CRITICAL: Customer name field is the primary key
   * @param {string} customerName - Exact customer name to search for
   * @param {string} email - Customer email (optional, used when creating)
   * @returns {Promise<string>} Customer name (primary key) to use in quotes
   */
  async searchOrCreateCustomer(customerName, email = null) {
    const startTime = Date.now();

    try {
      // Search for customer by exact name
      const searchResult = await this.searchCustomers(customerName);

      // Check for exact name match
      const exactMatch = searchResult.customers.find(
        (customer) =>
          customer.name === customerName ||
          customer.customer_name === customerName
      );

      if (exactMatch) {
        logger.info(
          {
            customerName,
            foundName: exactMatch.name || exactMatch.customer_name,
          },
          "Found existing customer by exact name match"
        );

        const duration = Date.now() - startTime;
        logIntegrationCall(
          logger,
          "ERP",
          "searchOrCreateCustomer",
          true,
          duration
        );

        // Return the name field (primary key)
        return exactMatch.name || exactMatch.customer_name;
      }

      // No exact match found, create new customer
      logger.info(
        { customerName, email },
        "No exact customer match found, creating new customer"
      );

      const newCustomer = await this.createCustomer({
        customer_name: customerName,
        email: email || undefined,
      });

      const duration = Date.now() - startTime;
      logIntegrationCall(
        logger,
        "ERP",
        "searchOrCreateCustomer",
        true,
        duration
      );

      // Return the name field (primary key)
      return newCustomer.name || customerName;
    } catch (error) {
      const duration = Date.now() - startTime;
      logIntegrationCall(
        logger,
        "ERP",
        "searchOrCreateCustomer",
        false,
        duration,
        error
      );
      throw new IntegrationError("ERP", "searchOrCreateCustomer", error, {
        customerName,
        email,
      });
    }
  }

  // ==================== ITEM MANAGEMENT ====================

  /**
   * Search for items by keyword
   * Searches Name, Code, and Description
   * @param {string} searchTerm - Search keyword
   * @returns {Promise<Array>} Array of item objects
   */
  async searchItems(searchTerm) {
    const startTime = Date.now();

    try {
      const result = await retry(
        async () => {
          const endpoint = `/api/method/levitate_integration.api.search_items?search_term=${encodeURIComponent(
            searchTerm
          )}`;
          const response = await this.makeRequest(endpoint);

          if (!response.success && response.success !== undefined) {
            throw new Error(
              response.message || "Item search failed - success field is false"
            );
          }

          return {
            items: response.data || [],
            count: response.count || 0,
          };
        },
        3,
        1000
      );

      const duration = Date.now() - startTime;
      logIntegrationCall(logger, "ERP", "searchItems", true, duration);

      return result;
    } catch (error) {
      const duration = Date.now() - startTime;
      logIntegrationCall(logger, "ERP", "searchItems", false, duration, error);
      throw new IntegrationError("ERP", "searchItems", error, {
        searchTerm,
      });
    }
  }

  /**
   * Get single item by item_code
   * @param {string} itemCode - Item code
   * @returns {Promise<Object>} Item details
   */
  async getItem(itemCode) {
    const startTime = Date.now();

    try {
      const result = await retry(
        async () => {
          const endpoint = `/api/method/levitate_integration.api.get_item?item_code=${encodeURIComponent(
            itemCode
          )}`;
          const response = await this.makeRequest(endpoint);

          if (!response.success && response.success !== undefined) {
            throw new Error(
              response.message || "Get item failed - success field is false"
            );
          }

          return response.data || null;
        },
        3,
        1000
      );

      const duration = Date.now() - startTime;
      logIntegrationCall(logger, "ERP", "getItem", true, duration);

      return result;
    } catch (error) {
      const duration = Date.now() - startTime;
      logIntegrationCall(logger, "ERP", "getItem", false, duration, error);
      throw new IntegrationError("ERP", "getItem", error, { itemCode });
    }
  }

  /**
   * Create new item
   * @param {Object} itemData - Item data
   * @param {string} itemData.item_code - Item code (required)
   * @param {string} itemData.description - Item description (required)
   * @param {string} itemData.stock_uom - Stock unit of measure (default: "Nos")
   * @returns {Promise<Object>} Created item data with name field
   */
  async createItem(itemData) {
    const startTime = Date.now();

    try {
      const result = await retry(
        async () => {
          if (!itemData.item_code) {
            throw new Error("item_code is required");
          }

          if (!itemData.description) {
            throw new Error("description is required");
          }

          const endpoint = `/api/method/levitate_integration.api.create_item`;
          const body = {
            data: {
              item_code: itemData.item_code,
              description: itemData.description,
              stock_uom: itemData.stock_uom || "Nos",
            },
          };

          const response = await this.makeRequest(endpoint, "POST", body);

          if (!response.success && response.success !== undefined) {
            throw new Error(
              response.message ||
                "Item creation failed - success field is false"
            );
          }

          // Return item code (primary identifier) from response
          return {
            item_code: response.data?.name || itemData.item_code,
            ...response.data,
          };
        },
        3,
        1000
      );

      const duration = Date.now() - startTime;
      logIntegrationCall(logger, "ERP", "createItem", true, duration);

      return result;
    } catch (error) {
      const duration = Date.now() - startTime;
      logIntegrationCall(logger, "ERP", "createItem", false, duration, error);
      throw new IntegrationError("ERP", "createItem", error, { itemData });
    }
  }

  /**
   * Search for item by exact code/name, create if not found
   * CRITICAL: Item must exist before using in quote
   * @param {string} itemCode - Exact item code or name to search for
   * @param {string} description - Item description (used when creating)
   * @param {string} stockUom - Stock unit of measure (default: "Nos")
   * @returns {Promise<string>} Item code to use in quotes
   */
  async searchOrCreateItem(itemCode, description, stockUom = "Nos") {
    const startTime = Date.now();

    try {
      // Search for item by exact code or name
      const searchResult = await this.searchItems(itemCode);

      // Check for exact match on item_code or item_name
      const exactMatch = searchResult.items.find(
        (item) => item.item_code === itemCode || item.item_name === itemCode
      );

      if (exactMatch) {
        logger.info(
          {
            itemCode,
            foundCode: exactMatch.item_code,
          },
          "Found existing item by exact code/name match"
        );

        const duration = Date.now() - startTime;
        logIntegrationCall(logger, "ERP", "searchOrCreateItem", true, duration);

        // Return the item_code
        return exactMatch.item_code;
      }

      // No exact match found, create new item
      logger.info(
        { itemCode, description, stockUom },
        "No exact item match found, creating new item"
      );

      const newItem = await this.createItem({
        item_code: itemCode,
        description: description || itemCode,
        stock_uom: stockUom,
      });

      const duration = Date.now() - startTime;
      logIntegrationCall(logger, "ERP", "searchOrCreateItem", true, duration);

      // Return the item_code
      return newItem.item_code || itemCode;
    } catch (error) {
      const duration = Date.now() - startTime;
      logIntegrationCall(
        logger,
        "ERP",
        "searchOrCreateItem",
        false,
        duration,
        error
      );
      throw new IntegrationError("ERP", "searchOrCreateItem", error, {
        itemCode,
        description,
        stockUom,
      });
    }
  }

  // ==================== QUOTATION MANAGEMENT ====================

  /**
   * Create draft quotation
   * PREREQUISITES: Customer must exist, All items must exist
   * @param {Object} data - Quotation data
   * @param {string} data.customer - Customer name (must exist)
   * @param {Array} data.items - Array of items with item_code, qty, rate, description
   * @param {string} data.transaction_date - YYYY-MM-DD (optional, defaults to today)
   * @param {string} data.valid_till - YYYY-MM-DD (optional)
   * @param {string} data.order_type - "Sales" (optional)
   * @param {string} data.taxes_and_charges - Tax template name (optional)
   * @returns {Promise<Object>} Created quotation with name (ID) field
   */
  async createQuotation(data) {
    const startTime = Date.now();

    try {
      const result = await retry(
        async () => {
          if (!data.customer) {
            throw new Error("customer is required");
          }

          if (
            !data.items ||
            !Array.isArray(data.items) ||
            data.items.length === 0
          ) {
            throw new Error("items array is required and must not be empty");
          }

          const endpoint = `/api/method/levitate_integration.api.create_quotation`;
          const body = {
            data: {
              customer: data.customer,
              items: data.items,
              transaction_date: data.transaction_date || undefined,
              valid_till: data.valid_till || undefined,
              order_type: data.order_type || "Sales",
              taxes_and_charges: data.taxes_and_charges || undefined,
            },
          };

          const response = await this.makeRequest(endpoint, "POST", body);

          if (!response.success && response.success !== undefined) {
            throw new Error(
              response.message ||
                "Quotation creation failed - success field is false"
            );
          }

          return {
            quoteId: response.data?.name,
            ...response.data,
          };
        },
        3,
        1000
      );

      const duration = Date.now() - startTime;
      logIntegrationCall(logger, "ERP", "createQuotation", true, duration);

      return result;
    } catch (error) {
      const duration = Date.now() - startTime;
      logIntegrationCall(
        logger,
        "ERP",
        "createQuotation",
        false,
        duration,
        error
      );
      throw new IntegrationError("ERP", "createQuotation", error, { data });
    }
  }

  /**
   * Get quotation details
   * Also verifies if quotation is cancelled
   * @param {string} quoteId - Quotation ID (e.g., "SAL-QTN-2025-00001")
   * @returns {Promise<Object>} Quotation data with cancellation status
   */
  async getQuotation(quoteId) {
    const startTime = Date.now();

    try {
      const result = await retry(
        async () => {
          const endpoint = `/api/method/levitate_integration.api.get_quotation?name=${encodeURIComponent(
            quoteId
          )}`;
          const response = await this.makeRequest(endpoint);

          // Check for cancelled quotation response
          if (response.quotation_canceled === true) {
            logger.warn(
              {
                quoteId,
                latestCanceledId: response.latest_canceled_id,
              },
              "Quotation is cancelled"
            );

            return {
              ...response.data,
              quotation_canceled: true,
              latest_canceled_id: response.latest_canceled_id,
            };
          }

          if (!response.success && response.success !== undefined) {
            throw new Error(
              response.message ||
                "Get quotation failed - success field is false"
            );
          }

          return {
            ...response.data,
            quotation_canceled: false,
          };
        },
        3,
        1000
      );

      const duration = Date.now() - startTime;
      logIntegrationCall(logger, "ERP", "getQuotation", true, duration);

      return result;
    } catch (error) {
      const duration = Date.now() - startTime;
      logIntegrationCall(logger, "ERP", "getQuotation", false, duration, error);
      throw new IntegrationError("ERP", "getQuotation", error, { quoteId });
    }
  }

  /**
   * Update draft quotation
   * CRITICAL: Items array completely replaces existing items
   * Must fetch existing items first, modify, then send full array
   * Only works on draft quotes (docstatus: 0)
   * PREREQUISITES: All items in array must exist
   * @param {string} quoteId - Quotation ID
   * @param {Object} data - Update data
   * @param {Array} data.items - Complete items array (replaces existing)
   * @param {string} data.valid_till - Valid till date (optional)
   * @returns {Promise<Object>} Updated quotation data
   */
  async updateQuotation(quoteId, data) {
    const startTime = Date.now();

    try {
      const result = await retry(
        async () => {
          if (!quoteId) {
            throw new Error("quoteId is required");
          }

          // Verify quote is not cancelled before updating
          const existingQuote = await this.getQuotation(quoteId);
          if (existingQuote.quotation_canceled) {
            throw new Error(
              `Cannot update cancelled quotation. Use amendQuotation instead. Latest cancelled ID: ${existingQuote.latest_canceled_id}`
            );
          }

          if (existingQuote.docstatus !== 0) {
            throw new Error(
              `Cannot update quotation with docstatus ${existingQuote.docstatus}. Only draft quotes (docstatus: 0) can be updated.`
            );
          }

          const endpoint = `/api/method/levitate_integration.api.update_quotation`;
          const body = {
            data: {
              name: quoteId,
              items: data.items || undefined,
              valid_till: data.valid_till || undefined,
            },
          };

          const response = await this.makeRequest(endpoint, "POST", body);

          if (!response.success && response.success !== undefined) {
            throw new Error(
              response.message ||
                "Quotation update failed - success field is false"
            );
          }

          return response.data || {};
        },
        3,
        1000
      );

      const duration = Date.now() - startTime;
      logIntegrationCall(logger, "ERP", "updateQuotation", true, duration);

      return result;
    } catch (error) {
      const duration = Date.now() - startTime;
      logIntegrationCall(
        logger,
        "ERP",
        "updateQuotation",
        false,
        duration,
        error
      );
      throw new IntegrationError("ERP", "updateQuotation", error, {
        quoteId,
        data,
      });
    }
  }

  /**
   * Submit quotation (docstatus: 0 → 1)
   * Once submitted, quotation cannot be edited
   * @param {string} quoteId - Quotation ID
   * @returns {Promise<Object>} Submission result
   */
  async submitQuotation(quoteId) {
    const startTime = Date.now();

    try {
      const result = await retry(
        async () => {
          if (!quoteId) {
            throw new Error("quoteId is required");
          }

          const endpoint = `/api/method/levitate_integration.api.submit_quotation`;
          const body = {
            name: quoteId,
          };

          const response = await this.makeRequest(endpoint, "POST", body);

          if (!response.success && response.success !== undefined) {
            throw new Error(
              response.message ||
                "Quotation submission failed - success field is false"
            );
          }

          return response.data || { submitted: true, quoteId };
        },
        3,
        1000
      );

      const duration = Date.now() - startTime;
      logIntegrationCall(logger, "ERP", "submitQuotation", true, duration);

      return result;
    } catch (error) {
      const duration = Date.now() - startTime;
      logIntegrationCall(
        logger,
        "ERP",
        "submitQuotation",
        false,
        duration,
        error
      );
      throw new IntegrationError("ERP", "submitQuotation", error, { quoteId });
    }
  }

  /**
   * Cancel submitted quotation
   * NOTE: API may return success: false but cancellation actually worked
   * Always verify with getQuotation() after cancellation
   * @param {string} quoteId - Quotation ID
   * @returns {Promise<Object>} Cancellation result
   */
  async cancelQuotation(quoteId) {
    const startTime = Date.now();

    try {
      const result = await retry(
        async () => {
          if (!quoteId) {
            throw new Error("quoteId is required");
          }

          const endpoint = `/api/method/levitate_integration.api.cancel_quotation?name=${encodeURIComponent(
            quoteId
          )}`;
          const response = await this.makeRequest(endpoint, "POST");

          // NOTE: Cancellation API quirk - sometimes shows success: false but actually worked
          // Always verify with getQuotation() after cancellation
          logger.info(
            {
              quoteId,
              responseSuccess: response.success,
            },
            "Cancellation request completed. Verify with getQuotation() to confirm status."
          );

          // Verify cancellation by getting the quote
          const verification = await this.getQuotation(quoteId);
          if (!verification.quotation_canceled) {
            throw new Error(
              "Cancellation may have failed. Quote is not showing as cancelled."
            );
          }

          return {
            cancelled: true,
            quoteId,
            latest_canceled_id: verification.latest_canceled_id,
          };
        },
        3,
        1000
      );

      const duration = Date.now() - startTime;
      logIntegrationCall(logger, "ERP", "cancelQuotation", true, duration);

      return result;
    } catch (error) {
      const duration = Date.now() - startTime;
      logIntegrationCall(
        logger,
        "ERP",
        "cancelQuotation",
        false,
        duration,
        error
      );
      throw new IntegrationError("ERP", "cancelQuotation", error, { quoteId });
    }
  }

  /**
   * Amend cancelled quotation (create new draft from cancelled quote)
   * CRITICAL: Returns new quote ID in data.name (not the cancelled ID)
   * Use this new ID for subsequent operations
   * @param {string} cancelledQuoteId - Cancelled quotation ID
   * @param {Object} data - New data for amended quote
   * @returns {Promise<Object>} New quotation data with name (new quote ID)
   */
  async amendQuotation(cancelledQuoteId, data) {
    const startTime = Date.now();

    try {
      const result = await retry(
        async () => {
          if (!cancelledQuoteId) {
            throw new Error("cancelledQuoteId is required");
          }

          const endpoint = `/api/method/levitate_integration.api.amend_quotation`;
          const body = {
            name: cancelledQuoteId,
            data: data || {},
          };

          const response = await this.makeRequest(endpoint, "POST", body);

          if (!response.success && response.success !== undefined) {
            throw new Error(
              response.message ||
                "Quotation amendment failed - success field is false"
            );
          }

          // CRITICAL: Response returns new quote ID in data.name
          const newQuoteId = response.data?.name;
          if (!newQuoteId) {
            throw new Error(
              "Amend quotation response missing new quote ID in data.name"
            );
          }

          logger.info(
            {
              cancelledQuoteId,
              newQuoteId,
              amendedFrom: response.data?.amended_from,
            },
            "Quotation amended successfully. Use new quote ID for subsequent operations."
          );

          return {
            newQuoteId,
            quoteId: newQuoteId, // Alias for consistency
            ...response.data,
          };
        },
        3,
        1000
      );

      const duration = Date.now() - startTime;
      logIntegrationCall(logger, "ERP", "amendQuotation", true, duration);

      return result;
    } catch (error) {
      const duration = Date.now() - startTime;
      logIntegrationCall(
        logger,
        "ERP",
        "amendQuotation",
        false,
        duration,
        error
      );
      throw new IntegrationError("ERP", "amendQuotation", error, {
        cancelledQuoteId,
        data,
      });
    }
  }

  /**
   * Create sales invoice from quotation
   * @param {string} quoteId - Quotation ID to create invoice from
   * @param {Object} invoiceData - Invoice data
   * @param {string} invoiceData.customer - Customer name
   * @param {Array} invoiceData.items - Invoice items
   * @param {string} invoiceData.posting_date - Invoice date (YYYY-MM-DD)
   * @param {string} invoiceData.due_date - Payment due date (YYYY-MM-DD)
   * @param {number} invoiceData.update_stock - 0 (No) or 1 (Yes)
   * @param {string} invoiceData.taxes_and_charges - Tax template name (optional)
   * @returns {Promise<Object>} Created invoice with name (ID) field
   */
  async createSalesInvoice(quoteId, invoiceData) {
    const startTime = Date.now();

    try {
      const result = await retry(
        async () => {
          if (!quoteId) {
            throw new Error("quoteId is required");
          }

          if (!invoiceData.customer) {
            throw new Error("customer is required in invoiceData");
          }

          if (
            !invoiceData.items ||
            !Array.isArray(invoiceData.items) ||
            invoiceData.items.length === 0
          ) {
            throw new Error("items array is required and must not be empty");
          }

          const endpoint = `/api/method/levitate_integration.api.create_sales_invoice`;
          const body = {
            data: {
              customer: invoiceData.customer,
              quotation: quoteId, // Link invoice to quote
              items: invoiceData.items,
              posting_date: invoiceData.posting_date || undefined,
              due_date: invoiceData.due_date || undefined,
              update_stock: invoiceData.update_stock || 0,
              taxes_and_charges: invoiceData.taxes_and_charges || undefined,
            },
          };

          const response = await this.makeRequest(endpoint, "POST", body);

          if (!response.success && response.success !== undefined) {
            throw new Error(
              response.message ||
                "Invoice creation failed - success field is false"
            );
          }

          return {
            invoiceId: response.data?.name,
            ...response.data,
          };
        },
        3,
        1000
      );

      const duration = Date.now() - startTime;
      logIntegrationCall(logger, "ERP", "createSalesInvoice", true, duration);

      return result;
    } catch (error) {
      const duration = Date.now() - startTime;
      logIntegrationCall(
        logger,
        "ERP",
        "createSalesInvoice",
        false,
        duration,
        error
      );
      throw new IntegrationError("ERP", "createSalesInvoice", error, {
        quoteId,
        invoiceData,
      });
    }
  }

  /**
   * Download quotation PDF
   * @param {string} quoteId - Quotation ID
   * @param {string} format - PDF format (default: "Standard")
   * @param {number} noLetterhead - 0 (Include) or 1 (Exclude) (default: 0)
   * @returns {Promise<Buffer>} PDF binary data
   */
  async getQuotationPDF(quoteId, format = "test", noLetterhead = "0") {
    const startTime = Date.now();

    try {
      const result = await retry(
        async () => {
          if (!quoteId) {
            throw new Error("quoteId is required");
          }

          const endpoint = `/api/method/frappe.utils.print_format.download_pdf?doctype=Quotation&name=${encodeURIComponent(
            quoteId
          )}&format=${format}&no_letterhead=${noLetterhead}`;
          const pdfBuffer = await this.makeRequest(endpoint);

          if (!Buffer.isBuffer(pdfBuffer)) {
            throw new Error(
              "Expected PDF buffer but received different data type"
            );
          }

          return pdfBuffer;
        },
        3,
        2000 // PDF generation can be slower
      );

      const duration = Date.now() - startTime;
      logIntegrationCall(logger, "ERP", "getQuotationPDF", true, duration);

      return result;
    } catch (error) {
      const duration = Date.now() - startTime;
      logIntegrationCall(
        logger,
        "ERP",
        "getQuotationPDF",
        false,
        duration,
        error
      );
      throw new IntegrationError("ERP", "getQuotationPDF", error, {
        quoteId,
        format,
        noLetterhead,
      });
    }
  }
}

// Create singleton instance
let erpIntegration = null;

const getErpIntegration = () => {
  if (!erpIntegration) {
    erpIntegration = new LevitateStudiosErpIntegration();
  }
  return erpIntegration;
};

// Export both class and singleton instance
module.exports = {
  LevitateStudiosErpIntegration,
  erpIntegration: getErpIntegration(),
  getErpIntegration,
};
