/**
 * Test script for Tavily Integration
 * Tests API connectivity and error handling
 *
 * Usage: node scripts/test-tavily-integration.js
 *
 * Prerequisites:
 * - Set TAVILY_API_KEY in your .env file
 */

// Load environment variables
require("dotenv").config();

// Import Tavily integration (may fail if API key is missing)
let tavilyIntegration, TavilyIntegration;
try {
  const tavilyModule = require("../src/integrations/tavily");
  tavilyIntegration = tavilyModule.tavilyIntegration;
  TavilyIntegration = tavilyModule.TavilyIntegration;
} catch (error) {
  // Handle case where singleton fails to initialize (missing API key)
  if (error.message.includes("Tavily API key")) {
    TavilyIntegration = require("../src/integrations/tavily").TavilyIntegration;
    tavilyIntegration = null; // Will be set later if API key becomes available
  } else {
    throw error;
  }
}

const { TavilyError } = require("../src/utils/errors");

// ANSI color codes for terminal output
const colors = {
  reset: "\x1b[0m",
  green: "\x1b[32m",
  red: "\x1b[31m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  cyan: "\x1b[36m",
};

function log(message, color = "reset") {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

function logSection(title) {
  console.log("\n" + "=".repeat(60));
  log(title, "cyan");
  console.log("=".repeat(60));
}

function logSuccess(message) {
  log(`✓ ${message}`, "green");
}

function logError(message) {
  log(`✗ ${message}`, "red");
}

function logInfo(message) {
  log(`ℹ ${message}`, "blue");
}

function logWarning(message) {
  log(`⚠ ${message}`, "yellow");
}

async function testBasicSearch() {
  logSection("Test 1: Basic Search Functionality");

  if (!tavilyIntegration) {
    logWarning(
      "Skipping test - tavilyIntegration not initialized (API key missing)"
    );
    return false;
  }

  try {
    logInfo("Calling tavilyIntegration.search('test query')...");

    const result = await tavilyIntegration.search("test query", {
      max_results: 3,
    });

    // Validate result structure
    if (!result || typeof result !== "object") {
      throw new Error("Result is not an object");
    }

    if (!result.results || !Array.isArray(result.results)) {
      throw new Error("Result.results is not an array");
    }

    if (result.query !== "test query") {
      throw new Error(
        `Query mismatch: expected 'test query', got '${result.query}'`
      );
    }

    logSuccess("API call succeeded!");
    logInfo(`Query: ${result.query}`);
    logInfo(`Results count: ${result.results.length}`);

    // Display first result details
    if (result.results.length > 0) {
      const firstResult = result.results[0];
      console.log("\nFirst result:");
      console.log(`  Title: ${firstResult.title || "N/A"}`);
      console.log(`  URL: ${firstResult.url || "N/A"}`);
      console.log(`  Score: ${firstResult.score || "N/A"}`);
      console.log(
        `  Content preview: ${(firstResult.content || "").substring(0, 100)}...`
      );
    }

    return true;
  } catch (error) {
    logError(`Basic search failed: ${error.message}`);
    if (error instanceof TavilyError) {
      console.log(`  Error type: TavilyError`);
      console.log(`  Status code: ${error.context?.statusCode || "N/A"}`);
    }
    console.error(error);
    return false;
  }
}

async function testSearchWithOptions() {
  logSection("Test 2: Search with Advanced Options");

  if (!tavilyIntegration) {
    logWarning(
      "Skipping test - tavilyIntegration not initialized (API key missing)"
    );
    return false;
  }

  try {
    logInfo("Calling search with advanced options...");

    const result = await tavilyIntegration.search("artificial intelligence", {
      search_depth: "advanced",
      max_results: 5,
      include_answer: false,
      include_raw_content: false,
      include_images: false,
    });

    logSuccess("Advanced search succeeded!");
    logInfo(`Query: ${result.query}`);
    logInfo(`Results count: ${result.results.length}`);

    // Validate all results have required fields
    const allValid = result.results.every(
      (r) =>
        r.title !== undefined && r.url !== undefined && r.content !== undefined
    );

    if (allValid) {
      logSuccess("All results have required fields (title, url, content)");
    } else {
      logWarning("Some results are missing required fields");
    }

    return true;
  } catch (error) {
    logError(`Advanced search failed: ${error.message}`);
    console.error(error);
    return false;
  }
}

async function testSearchWithFilters() {
  logSection("Test 3: Search with Filters");

  if (!tavilyIntegration) {
    logWarning(
      "Skipping test - tavilyIntegration not initialized (API key missing)"
    );
    return false;
  }

  try {
    logInfo("Calling searchWithFilters with domain filter...");

    const result = await tavilyIntegration.searchWithFilters(
      "technology trends",
      {
        domains: ["techcrunch.com", "wired.com"],
      },
      {
        max_results: 3,
      }
    );

    logSuccess("Filtered search succeeded!");
    logInfo(`Query: ${result.query}`);
    logInfo(`Results count: ${result.results.length}`);

    // Check if results are from filtered domains
    const filteredDomains = result.results
      .map((r) => {
        try {
          return new URL(r.url).hostname;
        } catch {
          return null;
        }
      })
      .filter(Boolean);

    logInfo(`Result domains: ${filteredDomains.join(", ") || "N/A"}`);

    return true;
  } catch (error) {
    logError(`Filtered search failed: ${error.message}`);
    console.error(error);
    return false;
  }
}

async function testInvalidAPIKey() {
  logSection("Test 4: Error Handling - Invalid API Key");

  try {
    logInfo("Creating TavilyIntegration instance with invalid API key...");

    // Temporarily override the API key
    const originalApiKey = process.env.TAVILY_API_KEY;
    process.env.TAVILY_API_KEY = "invalid_api_key_12345";

    // Create a new instance with invalid key
    const invalidIntegration = new TavilyIntegration();

    logInfo("Attempting search with invalid API key...");

    try {
      await invalidIntegration.search("test query");
      logError("Expected error was not thrown!");
      return false;
    } catch (error) {
      // Check if it's a TavilyError with 401 status
      if (error instanceof TavilyError) {
        if (error.context?.statusCode === 401) {
          logSuccess("Correctly caught 401 authentication error");
          logInfo(`Error message: ${error.message}`);
          return true;
        } else {
          logWarning(
            `Got TavilyError but with status code ${error.context?.statusCode}, expected 401`
          );
          return false;
        }
      } else {
        logWarning(`Got error but not TavilyError: ${error.constructor.name}`);
        return false;
      }
    } finally {
      // Restore original API key
      process.env.TAVILY_API_KEY = originalApiKey;
    }
  } catch (error) {
    logError(`Error handling test failed: ${error.message}`);
    console.error(error);
    return false;
  }
}

async function testMissingAPIKey() {
  logSection("Test 5: Error Handling - Missing API Key");

  try {
    logInfo("Testing initialization without API key...");

    const originalApiKey = process.env.TAVILY_API_KEY;
    delete process.env.TAVILY_API_KEY;

    try {
      new TavilyIntegration();
      logError("Expected error was not thrown during initialization!");
      return false;
    } catch (error) {
      if (error.message.includes("Tavily API key is not configured")) {
        logSuccess("Correctly caught missing API key error");
        logInfo(`Error message: ${error.message}`);
        return true;
      } else {
        logError(`Unexpected error message: ${error.message}`);
        return false;
      }
    } finally {
      // Restore original API key
      if (originalApiKey) {
        process.env.TAVILY_API_KEY = originalApiKey;
      }
    }
  } catch (error) {
    logError(`Missing API key test failed: ${error.message}`);
    console.error(error);
    return false;
  }
}

async function testInvalidQuery() {
  logSection("Test 6: Error Handling - Invalid Query");

  if (!tavilyIntegration) {
    logWarning(
      "Skipping test - tavilyIntegration not initialized (API key missing)"
    );
    return false;
  }

  try {
    logInfo("Testing with empty query...");

    try {
      await tavilyIntegration.search("");
      logError("Expected error was not thrown for empty query!");
      return false;
    } catch (error) {
      // Check both wrapped error message and original error message
      const errorMessage = error.context?.originalError || error.message || "";
      if (errorMessage.includes("Query is required")) {
        logSuccess("Correctly caught empty query error");
        logInfo(`Error message: ${errorMessage}`);
        return true;
      } else {
        logWarning(`Got error but unexpected message: ${errorMessage}`);
        return false;
      }
    }
  } catch (error) {
    logError(`Invalid query test failed: ${error.message}`);
    console.error(error);
    return false;
  }
}

async function runAllTests() {
  logSection("Tavily Integration Test Suite");
  logInfo("Starting tests...\n");

  // Check if API key is set
  const hasValidKey =
    process.env.TAVILY_API_KEY &&
    process.env.TAVILY_API_KEY !== "your_tavily_api_key_here" &&
    tavilyIntegration !== null;

  if (!hasValidKey) {
    logWarning(
      "TAVILY_API_KEY is not set or invalid in environment variables!"
    );
    logWarning(
      "Please set TAVILY_API_KEY in your .env file before running tests."
    );
    logWarning("Some tests will be skipped.");
    console.log("\n");
  } else {
    logSuccess(
      `API Key found: ${process.env.TAVILY_API_KEY.substring(0, 10)}...`
    );
  }

  const results = {
    passed: 0,
    failed: 0,
    skipped: 0,
  };

  const tests = [
    { name: "Basic Search", fn: testBasicSearch, requiresKey: true },
    {
      name: "Search with Options",
      fn: testSearchWithOptions,
      requiresKey: true,
    },
    {
      name: "Search with Filters",
      fn: testSearchWithFilters,
      requiresKey: true,
    },
    { name: "Invalid API Key", fn: testInvalidAPIKey, requiresKey: false },
    { name: "Missing API Key", fn: testMissingAPIKey, requiresKey: false },
    { name: "Invalid Query", fn: testInvalidQuery, requiresKey: true },
  ];

  for (const test of tests) {
    const hasKey =
      process.env.TAVILY_API_KEY &&
      process.env.TAVILY_API_KEY !== "your_tavily_api_key_here" &&
      tavilyIntegration !== null;

    if (test.requiresKey && !hasKey) {
      logWarning(
        `Skipping ${test.name} - API key not set or integration not initialized`
      );
      results.skipped++;
      continue;
    }

    try {
      const passed = await test.fn();
      if (passed) {
        results.passed++;
      } else {
        results.failed++;
      }
    } catch (error) {
      logError(`Test ${test.name} threw unexpected error: ${error.message}`);
      console.error(error);
      results.failed++;
    }

    // Small delay between tests
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  // Print summary
  logSection("Test Summary");
  logSuccess(`Passed: ${results.passed}`);
  if (results.failed > 0) {
    logError(`Failed: ${results.failed}`);
  }
  if (results.skipped > 0) {
    logWarning(`Skipped: ${results.skipped}`);
  }

  const total = results.passed + results.failed + results.skipped;
  const successRate =
    total > 0
      ? ((results.passed / (results.passed + results.failed)) * 100).toFixed(1)
      : 0;

  console.log("\n");
  if (results.failed === 0 && results.skipped === 0) {
    log("All tests passed! ✓", "green");
  } else if (results.failed === 0) {
    log(`All executed tests passed! (${successRate}% success rate)`, "green");
  } else {
    log(`Some tests failed. Success rate: ${successRate}%`, "yellow");
    process.exit(1);
  }
}

// Run tests
runAllTests().catch((error) => {
  logError(`Fatal error running tests: ${error.message}`);
  console.error(error);
  process.exit(1);
});
