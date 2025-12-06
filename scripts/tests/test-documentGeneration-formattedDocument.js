require("module-alias/register");
const assert = require("assert");
const { googleIntegration } = require("@/integrations/google");
const { BrandAssets } = require("@/constants");

/**
 * Comprehensive test for googleIntegration.createFormattedDocument
 * using EXACT functionalities and options as documentGeneration.js
 *
 * This test mirrors the convertBrandOriginToFormattedBlocks function
 * to ensure all block types and styles used in production work correctly.
 */
async function main() {
  console.log("Starting documentGeneration createFormattedDocument test...");

  // Mock project data (similar to what documentGeneration.js uses)
  const mockProject = {
    id: 1,
    name: "Brand Development Project - Test Client",
    client: {
      id: 1,
      name: "Test Client Company",
    },
  };

  // Mock brand origin document text that triggers all block types
  // This simulates what the LLM would generate
  const mockDocumentText = `I. WHO AM I?

This is a comprehensive brand identity section that defines the core essence of the brand. The brand represents innovation, quality, and customer-centric values.

Functional: Core product features and benefits
Sensory: Visual and tactile brand experiences
Emotional: The feelings and connections the brand creates

II. WHERE DO I COME FROM?

The brand's origin story begins with a vision to transform the industry. Founded in 2020, the company has grown from a small startup to a market leader.

Founders Perspective: The founding team's vision and values
Business Perspective: Strategic positioning and market approach

III. BRAND PURPOSE

The brand exists to empower customers and create meaningful impact in their lives.

Key Promise: Delivering exceptional value through innovation

IV. TARGET AUDIENCE

Primary audience consists of tech-savvy professionals aged 25-45 who value quality and innovation.

- Tech-forward millennials in urban centers
- Professionals seeking premium solutions
- Early adopters of new technology
- Value-conscious consumers who prioritize quality

V. BRAND VISION

To become the leading brand in our category by 2030, recognized for innovation and customer excellence.

1. Achieve market leadership position
2. Build strong customer loyalty
3. Expand into new markets
4. Maintain innovation leadership

VI. KEY INSIGHTS

Tone of Voice: Professional yet approachable, confident but not arrogant

Narrative Guidance: Tell stories that connect emotionally while demonstrating value

Visual: Clean, modern aesthetic with bold accents

Tone: Consistent, authentic, and engaging

VII. SINGLE-MINDED MESSAGE

The brand stands for **innovation that matters** and *customer-first excellence*.

VIII. POSITIONING

The brand positions itself as the premium choice for discerning customers.

Musts:
- Always maintain premium positioning
- Focus on customer value
- Emphasize innovation

Must Nots:
- Never compromise on quality
- Avoid generic messaging
- Don't oversell features

IX. BRAND VALUES

- Integrity: Always do the right thing
- Innovation: Continuously improve
- Excellence: Strive for the best
- Customer Focus: Put customers first

X. BRAND PERSONALITY

The brand personality is confident, innovative, and approachable.

1. Confident: Bold in vision and execution
2. Innovative: Always pushing boundaries
3. Approachable: Accessible to all customers
4. Reliable: Consistent and trustworthy

XI. BRAND VOICE

The brand voice is professional, clear, and engaging.

XII. DELIVERABLES

- Brand identity system
- Marketing materials
- Digital presence
- Content strategy

Next Steps

1. Review and approve this Brand Origins document
2. Confirm deliverables and timelines
3. Begin implementation phase`;

  // Convert to blocks exactly as documentGeneration.js does
  const blocks = [];

  // 1. Add logo at the top (exact format from documentGeneration.js line 449-454)
  blocks.push({
    type: "image",
    url: BrandAssets.LEVITATE_LOGO_URL,
    width: BrandAssets.LOGO_DIMENSIONS.WIDTH,
    height: BrandAssets.LOGO_DIMENSIONS.HEIGHT,
  });

  // 2. Add spacing after logo (line 457-460)
  blocks.push({
    type: "spacer",
    height: 24,
  });

  // 3. Add header table with client and document information (line 466-476)
  const clientName = mockProject?.client?.name || "Client Name";
  const projectName = mockProject?.name || "Brand Development Project";

  blocks.push({
    type: "table",
    rows: [
      [`Client: ${clientName}`, "Doc: Brand Origins / Creative Brief"],
      [`Project: ${projectName}`, "Task: Generate detailed brand document"],
    ],
    style: {
      borderWidth: 1,
      fontSize: 10,
    },
  });

  // 4. Add spacing after header table (line 479-482)
  blocks.push({
    type: "spacer",
    height: 24,
  });

  // 5. Parse document text and create formatted blocks (mimicking the parsing logic)
  const lines = mockDocumentText.split("\n");

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    if (!line) {
      // Empty line - add minimal spacing (line 493-496)
      blocks.push({
        type: "spacer",
        height: 6,
      });
      continue;
    }

    // Check for Roman numeral headings (I., II., III., etc.) - line 512-535
    const romanNumeralMatch = line.match(/^([IVX]+)\.\s*(.+)$/);
    if (romanNumeralMatch) {
      const [, numeral, title] = romanNumeralMatch;

      // Add extra spacing before new sections (line 519-522)
      if (blocks.length > 3) {
        blocks.push({
          type: "spacer",
          height: 18,
        });
      }

      // Heading with style (line 525-533)
      blocks.push({
        type: "heading",
        text: `${numeral}. ${title.toUpperCase()}`,
        level: 2,
        style: {
          bold: true,
          fontSize: 14,
        },
      });
      continue;
    }

    // Check for "Next Steps" heading (line 539-553)
    if (line.toLowerCase().includes("next steps")) {
      blocks.push({
        type: "spacer",
        height: 18,
      });
      blocks.push({
        type: "heading",
        text: "NEXT STEPS",
        level: 2,
        style: {
          bold: true,
          fontSize: 14,
        },
      });
      continue;
    }

    // Check for sub-headings or bold labels (line 557-613)
    if (line.includes(":") && line.length < 150) {
      const colonIndex = line.indexOf(":");
      const label = line.substring(0, colonIndex + 1);
      const content = line.substring(colonIndex + 1).trim();

      const commonLabels = [
        "functional",
        "sensory",
        "emotional",
        "founders",
        "business",
        "perspective",
        "key promise",
        "tone of voice",
        "narrative guidance",
        "musts",
        "must nots",
        "visual",
        "tone",
      ];

      const isLabel = commonLabels.some((labelText) =>
        label.toLowerCase().includes(labelText)
      );

      if (isLabel) {
        if (content) {
          // Label with content - styled with bold (line 586-592)
          blocks.push({
            type: "styled",
            text: `${label} ${content}`,
            style: {
              bold: true,
            },
          });
        } else {
          // Label only - styled with bold and fontSize (line 595-602)
          blocks.push({
            type: "styled",
            text: label,
            style: {
              bold: true,
              fontSize: 12,
            },
          });
        }
        continue;
      } else if (content) {
        // Regular line with colon but not a section label (line 607-611)
        blocks.push({
          type: "paragraph",
          text: line,
        });
        continue;
      }
    }

    // Check for bullet points (line 616-634)
    if (line.match(/^[-•*]\s+/)) {
      const bulletText = line.replace(/^[-•*]\s+/, "");

      const bulletItems = [bulletText];
      let j = i + 1;
      while (j < lines.length && lines[j].trim().match(/^[-•*]\s+/)) {
        bulletItems.push(lines[j].trim().replace(/^[-•*]\s+/, ""));
        j++;
      }

      blocks.push({
        type: "bullets",
        items: bulletItems,
      });

      i = j - 1;
      continue;
    }

    // Check for numbered lists (line 637-655)
    if (line.match(/^\d+\.\s+/)) {
      const numberedText = line.replace(/^\d+\.\s+/, "");

      const numberedItems = [numberedText];
      let j = i + 1;
      while (j < lines.length && lines[j].trim().match(/^\d+\.\s+/)) {
        numberedItems.push(lines[j].trim().replace(/^\d+\.\s+/, ""));
        j++;
      }

      blocks.push({
        type: "numbered",
        items: numberedItems,
      });

      i = j - 1;
      continue;
    }

    // Check for special formatting cues (markdown) - line 658-680
    if (line.includes("**") || line.includes("*")) {
      let formattedText = line;
      let isBold = false;
      let isItalic = false;

      if (line.includes("**")) {
        formattedText = formattedText.replace(/\*\*(.*?)\*\*/g, "$1");
        isBold = true;
      } else if (line.includes("*")) {
        formattedText = formattedText.replace(/\*(.*?)\*/g, "$1");
        isItalic = true;
      }

      // Styled with bold and/or italic (line 672-679)
      blocks.push({
        type: "styled",
        text: formattedText,
        style: {
          bold: isBold,
          italic: isItalic,
        },
      });
      continue;
    }

    // Regular paragraph (line 684-687)
    blocks.push({
      type: "paragraph",
      text: line,
    });
  }

  // Add final spacing (line 691-694)
  blocks.push({
    type: "spacer",
    height: 12,
  });

  // Additional tests for features used in other services
  // These are added at the bottom to test additional block types

  // Test: Heading level 3 (used in workplanDocumentBuilderService.js)
  blocks.push({
    type: "spacer",
    height: 24,
  });
  blocks.push({
    type: "heading",
    level: 3,
    text: "Additional Test Section - Level 3 Heading",
  });
  blocks.push({
    type: "paragraph",
    text: "This is a test of heading level 3 functionality.",
  });

  // Test: Image without dimensions (used in workplanDocumentBuilderService.js)
  blocks.push({
    type: "spacer",
    height: 18,
  });
  blocks.push({
    type: "heading",
    level: 3,
    text: "Image Without Dimensions Test",
  });
  blocks.push({
    type: "paragraph",
    text: "Testing image block with only URL (no width/height specified):",
  });
  blocks.push({
    type: "image",
    url: "https://upload.wikimedia.org/wikipedia/commons/thumb/b/b6/Image_created_with_a_mobile_phone.png/500px-Image_created_with_a_mobile_phone.png",
    // No width or height specified - testing default behavior
  });
  blocks.push({
    type: "spacer",
    height: 12,
  });

  // Test document title (matching documentGeneration.js format)
  const documentTitle = `Brand Origin - ${mockProject.client.name}`;

  // Options used in documentGeneration.js (line 1098-1102)
  // Note: folderId would be set from ensureDocumentsFolder() in production
  // For testing, we'll use null (root folder)
  const options = {
    folderId: null, // Would be set from ensureDocumentsFolder() in production
    makePublicReadable: false,
    shareWithEmails: [], // PM will be shared separately
  };

  console.log(`\n📋 Test Summary:`);
  console.log(`- Total blocks: ${blocks.length}`);
  console.log(`- Document title: ${documentTitle}`);
  console.log(`- Options: ${JSON.stringify(options, null, 2)}`);

  // Count block types
  const blockTypes = {};
  blocks.forEach((block) => {
    blockTypes[block.type] = (blockTypes[block.type] || 0) + 1;
  });
  console.log(`\n📊 Block type breakdown:`);
  Object.entries(blockTypes).forEach(([type, count]) => {
    console.log(`  - ${type}: ${count}`);
  });

  console.log(`\n🚀 Creating formatted document...`);

  try {
    const doc = await googleIntegration.createFormattedDocument(
      documentTitle,
      blocks,
      options
    );

    assert(doc && doc.id, "Document creation failed (no id)");
    assert(doc.webViewLink, "Document missing webViewLink");

    console.log("\n✅ Formatted document created successfully!");
    console.log(`📄 Document ID: ${doc.id}`);
    console.log(`🔗 View link: ${doc.webViewLink}`);
    console.log(
      `\n✨ All block types from documentGeneration.js tested successfully!`
    );

    // Verify all expected block types were included
    const expectedTypes = [
      "image",
      "spacer",
      "table",
      "heading",
      "styled",
      "paragraph",
      "bullets",
      "numbered",
    ];
    const foundTypes = Object.keys(blockTypes);
    const missingTypes = expectedTypes.filter(
      (type) => !foundTypes.includes(type)
    );

    if (missingTypes.length > 0) {
      console.warn(
        `\n⚠️  Warning: Some expected block types not found: ${missingTypes.join(
          ", "
        )}`
      );
    } else {
      console.log(`\n✅ All expected block types found in test!`);
    }
  } catch (error) {
    console.error("\n❌ createFormattedDocument test failed:", error);
    console.error("Error details:", {
      message: error.message,
      stack: error.stack,
      context: error.context,
    });
    process.exit(1);
  }
}

main().catch((error) => {
  console.error("Unexpected failure:", error);
  process.exit(1);
});
