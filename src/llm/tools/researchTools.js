const { tool } = require("ai");
const { z } = require("zod");
const { tavilyIntegration } = require("@/integrations/tavily");
const { SlideType, ResearchDataType } = require("@/constants");
const { createLogger } = require("@/utils/logger");

const logger = createLogger("llm:tools:research");

/**
 * Competitor Analysis Tool
 * Researches competitor positioning, market share, and activities
 */
const competitorAnalysisTool = tool({
  description:
    "Research competitor positioning, market share, and activities for competitive analysis slides",
  parameters: z.object({
    competitorNames: z
      .array(z.string())
      .describe("Array of competitor company names to research"),
    industry: z
      .string()
      .describe("Industry or sector the competitors operate in"),
    slideType: z
      .enum(Object.values(SlideType))
      .describe("Type of slide this research is for"),
    region: z
      .string()
      .optional()
      .describe("Target region/market (e.g., 'Nigeria', 'West Africa')"),
  }),
  execute: async ({
    competitorNames,
    industry,
    slideType,
    region = "Nigeria",
  }) => {
    try {
      logger.info(
        {
          competitorNames,
          industry,
          slideType,
          region,
        },
        "Starting competitor analysis research"
      );

      const results = {
        competitors: [],
        marketLeaders: [],
        overallMarketShare: null,
        positioningInsights: [],
        recentCampaigns: [],
        slogans: [],
      };

      // Execute parallel searches for each competitor
      const searchPromises = competitorNames.map(async (competitorName) => {
        const queries = [
          `${competitorName} market share ${industry} ${region}`,
          `${competitorName} positioning strategy ${industry} ${region}`,
          `${competitorName} recent campaigns ${region}`,
          `${competitorName} brand slogan ${industry}`,
        ];

        // Execute searches in parallel
        const searchResults = await Promise.all(
          queries.map((query) =>
            tavilyIntegration.search(query, {
              search_depth: "advanced",
              max_results: 5,
            })
          )
        );

        // Extract structured data from search results
        const competitorData = {
          name: competitorName,
          marketShare: null,
          positioning: null,
          recentCampaigns: [],
          slogan: null,
          sources: [],
        };

        // Process market share results (first query)
        if (searchResults[0]?.results?.length > 0) {
          const marketShareContent = searchResults[0].results
            .map((r) => r.content)
            .join(" ");
          // Extract market share percentage using regex
          const marketShareMatch =
            marketShareContent.match(/(\d+\.?\d*)\s*%/gi);
          if (marketShareMatch) {
            competitorData.marketShare = parseFloat(marketShareMatch[0]);
          }
          competitorData.sources.push(
            ...searchResults[0].results.map((r) => ({
              source_type: "web",
              source_url: r.url,
              source_title: r.title,
              extracted_data: { marketShare: competitorData.marketShare },
              relevance_score: r.score || 0,
              verified: true,
            }))
          );
        }

        // Process positioning results (second query)
        if (searchResults[1]?.results?.length > 0) {
          competitorData.positioning =
            searchResults[1].results[0]?.content?.substring(0, 500) || null;
          competitorData.sources.push(
            ...searchResults[1].results.map((r) => ({
              source_type: "web",
              source_url: r.url,
              source_title: r.title,
              extracted_data: { positioning: competitorData.positioning },
              relevance_score: r.score || 0,
              verified: true,
            }))
          );
        }

        // Process recent campaigns (third query)
        if (searchResults[2]?.results?.length > 0) {
          competitorData.recentCampaigns = searchResults[2].results
            .slice(0, 3)
            .map((r) => ({
              title: r.title,
              description: r.content?.substring(0, 300),
              url: r.url,
            }));
          competitorData.sources.push(
            ...searchResults[2].results.map((r) => ({
              source_type: "web",
              source_url: r.url,
              source_title: r.title,
              extracted_data: { campaigns: competitorData.recentCampaigns },
              relevance_score: r.score || 0,
              verified: true,
            }))
          );
        }

        // Process slogans (fourth query)
        if (searchResults[3]?.results?.length > 0) {
          const sloganContent = searchResults[3].results[0]?.content || "";
          // Extract quoted text or short phrases as slogans
          const sloganMatch =
            sloganContent.match(/"([^"]+)"/) ||
            sloganContent.match(/'([^']+)'/);
          if (sloganMatch) {
            competitorData.slogan = sloganMatch[1];
          } else {
            // Fallback: extract first short sentence
            const sentences = sloganContent.split(/[.!?]/);
            competitorData.slogan =
              sentences.find((s) => s.length > 10 && s.length < 100) || null;
          }
        }

        return competitorData;
      });

      const competitorDataArray = await Promise.all(searchPromises);
      results.competitors = competitorDataArray;

      // Aggregate market share data
      const totalMarketShare = competitorDataArray.reduce(
        (sum, comp) => sum + (comp.marketShare || 0),
        0
      );
      if (totalMarketShare > 0) {
        results.overallMarketShare = totalMarketShare;
      }

      // Extract positioning insights
      results.positioningInsights = competitorDataArray
        .filter((c) => c.positioning)
        .map((c) => ({
          competitor: c.name,
          positioning: c.positioning,
        }));

      // Aggregate recent campaigns
      results.recentCampaigns = competitorDataArray.flatMap(
        (c) => c.recentCampaigns
      );

      // Aggregate slogans
      results.slogans = competitorDataArray
        .filter((c) => c.slogan)
        .map((c) => ({
          competitor: c.name,
          slogan: c.slogan,
        }));

      logger.info(
        {
          competitorCount: competitorDataArray.length,
          totalSources: competitorDataArray.reduce(
            (sum, c) => sum + c.sources.length,
            0
          ),
        },
        "Competitor analysis research completed"
      );

      return results;
    } catch (error) {
      logger.error(
        {
          competitorNames,
          industry,
          slideType,
          error: error.message,
        },
        "Failed to perform competitor analysis"
      );
      throw error;
    }
  },
});

/**
 * Market Data Tool
 * Extracts market statistics, growth rates, population data
 */
const marketDataTool = tool({
  description:
    "Extract market statistics, growth rates, population data, and consumer behavior trends",
  parameters: z.object({
    industry: z.string().describe("Industry or sector to research"),
    region: z
      .string()
      .optional()
      .describe(
        "Target region/market (defaults to 'Nigeria' if not specified)"
      ),
    dataType: z
      .enum(["GROWTH_RATE", "MARKET_SIZE", "POPULATION", "BEHAVIOR"])
      .describe("Type of data to extract"),
  }),
  execute: async ({ industry, region = "Nigeria", dataType }) => {
    try {
      logger.info(
        {
          industry,
          region,
          dataType,
        },
        "Starting market data extraction"
      );

      // Build query based on data type
      const currentYear = new Date().getFullYear();
      const nextYear = currentYear + 1;
      let query = "";
      switch (dataType) {
        case ResearchDataType.GROWTH_RATE:
          query = `${industry} growth rate CAGR ${region} ${currentYear} ${nextYear}`;
          break;
        case ResearchDataType.MARKET_SIZE:
          query = `${industry} market size USD ${region} ${currentYear}`;
          break;
        case ResearchDataType.POPULATION:
          query = `${industry} target population demographics ${region} ${currentYear}`;
          break;
        case ResearchDataType.BEHAVIOR:
          query = `${industry} consumer behavior trends ${region} ${currentYear}`;
          break;
        default:
          query = `${industry} market data ${region} ${currentYear}`;
      }

      // Execute search with advanced depth for better results
      const searchResult = await tavilyIntegration.search(query, {
        search_depth: "advanced",
        max_results: 10,
      });

      const results = {
        dataType,
        industry,
        region,
        value: null,
        unit: null,
        sources: [],
        extractedData: {},
        verified: false,
      };

      // Extract structured data from search results
      if (searchResult?.results?.length > 0) {
        const allContent = searchResult.results.map((r) => r.content).join(" ");

        // Extract numbers based on data type
        switch (dataType) {
          case ResearchDataType.GROWTH_RATE:
            // Look for percentage growth rates
            const growthMatch = allContent.match(
              /(\d+\.?\d*)\s*%\s*(?:CAGR|growth|annual|yearly)/gi
            );
            if (growthMatch) {
              results.value = parseFloat(growthMatch[0]);
              results.unit = "percentage";
            }
            break;

          case ResearchDataType.MARKET_SIZE:
            // Look for market size in USD, NGN, or billions/millions
            const sizeMatch = allContent.match(
              /(\$|USD|NGN|₦)?\s*(\d+\.?\d*)\s*(billion|million|trillion)/gi
            );
            if (sizeMatch) {
              const match = sizeMatch[0].match(
                /(\$|USD|NGN|₦)?\s*(\d+\.?\d*)\s*(billion|million|trillion)/i
              );
              if (match) {
                results.value = parseFloat(match[2]);
                results.unit = match[3].toLowerCase();
                if (match[1]) {
                  results.currency = match[1].replace(/[₦$]/g, "") || "USD";
                }
              }
            }
            break;

          case ResearchDataType.POPULATION:
            // Look for population numbers
            const popMatch = allContent.match(
              /(\d+\.?\d*)\s*(million|billion|thousand)\s*(?:people|population|users|consumers)/gi
            );
            if (popMatch) {
              const match = popMatch[0].match(
                /(\d+\.?\d*)\s*(million|billion|thousand)/i
              );
              if (match) {
                results.value = parseFloat(match[1]);
                results.unit = match[2].toLowerCase();
              }
            }
            break;

          case ResearchDataType.BEHAVIOR:
            // Extract key behavior trends (text-based)
            const behaviorKeywords = [
              "prefer",
              "tend to",
              "likely to",
              "behavior",
              "trend",
              "pattern",
            ];
            const behaviorSentences = allContent
              .split(/[.!?]/)
              .filter((sentence) =>
                behaviorKeywords.some((keyword) =>
                  sentence.toLowerCase().includes(keyword)
                )
              )
              .slice(0, 5);
            results.extractedData.behaviorTrends = behaviorSentences;
            results.value = behaviorSentences.length;
            results.unit = "trends";
            break;
        }

        // Store sources with relevance scores
        results.sources = searchResult.results.map((r) => ({
          source_type: "web",
          source_url: r.url,
          source_title: r.title,
          extracted_data: results.extractedData,
          relevance_score: r.score || 0,
          verified: r.score > 0.5, // Consider verified if relevance > 0.5
        }));

        // Mark as verified if we have at least 3 sources with good scores
        results.verified =
          results.sources.filter((s) => s.relevance_score > 0.7).length >= 3;
      }

      // Validate data quality
      if (!results.value && dataType !== "BEHAVIOR") {
        logger.warn(
          {
            industry,
            region,
            dataType,
          },
          "No numeric data extracted from market data search"
        );
      }

      logger.info(
        {
          industry,
          region,
          dataType,
          hasValue: !!results.value,
          sourceCount: results.sources.length,
          verified: results.verified,
        },
        "Market data extraction completed"
      );

      return results;
    } catch (error) {
      logger.error(
        {
          industry,
          region,
          dataType,
          error: error.message,
        },
        "Failed to extract market data"
      );
      throw error;
    }
  },
});

module.exports = {
  competitorAnalysisTool,
  marketDataTool,
};
