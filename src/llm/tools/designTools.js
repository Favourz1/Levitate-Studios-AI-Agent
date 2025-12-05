const { tool } = require("ai");
const { z } = require("zod");
const crypto = require("crypto");
const { createLogger } = require("@/utils/logger");
const { appConfig } = require("@/config");

const logger = createLogger("llm:tools:design");

/**
 * Helper to build OAuth 1.0a header for The Noun Project (no access token required)
 * @param {string} url - full request URL without query string
 * @param {string} method - HTTP method
 * @param {Object} params - query/body params included in signature
 * @returns {string} OAuth authorization header
 */
const buildNounProjectAuthHeader = (url, method, params = {}) => {
  const consumerKey = appConfig.designAssets?.nounProject?.apiKey;
  const consumerSecret = appConfig.designAssets?.nounProject?.apiSecret;

  if (!consumerKey || !consumerSecret) {
    throw new Error(
      "Noun Project API credentials are not configured (NOUNPROJECT_API_KEY & NOUNPROJECT_API_SECRET)"
    );
  }

  const oauthParams = {
    oauth_consumer_key: consumerKey,
    oauth_nonce: crypto.randomBytes(16).toString("hex"),
    oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp: Math.floor(Date.now() / 1000).toString(),
    oauth_version: "1.0",
  };

  const allParams = { ...params, ...oauthParams };
  const encode = (val) =>
    encodeURIComponent(val).replace(
      /[!*()']/g,
      (char) => `%${char.charCodeAt(0).toString(16)}`
    );

  const normalizedParams = Object.keys(allParams)
    .sort()
    .map((key) => `${encode(key)}=${encode(allParams[key])}`)
    .join("&");

  const signatureBaseString = [
    method.toUpperCase(),
    encode(url),
    encode(normalizedParams),
  ].join("&");

  const signingKey = `${encode(consumerSecret)}&`;
  const oauthSignature = crypto
    .createHmac("sha1", signingKey)
    .update(signatureBaseString)
    .digest("base64");

  const authHeaderParams = {
    ...oauthParams,
    oauth_signature: oauthSignature,
  };

  const authorization =
    "OAuth " +
    Object.keys(authHeaderParams)
      .sort()
      .map((key) => `${encode(key)}="${encode(authHeaderParams[key])}"`)
      .join(", ");

  return authorization;
};

/**
 * Pexels image search tool
 */
const imageSearchTool = tool({
  description:
    "Search for relevant images for slide design using the Pexels API",
  parameters: z.object({
    query: z.string().describe("Search query describing the desired image"),
    imageType: z
      .enum(["PHOTO", "ICON", "ILLUSTRATION"])
      .describe("Type of visual to search for")
      .default("PHOTO"),
    style: z.string().default("professional"),
  }),
  execute: async ({ query, imageType, style }) => {
    const apiKey = appConfig.designAssets?.pexelsApiKey;
    if (!apiKey) {
      throw new Error("PEXELS_API_KEY is not configured");
    }

    const searchQuery = `${query} ${style}`.trim();
    const url = new URL("https://api.pexels.com/v1/search");
    url.searchParams.set("query", searchQuery);
    url.searchParams.set("per_page", "6");
    url.searchParams.set("orientation", "landscape");

    try {
      logger.info(
        { query: searchQuery, imageType },
        "Searching Pexels for design images"
      );

      const response = await fetch(url.toString(), {
        method: "GET",
        headers: {
          Authorization: apiKey,
        },
      });

      if (!response.ok) {
        const body = await response.text();
        throw new Error(
          `Pexels API error (${response.status}): ${
            body || response.statusText
          }`
        );
      }

      const data = await response.json();
      const photos = Array.isArray(data.photos) ? data.photos : [];

      return photos.map((photo) => ({
        url:
          photo.src?.large2x ||
          photo.src?.large ||
          photo.src?.original ||
          photo.url,
        description: `Photo by ${photo.photographer || "Unknown"}`,
        license: "Pexels License",
      }));
    } catch (error) {
      logger.error(
        { query: searchQuery, error: error.message },
        "Failed to search images on Pexels"
      );
      throw error;
    }
  },
});

/**
 * The Noun Project icon search tool
 */
const iconSearchTool = tool({
  description:
    "Search for relevant icons for slide design using The Noun Project API",
  parameters: z.object({
    query: z.string().describe("Search query describing the desired icon"),
    imageType: z
      .enum(["PHOTO", "ICON", "ILLUSTRATION"])
      .describe("Type of visual to search for")
      .default("ICON"),
    style: z.string().default("professional"),
  }),
  execute: async ({ query, style }) => {
    const baseUrl = "https://api.thenounproject.com/v2/icon";
    const requestParams = {
      query: `${query} ${style}`.trim(),
      limit: 10,
    };

    const url = new URL(baseUrl);
    Object.entries(requestParams).forEach(([key, value]) =>
      url.searchParams.set(key, value)
    );

    const authorization = buildNounProjectAuthHeader(
      baseUrl,
      "GET",
      requestParams
    );

    try {
      logger.info(
        { query: requestParams.query, limit: requestParams.limit },
        "Searching The Noun Project for icons"
      );

      const response = await fetch(url.toString(), {
        method: "GET",
        headers: {
          Authorization: authorization,
          Accept: "application/json",
        },
      });

      if (!response.ok) {
        const body = await response.text();
        throw new Error(
          `Noun Project API error (${response.status}): ${
            body || response.statusText
          }`
        );
      }

      const data = await response.json();
      const icons = Array.isArray(data.icons || data?.data) // some responses wrap in data
        ? data.icons || data.data
        : [];

      return icons.map((icon) => ({
        url:
          icon.preview_url ||
          icon.thumbnail_url ||
          icon.icon_url ||
          icon.icon_url_svg,
        description:
          icon.term ||
          icon.attribution ||
          icon.description ||
          "Icon from The Noun Project",
        license:
          icon.license_description ||
          icon.license ||
          "The Noun Project (see licensing terms)",
      }));
    } catch (error) {
      logger.error(
        { query: requestParams.query, error: error.message },
        "Failed to search icons on The Noun Project"
      );
      throw error;
    }
  },
});

module.exports = {
  imageSearchTool,
  iconSearchTool,
};
