const { openai } = require("@ai-sdk/openai");
const { anthropic } = require("@ai-sdk/anthropic");
const { generateObject, generateText, tool } = require("ai");
const { z } = require("zod");
const { appConfig } = require("@/config");
const { LLMError } = require("@/utils/errors");
const { createLogger, logLLMCall } = require("@/utils/logger");
const { generateUuid } = require("@/utils");

const logger = createLogger("llm:client");

// LLM Configuration
const LLM_MODELS = {
  // OpenAI models
  OPENAI_GPT4: "gpt-4-turbo-preview",
  OPENAI_GPT35: "gpt-3.5-turbo",
  OPENAI_GPT4O: "gpt-4o",

  // Anthropic models (if available)
  ANTHROPIC_CLAUDE: "claude-3-sonnet-20240229",
  ANTHROPIC_CLAUDE_HAIKU: "claude-3-haiku-20240307",
};

// Model routing based on task complexity and cost
const getModelForTask = (taskType) => {
  switch (taskType) {
    case "classification":
    case "extraction":
      // Use smaller, faster models for simple tasks
      return { provider: "openai", model: LLM_MODELS.OPENAI_GPT35 };

    case "generation":
      // Use balanced model for content generation
      return { provider: "openai", model: LLM_MODELS.OPENAI_GPT4O };

    case "planning":
      // Use most capable model for complex reasoning
      return { provider: "openai", model: LLM_MODELS.OPENAI_GPT4 };

    default:
      return { provider: "openai", model: LLM_MODELS.OPENAI_GPT4O };
  }
};

// LLM Client class
class LLMClient {
  getProvider(provider) {
    switch (provider) {
      case "openai":
        return openai(appConfig.llm.openaiApiKey);
      case "anthropic":
        if (!appConfig.llm.anthropicApiKey) {
          throw new LLMError(
            "anthropic",
            "initialization",
            new Error("Anthropic API key not configured")
          );
        }
        return anthropic(appConfig.llm.anthropicApiKey);
      default:
        throw new LLMError(
          "unknown",
          "initialization",
          new Error(`Unknown provider: ${provider}`)
        );
    }
  }

  // Generate structured data using schema validation
  async generateStructured(schema, prompt, context, taskType = "extraction") {
    const traceId = generateUuid();
    const startTime = Date.now();
    const { provider, model } = getModelForTask(taskType);

    try {
      const llmProvider = this.getProvider(provider);

      const systemPrompt = this.buildSystemPrompt(taskType, context);

      const result = await generateObject({
        model: llmProvider(model),
        schema,
        system: systemPrompt,
        prompt,
        temperature: taskType === "generation" ? 0.7 : 0.1, // Higher temperature for creative tasks
      });

      const duration = Date.now() - startTime;

      logLLMCall(
        logger,
        `${provider}:${model}`,
        traceId,
        result.usage?.totalTokens,
        undefined
      );

      logger.info(
        {
          traceId,
          model: `${provider}:${model}`,
          taskType,
          duration,
          promptLength: prompt.length,
          success: true,
          usage: result.usage,
        },
        "LLM structured generation completed"
      );

      return {
        data: result.object,
        traceId,
        tokenUsage: result.usage
          ? {
              promptTokens: result.usage.promptTokens,
              completionTokens: result.usage.completionTokens,
              totalTokens: result.usage.totalTokens,
            }
          : undefined,
      };
    } catch (error) {
      const duration = Date.now() - startTime;
      logger.error(
        {
          traceId,
          model: `${provider}:${model}`,
          taskType,
          duration,
          error: error.message,
        },
        "LLM structured generation failed"
      );

      throw new LLMError(`${provider}:${model}`, "generateStructured", error, {
        traceId,
        taskType,
        promptLength: prompt.length,
      });
    }
  }

  // Generate free-form text
  async generateText(
    prompt,
    context,
    taskType = "generation",
    maxTokens = 2000
  ) {
    const traceId = generateUuid();
    const startTime = Date.now();
    const { provider, model } = getModelForTask(taskType);

    try {
      const llmProvider = this.getProvider(provider);

      const systemPrompt = this.buildSystemPrompt(taskType, context);

      const result = await generateText({
        model: llmProvider(model),
        system: systemPrompt,
        prompt,
        temperature: taskType === "generation" ? 0.7 : 0.1,
        maxTokens,
      });

      const duration = Date.now() - startTime;

      logLLMCall(
        logger,
        `${provider}:${model}`,
        traceId,
        result.usage?.totalTokens,
        undefined
      );

      logger.info(
        {
          traceId,
          model: `${provider}:${model}`,
          taskType,
          duration,
          promptLength: prompt.length,
          responseLength: result.text.length,
          success: true,
          usage: result.usage,
        },
        "LLM text generation completed"
      );

      return {
        text: result.text,
        traceId,
        tokenUsage: result.usage
          ? {
              promptTokens: result.usage.promptTokens,
              completionTokens: result.usage.completionTokens,
              totalTokens: result.usage.totalTokens,
            }
          : undefined,
      };
    } catch (error) {
      const duration = Date.now() - startTime;
      logger.error(
        {
          traceId,
          model: `${provider}:${model}`,
          taskType,
          duration,
          error: error.message,
        },
        "LLM text generation failed"
      );

      throw new LLMError(`${provider}:${model}`, "generateText", error, {
        traceId,
        taskType,
        promptLength: prompt.length,
      });
    }
  }

  // Generate with tool calling capabilities
  async generateWithTools(prompt, tools, context, maxSteps = 5) {
    const traceId = generateUuid();
    const startTime = Date.now();
    const { provider, model } = getModelForTask("planning");

    try {
      const llmProvider = this.getProvider(provider);

      const systemPrompt = this.buildSystemPromptForTools(context);

      // TODO: Implement tool calling with AI SDK
      // This is a placeholder - actual implementation would use the AI SDK's tool calling features

      const duration = Date.now() - startTime;

      logger.info(
        {
          traceId,
          model: `${provider}:${model}`,
          duration,
          promptLength: prompt.length,
          toolCount: Object.keys(tools).length,
          success: true,
        },
        "LLM tool generation completed"
      );

      return {
        result: {}, // Placeholder
        traceId,
        steps: [],
        tokenUsage: undefined,
      };
    } catch (error) {
      const duration = Date.now() - startTime;
      logger.error(
        {
          traceId,
          model: `${provider}:${model}`,
          duration,
          error: error.message,
        },
        "LLM tool generation failed"
      );

      throw new LLMError(`${provider}:${model}`, "generateWithTools", error, {
        traceId,
        promptLength: prompt.length,
      });
    }
  }

  // Build system prompt based on task type
  buildSystemPrompt(taskType, context) {
    const basePrompt = `You are an AI assistant for Levitate Studios, a creative agency that provides services including logo design, web design, packaging design, motion graphics, and advertising.

Current date: ${new Date().toISOString().split("T")[0]}

Context: ${
      context
        ? JSON.stringify(context, null, 2)
        : "No additional context provided"
    }`;

    switch (taskType) {
      case "classification":
        return `${basePrompt}

Your task is to classify and categorize information accurately. Be precise and consistent in your classifications. Always follow the provided schema exactly.`;

      case "extraction":
        return `${basePrompt}

Your task is to extract specific information from the provided text. Be accurate and complete in your extraction. If information is not available, use null or appropriate default values as specified in the schema.`;

      case "generation":
        return `${basePrompt}

Your task is to generate creative, professional content for client projects. Consider the client's brand, target audience, and project requirements. Be creative while maintaining professionalism and brand consistency.`;

      case "planning":
        return `${basePrompt}

Your task is to analyze complex situations and create detailed plans. Break down complex tasks into manageable steps, consider dependencies, and provide clear reasoning for your decisions.`;

      default:
        return basePrompt;
    }
  }

  // Build system prompt for tool calling
  buildSystemPromptForTools(context) {
    return `You are an AI assistant for Levitate Studios with access to various tools and integrations.

You can perform the following actions:
- Read and create documents
- Send emails and notifications
- Interact with Asana for project management
- Access project and client data
- Update project status and phases

Current context: ${
      context
        ? JSON.stringify(context, null, 2)
        : "No additional context provided"
    }

Use the available tools to complete the requested task efficiently. Always explain your reasoning and next steps.`;
  }
}

// Create and export singleton instance
const llmClient = new LLMClient();

module.exports = {
  LLM_MODELS,
  getModelForTask,
  LLMClient,
  llmClient,
};
