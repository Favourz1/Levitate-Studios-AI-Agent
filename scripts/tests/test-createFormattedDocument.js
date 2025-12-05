require("module-alias/register");
const assert = require("assert");
const { googleIntegration } = require("@/integrations/google");

/**
 * Smoke test for googleIntegration.createFormattedDocument using realistic
 * workplan-style blocks for a marketing + social media campaign.
 *
 * This will create a real Google Doc in the authenticated Drive and share it
 * with the configured admin email (per integration defaults).
 */
async function main() {
  console.log("Starting createFormattedDocument smoke test...");

  const title = "Q1 2026 Marketing + Social Campaign Workplan";

  // Realistic blocks representing research, strategy, and design-ready content
  const blocks = [
    { type: "heading", level: 1, text: title },
    {
      type: "paragraph",
      text: "Comprehensive multi-channel campaign to grow brand awareness and pipeline for Levitate Studios consumer tech client.",
    },
    { type: "spacer", height: 18 },

    { type: "heading", level: 2, text: "Objectives" },
    {
      type: "bullets",
      items: [
        "Increase brand awareness by 20% in Q1 across key markets (US, NG, UK).",
        "Boost organic social engagement rate to 3.5% with high-signal formats (Reels, Stories, Threads).",
        "Generate 1,000 net-new MQLs via paid + owned social funnels.",
      ],
    },
    { type: "spacer", height: 12 },

    { type: "heading", level: 2, text: "Audience & Insight" },
    {
      type: "paragraph",
      text: "Primary: Tech-forward millennials (25-34) in urban centers. Secondary: Creators who influence purchase decisions. Insight: Social proof and creator-led demos outperform static brand ads by 2.1x CTR.",
    },

    { type: "spacer", height: 12 },
    { type: "heading", level: 2, text: "Channels & Cadence" },
    {
      type: "bullets",
      items: [
        "Instagram: 5 posts/wk (2 Reels, 2 carousels, 1 Story set) + weekly collab with micro-creators.",
        "TikTok: 4 short-form/week focusing on POV demos, duets, and trend-jacks.",
        "LinkedIn: 3 posts/week (thought leadership, case snippets, stat-led creative).",
        "Twitter/X: 4 tweets/day (threads, product tips, live reactions to industry news).",
        "YouTube Shorts: 2 per week repurposed from top-performing Reels/TikTok.",
      ],
    },

    { type: "spacer", height: 12 },
    { type: "heading", level: 2, text: "Timeline (Q1 2026)" },
    {
      type: "table",
      rows: [
        ["Phase", "Start", "End", "Owner"],
        ["Planning", "2026-01-02", "2026-01-12", "PM / Strategy"],
        ["Content Sprints", "2026-01-13", "2026-02-15", "Creative + Copy"],
        ["Execution", "2026-02-16", "2026-03-31", "Growth / Social"],
        ["Optimization", "2026-02-20", "2026-03-31", "Growth / Analytics"],
      ],
    },

    { type: "spacer", height: 12 },
    { type: "heading", level: 2, text: "Budget & Allocation" },
    {
      type: "table",
      rows: [
        ["Category", "Amount", "Notes"],
        [
          "Paid Social (Meta/TikTok/LinkedIn)",
          "$25,000",
          "60% prospecting / 40% retargeting",
        ],
        ["Content Production", "$15,000", "Creators, studio shoots, editing"],
        [
          "Tools & Listening",
          "$5,000",
          "Scheduling, social listening, UTM tracking",
        ],
        ["Contingency", "$5,000", "10% buffer for rapid experiments"],
      ],
    },

    { type: "spacer", height: 12 },
    { type: "heading", level: 2, text: "KPI Targets" },
    {
      type: "bullets",
      items: [
        "Engagement rate: 3.5% blended (IG/TikTok/Twitter).",
        "CTR: 1.8%+ on paid social CTR; 2.4%+ on retargeting.",
        "Leads: 1,000 net-new MQLs; CPL <$50; ROAS ≥ 3.0 on retargeting.",
        "Follower growth: +15% QoQ across priority channels.",
      ],
    },

    { type: "spacer", height: 12 },
    { type: "heading", level: 2, text: "Creative Territories" },
    {
      type: "bullets",
      items: [
        "Proof & Performance: Before/after, creator demo, side-by-side results.",
        "Community & Belonging: UGC spotlights, duet challenges, testimonials.",
        "Future-Ready: Trend-jacks with product POV, innovation hooks.",
      ],
    },

    { type: "spacer", height: 12 },
    { type: "heading", level: 2, text: "Sample Design Directives" },
    {
      type: "paragraph",
      text: "Use Levitate brand system: Primary #1A1A1A, Accent #FF6B35, Background #F5F5F5. Typography: Inter Bold for headings, Inter Regular for body. Prefer split-left stats with right visual for performance claims; center-aligned bold statements for creator testimonials.",
    },
    {
      type: "bullets",
      items: [
        "Layout: SPLIT_LEFT_RIGHT for data slides; GRID_3COL for channel mix; CENTERED for bold single-metric slides.",
        "Visuals: Use authentic creator imagery; minimal line icons; avoid stocky visuals.",
        "Placement: Stats left, proof right; CTA below fold with high-contrast accent button.",
      ],
    },

    { type: "spacer", height: 18 },
    { type: "heading", level: 2, text: "Next Steps" },
    {
      type: "numbered",
      items: [
        "Approve channel mix and budget allocations.",
        "Lock creator roster and shoot schedule for first two sprints.",
        "Ship first 10 hero assets and 6 variants for A/B by Jan 20.",
        "Enable full UTM + pixel setup before first paid flights.",
      ],
    },
    { type: "spacer", height: 24 },
    // Additional coverage for all formatting options in createFormattedDocument
    // { type: "horizontalRule" },
    {
      type: "link",
      text: "Google Docs API Reference",
      url: "https://developers.google.com/docs/api/reference/rest/v1/documents",
    },
    {
      type: "styled",
      text: "Styled emphasis: bold, italic, underline, strikethrough, custom colors, font, size, and link.",
      style: {
        bold: true,
        italic: true,
        underline: true,
        strikethrough: true,
        fontSize: 14,
        fontFamily: "Inter",
        foregroundColor: { red: 0.1, green: 0.1, blue: 0.1 },
        backgroundColor: { red: 0.96, green: 0.93, blue: 0.86 },
        link: "https://levitate.ng",
      },
    },
    {
      type: "paragraph",
      text: "Paragraph with alignment and indentation to validate paragraphStyle updates.",
      style: {
        alignment: "JUSTIFIED",
        indentStart: 18,
        indentEnd: 0,
        lineSpacing: 115,
      },
    },
    {
      type: "image",
      //   fileId: "1_QMmI4uJVrmOISru8027mE0hOaGuYI6O", // Not working for now - need to fix
      url: "https://upload.wikimedia.org/wikipedia/commons/thumb/b/b6/Image_created_with_a_mobile_phone.png/500px-Image_created_with_a_mobile_phone.png",
      width: 220,
      height: 60,
    },
    { type: "spacer", height: 12 },
  ];

  try {
    const doc = await googleIntegration.createFormattedDocument(title, blocks);

    assert(doc && doc.id, "Document creation failed (no id)");
    assert(doc.webViewLink, "Document missing webViewLink");

    console.log("\n✅ Formatted document created successfully.");
    console.log(`Document ID: ${doc.id}`);
    console.log(`View link : ${doc.webViewLink}`);
  } catch (error) {
    console.error("\n❌ createFormattedDocument test failed:", error);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error("Unexpected failure:", error);
  process.exit(1);
});
