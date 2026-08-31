/**
 * Tool definitions for the MCP server
 */
/**
 * Create tool definitions for the given provider and timeout.
 * Only exposes parameters relevant to the active provider.
 */
export function createTools(provider, defaultTimeout) {
    const providerLabel = provider === "openai" ? "OpenAI" : "Gemini";
    const imageDesc = "An image to edit. Preferred: a public https:// URL of the image — this is the only reliable way to send a large image to a remote server. " +
        "Also accepted: a base64-encoded string (optionally as a data URL like data:image/png;base64,...), or an absolute file path " +
        "(/path/to/image.png), which only works when the server runs on the same machine as the caller. " +
        "Supported formats: PNG, JPEG, WebP.";
    const imagesNote = provider === "openai"
        ? " Multiple images are supported for multi-image editing."
        : " Multiple images are supported for multi-image editing.";
    // ── Shared properties ────────────────────────────────────────────────────
    const promptProp = {
        prompt: {
            type: "string",
            description: "Detailed text description of the image to generate. " +
                "More specific prompts produce better results. " +
                "Example: 'A photorealistic red apple on a white marble table, soft studio lighting, 4K'.",
        },
    };
    const imagesProp = {
        images: {
            type: "array",
            description: "One or more images to edit. Each item should be a public https:// URL; a base64 string or an absolute " +
                "file path (local servers only) also work." +
                imagesNote,
            items: {
                type: "string",
                description: imageDesc,
            },
        },
    };
    const editPromptProp = {
        prompt: {
            type: "string",
            description: "A text description of the desired edit. Max 32000 characters. " +
                "Examples: 'Add a rainbow in the sky', 'Remove the person from the image', 'Change the background to a beach'.",
        },
    };
    const timeoutProp = (desc) => ({
        timeout: {
            type: "number",
            description: desc +
                ` Defaults to ${defaultTimeout} s. Increase this if the request times out.`,
        },
    });
    // ── OpenAI-specific properties ──────────────────────────────────────────
    const openaiSizeProp = {
        size: {
            type: "string",
            description: "Output image dimensions. " +
                "gpt-image-*: 'auto' (default), '1024x1024', '1536x1024' (landscape), '1024x1536' (portrait). " +
                "dall-e-3: '1024x1024', '1792x1024' (landscape), '1024x1792' (portrait). " +
                "dall-e-2: '256x256', '512x512', '1024x1024'.",
        },
    };
    const openaiQualityProp = {
        quality: {
            type: "string",
            description: "Image quality level. " +
                "gpt-image-*: 'high' (best, slowest), 'medium', 'low', 'standard' (default). " +
                "dall-e-3: 'hd' (enhanced detail) or 'standard' (default). " +
                "Ignored for dall-e-2.",
            enum: ["standard", "hd", "high", "medium", "low"],
        },
    };
    const openaiNProp = {
        n: {
            type: "number",
            description: "Number of images to generate. gpt-image-*: 1–10. dall-e-2: 1–10. dall-e-3: must be 1. Defaults to 1.",
        },
    };
    const maskProp = {
        mask: {
            type: "string",
            description: "Optional mask image for inpainting. Can be an absolute file path or base64-encoded string. " +
                "Must be a PNG image with the same dimensions as the input image. " +
                "Fully transparent areas indicate where the edit should be applied.",
        },
    };
    // ── Gemini-specific properties ──────────────────────────────────────────
    const geminiAspectRatioProp = {
        aspect_ratio: {
            type: "string",
            description: "Aspect ratio of the generated image. " +
                "Options: '1:1' (square, default), '3:4' (portrait), '4:3' (landscape), '9:16' (tall), '16:9' (wide).",
            enum: ["1:1", "3:4", "4:3", "9:16", "16:9"],
        },
    };
    // ── generate_image ──────────────────────────────────────────────────────
    const generateProperties = {
        ...promptProp,
        ...(provider === "openai" ? openaiSizeProp : geminiAspectRatioProp),
        ...(provider === "openai" ? openaiQualityProp : {}),
        ...(provider === "openai" ? openaiNProp : {}),
        ...timeoutProp("Maximum time in seconds to wait for the image generation API to respond. The tool returns an error if the provider does not respond within this limit."),
    };
    const GENERATE_IMAGE_TOOL = {
        name: "generate_image",
        description: `Generate an image from a text prompt using ${providerLabel}. ` +
            "Returns MCP ImageContent blocks (base64 PNG/JPEG). " +
            "Image generation can be slow — increase the timeout parameter if the request times out.",
        inputSchema: {
            type: "object",
            properties: generateProperties,
            required: ["prompt"],
        },
    };
    // ── edit_image ──────────────────────────────────────────────────────────
    const editProperties = {
        ...imagesProp,
        ...editPromptProp,
        ...(provider === "openai" ? maskProp : {}),
        ...(provider === "openai" ? openaiSizeProp : geminiAspectRatioProp),
        ...(provider === "openai" ? openaiQualityProp : {}),
        ...(provider === "openai" ? openaiNProp : {}),
        ...timeoutProp("Maximum time in seconds to wait for the API to respond."),
    };
    const EDIT_IMAGE_TOOL = {
        name: "edit_image",
        description: `Edit one or more images using ${providerLabel} and a text prompt. ` +
            (provider === "openai"
                ? "Optionally provide a mask image for inpainting (specify areas to edit). "
                : "") +
            "Returns MCP ImageContent blocks (base64 PNG/JPEG).",
        inputSchema: {
            type: "object",
            properties: editProperties,
            required: ["images", "prompt"],
        },
    };
    return [GENERATE_IMAGE_TOOL, EDIT_IMAGE_TOOL];
}
/**
 * Upload an image once and reuse the returned URL.
 * Only advertised when the deployment has somewhere to store the bytes.
 */
export const UPLOAD_IMAGE_TOOL = {
    name: "upload_image",
    description: "Upload an image to this server and get back a public https:// URL. " +
        "Use this FIRST when you have an image to edit: pass the base64 once here, then hand the returned URL " +
        "to edit_image or submit_task — including across several edits of the same photo. " +
        "This server runs remotely and cannot read files on your machine, so a file path never works; " +
        "inlining a large base64 string in every call is unreliable because it gets truncated in transit.",
    inputSchema: {
        type: "object",
        properties: {
            image: {
                type: "string",
                description: "The image as a base64-encoded string, or a data URL (data:image/png;base64,...). " +
                    "Keep it small — resize or re-encode to JPEG first if the original is several megabytes.",
            },
            mime_type: {
                type: "string",
                description: "Image type, when it cannot be read from a data URL. One of: image/png, image/jpeg, image/webp, image/gif. Defaults to image/png.",
                enum: ["image/png", "image/jpeg", "image/webp", "image/gif"],
            },
        },
        required: ["image"],
    },
};
/**
 * Submit an image generation or editing task.
 * Returns immediately with a task_id. Use get_task to poll for results.
 */
export const SUBMIT_TASK_TOOL = {
    name: "submit_task",
    description: "Submit an image generation or editing task to be processed in the background. " +
        "Returns immediately with a task_id. Use get_task to check status and retrieve results. " +
        "Supports both text-to-image generation and image editing.",
    inputSchema: {
        type: "object",
        properties: {
            kind: {
                type: "string",
                description: "Type of task: 'generate' for text-to-image, 'edit' for image editing.",
                enum: ["generate", "edit"],
            },
            prompt: {
                type: "string",
                description: "Text prompt describing the image to generate or the desired edit. " +
                    "For edits: 'Add a rainbow', 'Remove the person', etc.",
            },
            images: {
                type: "array",
                description: "Required for 'edit' tasks. One or more input images. " +
                    "Each should be a public https:// URL; a base64 string or an absolute file path (local servers only) also work.",
                items: {
                    type: "string",
                    description: "Image URL, base64-encoded image, or file path.",
                },
            },
        },
        required: ["kind", "prompt"],
    },
};
/**
 * Get the status and result of a submitted task.
 * Returns processing status, or completed images as MCP ImageContent.
 */
export const GET_TASK_TOOL = {
    name: "get_task",
    description: "Check the status of a submitted task. " +
        "If still processing, returns status 'pending' or 'processing'. " +
        "If completed, returns status 'completed' with the generated images as MCP ImageContent blocks. " +
        "If failed, returns an error message.",
    inputSchema: {
        type: "object",
        properties: {
            task_id: {
                type: "string",
                description: "The task_id returned by submit_task.",
            },
        },
        required: ["task_id"],
    },
};
/**
 * Static tools for tests (OpenAI provider, 300s timeout).
 */
export const TOOLS = createTools("openai", 300);
// Full tool list including async tools
export const ALL_TOOLS = [SUBMIT_TASK_TOOL, GET_TASK_TOOL, ...createTools("openai", 300)];
/**
 * Get tool by name
 */
export function getToolByName(name) {
    return TOOLS.find(tool => tool.name === name);
}
/**
 * Check if a tool name is valid
 */
export function isValidToolName(name) {
    return TOOLS.some(tool => tool.name === name);
}
//# sourceMappingURL=tools.js.map