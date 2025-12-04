const { TavilyError } = require("@/utils/errors");
const { createLogger, logIntegrationCall } = require("@/utils/logger");
const { retry } = require("@/utils");
const { appConfig } = require("@/config");

const logger = createLogger("integration:tavily");

/**
 * Tavily API Integration
 * Handles research queries using Tavily's search API
 * Used for workplan research and data gathering
 */
class TavilyIntegration {
  constructor() {
    // Read API key from config
    this.apiKey = appConfig.tavily?.apiKey;

    // Validate API key exists
    if (!this.apiKey) {
      throw new Error(
        "Tavily API key is not configured. Set TAVILY_API_KEY environment variable."
      );
    }

    // Set base URL
    this.baseUrl = "https://api.tavily.com";

    logger.info("Tavily integration initialized");
  }

  /**
   * Make HTTP request to Tavily API
   * @private
   * @param {string} endpoint - API endpoint
   * @param {Object} body - Request body
   * @returns {Promise<Object>} API response
   */
  async makeRequest(endpoint, body) {
    const url = `${this.baseUrl}${endpoint}`;
    const headers = {
      "Content-Type": "application/json",
    };

    const response = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });

    // Handle API errors
    if (!response.ok) {
      const errorText = await response.text();
      let errorMessage = `Tavily API error: ${response.status} ${response.statusText}`;

      // Handle specific error codes
      if (response.status === 429) {
        errorMessage = "Tavily API rate limit exceeded";
        throw new TavilyError("search", new Error(errorMessage), {
          statusCode: 429,
        });
      } else if (response.status === 401) {
        errorMessage = "Tavily API authentication failed. Check your API key.";
        throw new TavilyError("search", new Error(errorMessage), {
          statusCode: 401,
        });
      } else if (response.status === 500) {
        errorMessage = "Tavily API server error";
        throw new TavilyError("search", new Error(errorMessage), {
          statusCode: 500,
        });
      }

      // Generic error handling
      try {
        const errorData = JSON.parse(errorText);
        errorMessage = errorData.error || errorData.message || errorMessage;
      } catch (e) {
        // If error response is not JSON, use the text
        if (errorText) {
          errorMessage = `${errorMessage} - ${errorText}`;
        }
      }

      throw new TavilyError("search", new Error(errorMessage), {
        statusCode: response.status,
        errorText,
      });
    }

    return response.json();
  }

  /**
   * Search Tavily API with query and options
   * @param {string} query - Search query
   * @param {Object} options - Search options
   * @param {string} [options.search_depth="basic"] - Search depth: "basic" or "advanced"
   * @param {boolean} [options.include_answer=false] - Include AI-generated answer
   * @param {boolean} [options.include_raw_content=false] - Include raw content
   * @param {boolean} [options.include_images=false] - Include images
   * @param {number} [options.max_results=5] - Maximum number of results
   * @returns {Promise<Object>} Search results with format: { results: [{ title, url, content, score }], query }
   */
  async search(query, options = {}) {
    const startTime = Date.now();

    try {
      // Validate query
      if (!query || typeof query !== "string" || query.trim().length === 0) {
        throw new Error("Query is required and must be a non-empty string");
      }

      // Build request body with defaults
      const requestBody = {
        api_key: this.apiKey,
        query: query.trim(),
        search_depth: options.search_depth || "basic",
        include_answer: options.include_answer || false,
        include_raw_content: options.include_raw_content || false,
        include_images: options.include_images || false,
        max_results: options.max_results || 5,
      };

      // Validate search_depth
      if (!["basic", "advanced"].includes(requestBody.search_depth)) {
        throw new Error('search_depth must be either "basic" or "advanced"');
      }

      // Validate max_results
      if (requestBody.max_results < 1 || requestBody.max_results > 20) {
        throw new Error("max_results must be between 1 and 20");
      }

      const result = await retry(
        async () => {
          const response = await this.makeRequest("/search", requestBody);

          // Transform response to expected format
          const transformedResults = {
            results: (response.results || []).map((result) => ({
              title: result.title || "",
              url: result.url || "",
              content: result.content || "",
              score: result.score || 0,
            })),
            query: query.trim(),
          };

          return transformedResults;
        },
        3, // 3 attempts
        1000 // Base delay of 1 second (exponential backoff)
      );

      const duration = Date.now() - startTime;
      logIntegrationCall(logger, "Tavily", "search", true, duration);

      return result;
    } catch (error) {
      const duration = Date.now() - startTime;
      logIntegrationCall(logger, "Tavily", "search", false, duration, error);

      // Re-throw TavilyError as-is
      if (error instanceof TavilyError) {
        throw error;
      }

      // Wrap other errors
      throw new TavilyError("search", error, { query, options });
    }
  }

  /**
   * Search Tavily API with filters
   * @param {string} query - Search query
   * @param {Object} filters - Filter options
   * @param {Object} [filters.dateRange] - Date range filter
   * @param {string} [filters.dateRange.start] - Start date (ISO format)
   * @param {string} [filters.dateRange.end] - End date (ISO format)
   * @param {string[]} [filters.domains] - Include only these domains
   * @param {string[]} [filters.excludeDomains] - Exclude these domains
   * @param {Object} [options] - Additional search options (same as search method)
   * @returns {Promise<Object>} Search results with format: { results: [{ title, url, content, score }], query }
   */
  async searchWithFilters(query, filters = {}, options = {}) {
    const startTime = Date.now();

    try {
      // Validate query
      if (!query || typeof query !== "string" || query.trim().length === 0) {
        throw new Error("Query is required and must be a non-empty string");
      }

      // Build request body with defaults
      const requestBody = {
        api_key: this.apiKey,
        query: query.trim(),
        search_depth: options.search_depth || "basic",
        include_answer: options.include_answer || false,
        include_raw_content: options.include_raw_content || false,
        include_images: options.include_images || false,
        max_results: options.max_results || 5,
      };

      // Add date range filter if provided
      if (filters.dateRange) {
        if (filters.dateRange.start) {
          requestBody.published_after = filters.dateRange.start;
        }
        if (filters.dateRange.end) {
          requestBody.published_before = filters.dateRange.end;
        }
      }

      // Add domain filters if provided
      if (
        filters.domains &&
        Array.isArray(filters.domains) &&
        filters.domains.length > 0
      ) {
        requestBody.include_domains = filters.domains;
      }

      if (
        filters.excludeDomains &&
        Array.isArray(filters.excludeDomains) &&
        filters.excludeDomains.length > 0
      ) {
        requestBody.exclude_domains = filters.excludeDomains;
      }

      // Validate search_depth
      if (!["basic", "advanced"].includes(requestBody.search_depth)) {
        throw new Error('search_depth must be either "basic" or "advanced"');
      }

      // Validate max_results
      if (requestBody.max_results < 1 || requestBody.max_results > 20) {
        throw new Error("max_results must be between 1 and 20");
      }

      const result = await retry(
        async () => {
          const response = await this.makeRequest("/search", requestBody);

          // Transform response to expected format
          const transformedResults = {
            results: (response.results || []).map((result) => ({
              title: result.title || "",
              url: result.url || "",
              content: result.content || "",
              score: result.score || 0,
            })),
            query: query.trim(),
          };

          return transformedResults;
        },
        3, // 3 attempts
        1000 // Base delay of 1 second (exponential backoff)
      );

      const duration = Date.now() - startTime;
      logIntegrationCall(logger, "Tavily", "searchWithFilters", true, duration);

      return result;
    } catch (error) {
      const duration = Date.now() - startTime;
      logIntegrationCall(
        logger,
        "Tavily",
        "searchWithFilters",
        false,
        duration,
        error
      );

      // Re-throw TavilyError as-is
      if (error instanceof TavilyError) {
        throw error;
      }

      // Wrap other errors
      throw new TavilyError("searchWithFilters", error, {
        query,
        filters,
        options,
      });
    }
  }
}

// Create and export singleton instance
const tavilyIntegration = new TavilyIntegration();

module.exports = {
  TavilyIntegration,
  tavilyIntegration,
};
