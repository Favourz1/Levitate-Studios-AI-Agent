const { createOpenAI } = require("@ai-sdk/openai");
const { createAnthropic } = require("@ai-sdk/anthropic");
const { createGroq } = require("@ai-sdk/groq");
const { generateObject, generateText } = require("ai");
const { appConfig } = require("@/config");
const { LLMError } = require("@/utils/errors");
const { createLogger, logLLMCall } = require("@/utils/logger");
const { generateUuid } = require("@/utils");

const logger = createLogger("llm:client");

// LLM Configuration
const LLM_MODELS = {
  // OpenAI models - Only models that support structured output
  OPENAI_GPT4O: "gpt-4o",
  OPENAI_GPT4_TURBO: "gpt-4-turbo-preview",
  OPENAI_GPT35_TURBO: "gpt-3.5-turbo",
  OPENAI_GPT4O_MINI: "gpt-4o-mini", // Supports structured output
  OPENAI_GPT4_TURBO_2024: "gpt-4-turbo-2024-04-09", // Supports structured output

  // Anthropic models
  ANTHROPIC_CLAUDE: "claude-3-sonnet-20240229",
  ANTHROPIC_CLAUDE_HAIKU: "claude-3-haiku-20240307",

  // Groq models
  GROQ_LLAMA3_70B: "llama3-70b-8192",
  GROQ_GEMMA2_9B: "gemma2-9b-it",
  GROQ_OPENAI_120B: "openai/gpt-oss-120b",
  GROQ_OPENAI_20B: "openai/gpt-oss-20b",
};

// Model routing based on task complexity and cost
// Note: Only use models that support structured output for generateObject calls
const getModelForTask = (taskType) => {
  switch (taskType) {
    case "classification":
    case "extraction":
      // Use gpt-4o-mini for structured tasks (supports object generation)
      return { provider: "openai", model: LLM_MODELS.OPENAI_GPT4O };

    case "generation":
      // Use gpt-4-turbo for content generation
      return { provider: "openai", model: LLM_MODELS.OPENAI_GPT4O };
    // return { provider: "openai", model: LLM_MODELS.OPENAI_GPT4_TURBO };

    case "planning":
      // Use gpt-4o-mini for planning with structured output
      return { provider: "openai", model: LLM_MODELS.OPENAI_GPT4O };

    default:
      return { provider: "openai", model: LLM_MODELS.OPENAI_GPT4O };
  }
};

// LLM Client class
class LLMClient {
  getProvider(provider) {
    switch (provider) {
      case "openai":
        if (!appConfig.llm.openaiApiKey) {
          throw new LLMError(
            "openai",
            "initialization",
            new Error("OpenAI API key not configured")
          );
        }
        return createOpenAI({
          apiKey: appConfig.llm.openaiApiKey,
        });
      case "anthropic":
        if (!appConfig.llm.anthropicApiKey) {
          throw new LLMError(
            "anthropic",
            "initialization",
            new Error("Anthropic API key not configured")
          );
        }
        return createAnthropic({
          apiKey: appConfig.llm.anthropicApiKey,
        });
      case "groq":
        if (!appConfig.llm.groqApiKey) {
          throw new LLMError(
            "groq",
            "initialization",
            new Error("Groq API key not configured")
          );
        }
        return createGroq({
          apiKey: appConfig.llm.groqApiKey,
        });
      default:
        throw new LLMError(
          "unknown",
          "initialization",
          new Error(`Unknown provider: ${provider}`)
        );
    }
  }

  // Generate structured data using schema validation
  // schema parameter should be a z.ZodSchema
  async generateStructured(schema, prompt, context, taskType = "extraction") {
    const traceId = generateUuid();
    const startTime = Date.now();
    const { provider, model } = getModelForTask(taskType);

    try {
      const llmProvider = this.getProvider(provider);
      const systemPrompt = this.buildSystemPrompt(taskType, context);

      // First, try with the preferred model
      try {
        const result = await generateObject({
          model: llmProvider(model),
          mode: "json",
          schema,
          system: systemPrompt,
          prompt,
          // output: "no-schema",
          temperature: taskType === "generation" ? 0.7 : 0.1,
        });

        logger.debug(
          {
            traceId,
            provider,
            model,
            hasResult: !!result?.object,
          },
          "LLM generateObject result received"
        );

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
      } catch (modelError) {
        // If the model doesn't support object generation, try fallback approach
        if (
          modelError.message &&
          modelError.message.includes("object generation mode")
        ) {
          logger.warn(
            {
              traceId,
              model: `${provider}:${model}`,
              error: modelError.message,
            },
            "Model doesn't support object generation, trying fallback model"
          );

          // Fallback to gpt-4o-mini which supports structured output
          const fallbackModel = LLM_MODELS.OPENAI_GPT4O_MINI;
          const fallbackResult = await generateObject({
            model: llmProvider(fallbackModel),
            mode: "json",
            schema,
            system: systemPrompt,
            prompt,
            // output: "no-schema",
            temperature: taskType === "generation" ? 0.7 : 0.1,
          });

          logger.debug(
            {
              traceId,
              provider,
              fallbackModel,
              hasResult: !!fallbackResult?.object,
            },
            "LLM fallback generateObject result received"
          );

          const duration = Date.now() - startTime;

          logLLMCall(
            logger,
            `${provider}:${fallbackModel}`,
            traceId,
            fallbackResult.usage?.totalTokens,
            undefined
          );

          logger.info(
            {
              traceId,
              model: `${provider}:${fallbackModel}`,
              taskType,
              duration,
              promptLength: prompt.length,
              success: true,
              fallback: true,
              usage: fallbackResult.usage,
            },
            "LLM structured generation completed with fallback model"
          );

          return {
            data: fallbackResult.object,
            traceId,
            tokenUsage: fallbackResult.usage
              ? {
                  promptTokens: fallbackResult.usage.promptTokens,
                  completionTokens: fallbackResult.usage.completionTokens,
                  totalTokens: fallbackResult.usage.totalTokens,
                }
              : undefined,
          };
        }
        throw modelError;
      }
    } catch (error) {
      const duration = Date.now() - startTime;
      logger.error(
        {
          traceId,
          model: `${provider}:${model}`,
          taskType,
          duration,
          error: error.message,
          originalError: error.message,
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
    maxTokens = 3000
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
  async generateWithTools(prompt, tools, context) {
    const traceId = generateUuid();
    const startTime = Date.now();
    const { provider, model } = getModelForTask("planning");

    try {
      // TODO: Implement tool calling with AI SDK
      // This is a placeholder - actual implementation would use the AI SDK's tool calling features
      // eslint-disable-next-line no-unused-vars
      const llmProvider = this.getProvider(provider);
      // eslint-disable-next-line no-unused-vars
      const systemPrompt = this.buildSystemPromptForTools(context);

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
    const basePrompt = `You are an AI assistant for Levitate Studios, a creative agency that provides services including logo design, web design, packaging design, motion graphics, and advertising etc.

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
