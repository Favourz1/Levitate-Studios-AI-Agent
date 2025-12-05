require("module-alias/register");
const { imageSearchTool, iconSearchTool } = require("@/llm/tools/designTools");

const logSample = (label, results) => {
  console.log(`\n${label}: ${results.length} result(s)`);
  if (results[0]) {
    console.log(JSON.stringify(results[0], null, 2));
  }
};

async function main() {
  const query = process.argv[2] || "electric vehicle";

  console.log(`Running design tools smoke test with query: "${query}"`);

  try {
    const images = await imageSearchTool.execute({
      query,
      imageType: "PHOTO",
      style: "professional",
    });
    logSample("Pexels image search", images);
  } catch (error) {
    console.error("Image search failed:", error.message);
    process.exit(1);
  }

  try {
    const icons = await iconSearchTool.execute({
      query,
      imageType: "ICON",
      style: "professional",
    });
    logSample("Noun Project icon search", icons);
  } catch (error) {
    console.error("Icon search failed:", error.message);
    process.exit(1);
  }

  console.log("\nDesign tools smoke test completed successfully.");
}

main().catch((error) => {
  console.error("Unexpected failure:", error);
  process.exit(1);
});
