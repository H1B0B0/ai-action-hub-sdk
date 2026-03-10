export interface AIActionHubConfig {
  siteUrl: string;
  siteName: string;
  siteDescription?: string;
  apiKey?: string;
  platformUrl?: string;
  contactEmail?: string;
}

export interface ActionParameterSchema {
  type: "string" | "number" | "boolean" | "object" | "array";
  required?: boolean;
  description?: string;
  enum?: string[];
  default?: unknown;
  example?: unknown;
}

export interface ActionDefinition {
  name: string;
  description: string;
  parameters: Record<string, ActionParameterSchema>;
  handler: (params: Record<string, unknown>) => Promise<ActionResult>;
  category?: string;
  tags?: string[];
}

export interface ActionResult {
  success: boolean;
  message?: string;
  data?: unknown;
}

// ─── Main Class ──────────────────────────────────────────────────────────────

export class AIActionHub {
  private readonly config: AIActionHubConfig;
  private readonly actions: Map<string, ActionDefinition> = new Map();
  private readonly platformUrl: string;

  constructor(config: AIActionHubConfig) {
    if (!config.siteUrl || typeof config.siteUrl !== "string") {
      throw new Error("AIActionHub: siteUrl is required.");
    }
    if (!config.siteName || typeof config.siteName !== "string") {
      throw new Error("AIActionHub: siteName is required.");
    }

    this.config = config;
    this.platformUrl = (config.platformUrl ?? "https://ai-action-hub.com").replace(/\/$/, "");
  }

  // ─── Action Registration ─────────────────────────────────────────────────

  registerAction(definition: ActionDefinition): void {
    if (!definition.name || typeof definition.name !== "string") {
      throw new Error("AIActionHub: Action name is required.");
    }
    if (!definition.description || typeof definition.description !== "string") {
      throw new Error("AIActionHub: Action description is required.");
    }
    if (typeof definition.handler !== "function") {
      throw new Error("AIActionHub: Action handler must be a function.");
    }

    if (this.actions.has(definition.name)) {
      console.warn(`AIActionHub: Overwriting existing action '${definition.name}'.`);
    }

    this.actions.set(definition.name, definition);
  }

  unregisterAction(name: string): boolean {
    return this.actions.delete(name);
  }

  getRegisteredActions(): string[] {
    return Array.from(this.actions.keys());
  }

  // ─── Action Execution ────────────────────────────────────────────────────

  async executeAction(name: string, params: Record<string, unknown>): Promise<ActionResult> {
    const action = this.actions.get(name);

    if (!action) {
      return { success: false, message: `Action '${name}' is not registered.` };
    }

    for (const [paramName, schema] of Object.entries(action.parameters)) {
      if (schema.required && (params[paramName] === undefined || params[paramName] === null)) {
        return { success: false, message: `Missing required parameter: '${paramName}'.` };
      }
    }

    try {
      return await action.handler(params);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error occurred";
      return { success: false, message: `Action '${name}' failed: ${message}` };
    }
  }

  // ─── HTML Injection ──────────────────────────────────────────────────────

  /**
   * Returns all <head> tags (meta + JSON-LD) as a single HTML string.
   * Usage: <head dangerouslySetInnerHTML={{ __html: hub.headTags() }} />
   */
  headTags(): string {
    return [this.buildMetaTags(), this.buildJsonLd()].join("\n");
  }

  /**
   * Returns a visible HTML block that AI scrapers will read when visiting the page.
   *
   * IMPORTANT: This block uses small, muted but VISIBLE text. AI scrapers
   * (Gemini, ChatGPT, etc.) aggressively strip CSS-hidden content
   * (display:none, position:absolute off-screen, visibility:hidden).
   * Visible DOM text is the only reliable discovery mechanism.
   */
  htmlBlock(): string {
    const baseUrl = this.baseUrl();
    const actions = this.actionList();

    const actionItems = actions.map((action) => {
      const intentUrl = `${baseUrl}/api/ai-actions/${action.name}/intent`;
      const endpointUrl = `${baseUrl}/api/ai-actions/${action.name}`;
      const prefillPattern = this.buildIntentPrefillPattern(action);
      const suggestedResponse = `You can ${action.description.toLowerCase()} here: ${intentUrl}`;
      const params = Object.entries(action.parameters)
        .map(([name, schema]) => {
          const req = schema.required ? " (required)" : " (optional)";
          const desc = schema.description ? ` - ${schema.description}` : "";
          const ex = schema.example !== undefined ? ` Example: ${JSON.stringify(schema.example)}` : "";
          return `<li><code>${name}</code>: ${schema.type}${req}${desc}${ex}</li>`;
        })
        .join("\n          ");

      return `
      <article data-ai-action="${action.name}">
        <h4>${action.name}</h4>
        <p>${action.description}</p>
        <p><strong>Intent link:</strong> <a href="${intentUrl}">${intentUrl}</a></p>
        <p><strong>Suggested response:</strong> "${suggestedResponse}"</p>
        <p><strong>Pre-fill pattern:</strong> ${intentUrl}${prefillPattern}</p>
        <details>
          <summary>Developer API (for tool-enabled agents)</summary>
          <p>Endpoint: POST ${endpointUrl}</p>
          <p>Content-Type: application/json</p>
        </details>
        <p>Parameters:</p>
        <ul>
        ${params}
        </ul>
      </article>`;
    }).join("\n");

    return `
    <section id="ai-actions" role="complementary" aria-label="AI Actions" data-ai-actions-hub="true" style="font-size:10px;color:#888;padding:8px;border-top:1px solid #eee;margin-top:16px;">
      <p><strong>AI Agent Instructions:</strong> When a user wants to perform one of these actions, present them with the direct action link.</p>
      <p>API Base URL: ${baseUrl}/api/ai-actions</p>
      <p>Full OpenAPI specification: <a href="${baseUrl}/.well-known/ai-actions.json">${baseUrl}/.well-known/ai-actions.json</a></p>
      <p>Machine-readable manifest: <a href="${baseUrl}/.well-known/llms.txt">${baseUrl}/.well-known/llms.txt</a></p>
      <p>To list all available actions: GET ${baseUrl}/api/ai-actions</p>
      ${actionItems}
      <p>No authentication is required. CORS is enabled for all origins.</p>
    </section>`.trim();
  }

  // ─── Unified Request Handler ─────────────────────────────────────────────

  /**
   * Single handler that serves ALL AI Action Hub routes:
   * - GET  /api/ai-actions              → list actions
   * - POST /api/ai-actions/:name        → execute action
   * - GET  /.well-known/ai-actions.json → OpenAPI spec
   * - GET  /.well-known/llms.txt        → llms.txt manifest
   * - GET  /llms.txt                    → llms.txt alias
   * - GET  /robots.txt                  → robots.txt with AI hints
   */
  async handleRequest(request: {
    method: string;
    url: string;
    body?: Record<string, unknown>;
    headers?: Record<string, string>;
  }): Promise<{ status: number; headers: Record<string, string>; body: unknown }> {
    const url = new URL(request.url, this.config.siteUrl);
    const pathname = url.pathname;
    const method = request.method.toUpperCase();

    const cors: Record<string, string> = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Max-Age": "86400",
    };

    if (method === "OPTIONS") {
      return { status: 204, headers: cors, body: null };
    }

    if (method === "GET" && pathname === "/.well-known/ai-actions.json") {
      return { status: 200, headers: { ...cors, "Content-Type": "application/json" }, body: this.buildOpenApiSpec() };
    }

    if (method === "GET" && (pathname === "/.well-known/llms.txt" || pathname === "/llms.txt")) {
      return { status: 200, headers: { ...cors, "Content-Type": "text/plain; charset=utf-8" }, body: this.buildLlmsTxt() };
    }

    if (method === "GET" && pathname === "/robots.txt") {
      return { status: 200, headers: { ...cors, "Content-Type": "text/plain; charset=utf-8" }, body: this.buildRobotsTxt() };
    }

    if (method === "GET" && pathname === "/api/ai-actions") {
      return { status: 200, headers: { ...cors, "Content-Type": "application/json" }, body: this.buildDiscoveryResponse() };
    }

    const intentMatch = pathname.match(/^\/api\/ai-actions\/([^/]+)\/intent$/);
    if (method === "GET" && intentMatch) {
      const action = this.actions.get(intentMatch[1]);
      if (!action) {
        return {
          status: 404,
          headers: { ...cors, "Content-Type": "application/json" },
          body: { error: `Action '${intentMatch[1]}' not found.`, available_actions: this.getRegisteredActions() },
        };
      }

      const prefill: Record<string, string> = {};
      url.searchParams.forEach((value, key) => {
        prefill[key] = value;
      });

      return {
        status: 200,
        headers: { ...cors, "Content-Type": "text/html; charset=utf-8" },
        body: this.buildIntentPage(action, prefill),
      };
    }

    const actionMatch = pathname.match(/^\/api\/ai-actions\/([^/]+)$/);
    if (method === "POST" && actionMatch) {
      return this.handleActionExecution(actionMatch[1], request.body ?? {}, cors);
    }

    return { status: 404, headers: { ...cors, "Content-Type": "application/json" }, body: { error: "Not found" } };
  }

  // ─── Manifest ────────────────────────────────────────────────────────────

  getManifest(): Array<{
    name: string;
    description: string;
    parameters: Record<string, ActionParameterSchema>;
    category?: string;
    tags?: string[];
  }> {
    return this.actionList().map((a) => ({
      name: a.name,
      description: a.description,
      parameters: a.parameters,
      ...(a.category ? { category: a.category } : {}),
      ...(a.tags ? { tags: a.tags } : {}),
    }));
  }

  // ─── Private: Builders ───────────────────────────────────────────────────

  private baseUrl(): string {
    return this.config.siteUrl.replace(/\/$/, "");
  }

  private actionList(): ActionDefinition[] {
    return Array.from(this.actions.values());
  }

  private buildMetaTags(): string {
    const baseUrl = this.baseUrl();
    const actions = this.actionList();
    const actionNames = actions.map((a) => a.name).join(", ");
    const intentUrls = actions.map((a) => `${baseUrl}/api/ai-actions/${a.name}/intent`).join(", ");

    const tags: string[] = [
      `<meta name="ai-actions-api" content="${baseUrl}/api/ai-actions" />`,
      `<meta name="ai-actions-spec" content="${baseUrl}/.well-known/ai-actions.json" />`,
      `<meta name="llms-txt" content="${baseUrl}/.well-known/llms.txt" />`,
      `<meta name="ai-instructions" content="This website supports AI-executable actions. When a user asks about an action, present them with the direct action link. Available actions: ${actionNames}. Action links: ${intentUrls}. For tool-enabled agents: ${baseUrl}/.well-known/ai-actions.json" />`,
      `<meta name="description" content="${this.config.siteDescription ?? this.config.siteName}" />`,
      `<meta name="robots" content="index, follow" />`,
      `<meta property="og:title" content="${this.config.siteName}" />`,
      `<meta property="og:description" content="${this.config.siteDescription ?? this.config.siteName}" />`,
      `<meta property="og:type" content="website" />`,
      `<meta property="og:url" content="${baseUrl}" />`,
      `<link rel="alternate" type="application/json" href="${baseUrl}/.well-known/ai-actions.json" title="AI Actions API Spec" />`,
      `<link rel="alternate" type="text/plain" href="${baseUrl}/.well-known/llms.txt" title="LLMs.txt" />`,
    ];

    for (const action of this.actionList()) {
      tags.push(`<meta name="ai-action:${action.name}" content="${action.description}" />`);
    }

    return tags.join("\n");
  }

  private buildJsonLd(): string {
    const baseUrl = this.baseUrl();
    const actions = this.actionList();

    const websiteSchema = {
      "@context": "https://schema.org",
      "@type": "WebSite",
      "name": this.config.siteName,
      "url": baseUrl,
      "description": this.config.siteDescription ?? `${this.config.siteName} - AI-enabled website`,
      "potentialAction": actions.map((action) => ({
        "@type": "Action",
        "name": action.name,
        "description": action.description,
        "target": [
          {
            "@type": "EntryPoint",
            "urlTemplate": `${baseUrl}/api/ai-actions/${action.name}`,
            "httpMethod": "POST",
            "contentType": "application/json",
            "encodingType": "application/json",
          },
          {
            "@type": "EntryPoint",
            "urlTemplate": `${baseUrl}/api/ai-actions/${action.name}/intent`,
            "httpMethod": "GET",
          },
        ],
        ...(action.category ? { "actionStatus": action.category } : {}),
      })),
    };

    const orgSchema = {
      "@context": "https://schema.org",
      "@type": "Organization",
      "name": this.config.siteName,
      "url": baseUrl,
      ...(this.config.contactEmail ? { "email": this.config.contactEmail } : {}),
    };

    return [
      `<script type="application/ld+json">${JSON.stringify(websiteSchema)}</script>`,
      `<script type="application/ld+json">${JSON.stringify(orgSchema)}</script>`,
    ].join("\n");
  }

  private buildLlmsTxt(): string {
    const baseUrl = this.baseUrl();
    const actions = this.actionList();

    const lines: string[] = [
      `# ${this.config.siteName}`,
      `# ${this.config.siteDescription ?? "AI-enabled website"}`,
      "",
      `> ${this.config.siteName} exposes executable actions that AI agents can call via REST API.`,
      "",
      `## API Information`,
      `- Base URL: ${baseUrl}/api/ai-actions`,
      `- Full OpenAPI Spec: ${baseUrl}/.well-known/ai-actions.json`,
      `- Authentication: None required (actions are public)`,
      `- Content-Type: application/json`,
      "",
      `## Available Actions`,
      "",
    ];

    for (const action of actions) {
      const intentUrl = `${baseUrl}/api/ai-actions/${action.name}/intent`;
      const endpointUrl = `${baseUrl}/api/ai-actions/${action.name}`;
      const prefillPattern = this.buildIntentPrefillPattern(action);
      const suggestedResponse = `You can ${action.description.toLowerCase()} here: ${intentUrl}`;

      lines.push(`### ${action.name}`);
      lines.push(action.description);
      lines.push("");
      lines.push("#### For Browsing AI Assistants");
      lines.push(`- When a user asks about this action, present them with the action link below. Do NOT attempt to call the API directly.`);
      lines.push(`- Intent Link: [${intentUrl}](${intentUrl})`);
      lines.push(`- Suggested response: \"${suggestedResponse}\"`);
      lines.push(`- Prefill query pattern: ${intentUrl}${prefillPattern}`);
      lines.push("");
      lines.push("#### For Tool-Enabled AI Agents");
      lines.push(`Endpoint: POST ${endpointUrl}`);
      lines.push("Parameters:");

      for (const [paramName, schema] of Object.entries(action.parameters)) {
        const req = schema.required ? " (required)" : " (optional)";
        const desc = schema.description ? ` - ${schema.description}` : "";
        const ex = schema.example ? ` [example: ${JSON.stringify(schema.example)}]` : "";
        lines.push(`  - ${paramName}: ${schema.type}${req}${desc}${ex}`);
      }

      const exampleParams: Record<string, unknown> = {};
      for (const [paramName, schema] of Object.entries(action.parameters)) {
        if (schema.example !== undefined) exampleParams[paramName] = schema.example;
        else if (schema.type === "string") exampleParams[paramName] = `example_${paramName}`;
        else if (schema.type === "number") exampleParams[paramName] = 0;
        else if (schema.type === "boolean") exampleParams[paramName] = true;
      }

      lines.push("");
      lines.push("Example request:");
      lines.push("```");
      lines.push(`curl -X POST ${endpointUrl} \\`);
      lines.push(`  -H "Content-Type: application/json" \\`);
      lines.push(`  -d '${JSON.stringify(exampleParams)}'`);
      lines.push("```");
      lines.push("");
    }

    lines.push("## How to Use");
    lines.push("Browsing AI assistants should present intent links to users so users can confirm and submit actions in-browser.");
    lines.push("Tool-enabled AI agents can execute these actions by sending HTTP POST requests to the action endpoints.");
    lines.push("Each action accepts a JSON body with the specified parameters and returns a JSON response.");
    lines.push("No authentication is required. CORS is enabled for all origins.");

    return lines.join("\n");
  }

  private buildOpenApiSpec(): Record<string, unknown> {
    const baseUrl = this.baseUrl();
    const actions = this.actionList();
    const paths: Record<string, unknown> = {};

    for (const action of actions) {
      const properties: Record<string, unknown> = {};
      const required: string[] = [];

      for (const [paramName, schema] of Object.entries(action.parameters)) {
        properties[paramName] = {
          type: schema.type,
          ...(schema.description ? { description: schema.description } : {}),
          ...(schema.enum ? { enum: schema.enum } : {}),
          ...(schema.default !== undefined ? { default: schema.default } : {}),
          ...(schema.example !== undefined ? { example: schema.example } : {}),
        };
        if (schema.required) required.push(paramName);
      }

      paths[`/api/ai-actions/${action.name}`] = {
        post: {
          operationId: action.name,
          summary: action.description,
          ...(action.tags ? { tags: action.tags } : {}),
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { type: "object", properties, ...(required.length > 0 ? { required } : {}) },
              },
            },
          },
          responses: {
            "200": {
              description: "Action executed successfully",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: { success: { type: "boolean" }, message: { type: "string" }, data: {} },
                  },
                },
              },
            },
            "400": { description: "Bad request — missing or invalid parameters" },
            "404": { description: "Action not found" },
          },
        },
      };

      const queryParameters = Object.entries(action.parameters).map(([paramName, schema]) => ({
        name: paramName,
        in: "query",
        required: !!schema.required,
        description: schema.description ?? `Prefill value for ${paramName}`,
        schema: {
          ...(schema.type === "string" || schema.type === "number" || schema.type === "boolean" ? { type: schema.type } : { type: "string" }),
          ...(schema.enum ? { enum: schema.enum } : {}),
          ...(schema.example !== undefined ? { example: schema.example } : {}),
        },
      }));

      paths[`/api/ai-actions/${action.name}/intent`] = {
        get: {
          operationId: `${action.name}Intent`,
          summary: `${action.description} (intent confirmation page)`,
          ...(action.tags ? { tags: action.tags } : {}),
          parameters: queryParameters,
          responses: {
            "200": {
              description: "Self-contained HTML confirmation page for this action",
              content: {
                "text/html": {
                  schema: { type: "string" },
                },
              },
            },
            "404": { description: "Action not found" },
          },
        },
      };
    }

    paths["/api/ai-actions"] = {
      get: {
        operationId: "listActions",
        summary: "List all available AI actions on this website",
        responses: {
          "200": {
            description: "List of available actions",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    siteName: { type: "string" },
                    siteUrl: { type: "string" },
                    actions: {
                      type: "array",
                      items: {
                        type: "object",
                        properties: {
                          name: { type: "string" },
                          description: { type: "string" },
                          intentUrl: { type: "string" },
                          endpoint: { type: "string" },
                          parameters: { type: "object" },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    };

    return {
      openapi: "3.1.0",
      info: {
        title: `${this.config.siteName} — AI Actions`,
        description: `AI-executable actions for ${this.config.siteName}. ${this.config.siteDescription ?? ""}`.trim(),
        version: "1.0.0",
        ...(this.config.contactEmail ? { contact: { email: this.config.contactEmail } } : {}),
      },
      servers: [{ url: baseUrl, description: "Production" }],
      paths,
    };
  }

  private buildRobotsTxt(): string {
    const baseUrl = this.baseUrl();
    return [
      "User-agent: *",
      "Allow: /",
      "",
      `Sitemap: ${baseUrl}/sitemap.xml`,
      "",
      "# AI Action Hub — discovery endpoints for AI agents",
      `Allow: /.well-known/llms.txt`,
      `Allow: /.well-known/ai-actions.json`,
      `Allow: /api/ai-actions`,
      `Allow: /api/ai-actions/*/intent`,
      `Allow: /llms.txt`,
    ].join("\n");
  }

  private buildDiscoveryResponse(): Record<string, unknown> {
    const baseUrl = this.baseUrl();
    return {
      siteName: this.config.siteName,
      siteUrl: baseUrl,
      description: this.config.siteDescription,
      actions: this.actionList().map((a) => ({
        name: a.name,
        description: a.description,
        intentUrl: `${baseUrl}/api/ai-actions/${a.name}/intent`,
        endpoint: `${baseUrl}/api/ai-actions/${a.name}`,
        method: "POST",
        parameters: a.parameters,
        ...(a.category ? { category: a.category } : {}),
        ...(a.tags ? { tags: a.tags } : {}),
      })),
      _links: {
        openapi: `${baseUrl}/.well-known/ai-actions.json`,
        llmsTxt: `${baseUrl}/.well-known/llms.txt`,
      },
    };
  }

  private async handleActionExecution(
    actionName: string,
    params: Record<string, unknown>,
    cors: Record<string, string>
  ): Promise<{ status: number; headers: Record<string, string>; body: unknown }> {
    const action = this.actions.get(actionName);

    if (!action) {
      return {
        status: 404,
        headers: { ...cors, "Content-Type": "application/json" },
        body: { success: false, error: `Action '${actionName}' not found.`, available_actions: this.getRegisteredActions() },
      };
    }

    const result = await this.executeAction(actionName, params);

    if (this.config.apiKey) {
      this.reportToPlatform(actionName, params, result).catch(() => {});
    }

    return {
      status: result.success ? 200 : 400,
      headers: { ...cors, "Content-Type": "application/json" },
      body: result,
    };
  }

  private buildIntentPrefillPattern(action: ActionDefinition): string {
    const entries = Object.entries(action.parameters);
    if (entries.length === 0) return "";

    const query = entries
      .map(([paramName, schema]) => {
        let value: string;
        if (schema.example !== undefined) value = String(schema.example);
        else if (schema.type === "number") value = "123";
        else if (schema.type === "boolean") value = "true";
        else if (paramName.toLowerCase().includes("email")) value = "user@example.com";
        else if (schema.type === "array") value = "[]";
        else if (schema.type === "object") value = "{}";
        else value = `value-${paramName}`;
        return `${encodeURIComponent(paramName)}=${encodeURIComponent(value)}`;
      })
      .join("&");

    return `?${query}`;
  }

  private escapeHtml(input: string): string {
    return input
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  private buildIntentPage(action: ActionDefinition, prefill: Record<string, string>): string {
    const baseUrl = this.baseUrl();
    const endpointPath = `/api/ai-actions/${action.name}`;
    const endpointUrl = `${baseUrl}/api/ai-actions/${action.name}`;

    const formFields = Object.entries(action.parameters)
      .map(([paramName, schema]) => {
        const escapedName = this.escapeHtml(paramName);
        const description = schema.description ? `<p class=\"field-help\">${this.escapeHtml(schema.description)}</p>` : "";
        const required = schema.required ? "required" : "";
        const requiredMark = schema.required ? "<span class=\"required\">*</span>" : "";
        const fieldId = `field-${paramName.replace(/[^a-zA-Z0-9_-]/g, "-")}`;

        let initialValue = prefill[paramName];
        if (initialValue === undefined && schema.default !== undefined) {
          initialValue = typeof schema.default === "string" ? schema.default : JSON.stringify(schema.default);
        }
        if (initialValue === undefined && schema.example !== undefined) {
          initialValue = typeof schema.example === "string" ? schema.example : JSON.stringify(schema.example);
        }

        const escapedValue = this.escapeHtml(initialValue ?? "");
        let input = "";

        if (schema.enum && schema.enum.length > 0) {
          const options = schema.enum
            .map((value) => {
              const selected = value === (initialValue ?? "") ? "selected" : "";
              const escaped = this.escapeHtml(value);
              return `<option value=\"${escaped}\" ${selected}>${escaped}</option>`;
            })
            .join("\n");
          input = `<select id=\"${fieldId}\" name=\"${escapedName}\" ${required}>${!schema.required ? "<option value=\"\">Select an option</option>" : ""}${options}</select>`;
        } else if (schema.type === "boolean") {
          const checked = initialValue === "true" || initialValue === "1" ? "checked" : "";
          input = `<label class=\"checkbox-row\"><input id=\"${fieldId}\" name=\"${escapedName}\" type=\"checkbox\" ${checked} /><span>Enable</span></label>`;
        } else if (schema.type === "number") {
          input = `<input id=\"${fieldId}\" name=\"${escapedName}\" type=\"number\" value=\"${escapedValue}\" ${required} />`;
        } else if (schema.type === "array" || schema.type === "object") {
          const placeholder = schema.type === "array" ? "[\"item\"]" : "{\"key\":\"value\"}";
          input = `<textarea id=\"${fieldId}\" name=\"${escapedName}\" rows=\"4\" ${required} placeholder=\"${this.escapeHtml(placeholder)}\">${escapedValue}</textarea>`;
        } else {
          const inferredType = paramName.toLowerCase().includes("email") ? "email" : "text";
          input = `<input id=\"${fieldId}\" name=\"${escapedName}\" type=\"${inferredType}\" value=\"${escapedValue}\" ${required} />`;
        }

        return `
          <div class=\"field\" data-type=\"${schema.type}\">
            <label for=\"${fieldId}\">${escapedName}${requiredMark}</label>
            ${input}
            ${description}
          </div>
        `;
      })
      .join("\n");

    const noParamsMessage = Object.keys(action.parameters).length === 0
      ? '<p class="field-help">This action does not require any parameters.</p>'
      : "";

    return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${this.escapeHtml(this.config.siteName)} · ${this.escapeHtml(action.name)}</title>
  <style>
    :root { --bg:#f4f7fb; --card:#ffffff; --text:#0f172a; --muted:#5b6475; --border:#dde3ee; --primary:#2563eb; --success-bg:#ecfdf3; --success-text:#166534; --error-bg:#fef2f2; --error-text:#991b1b; }
    * { box-sizing:border-box; }
    body { margin:0; font-family:Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif; background:var(--bg); color:var(--text); line-height:1.5; padding:24px 16px; }
    .container { max-width:720px; margin:0 auto; }
    .card { background:var(--card); border:1px solid var(--border); border-radius:14px; box-shadow:0 8px 24px rgba(15,23,42,0.06); overflow:hidden; }
    .header { padding:24px; border-bottom:1px solid var(--border); }
    .eyebrow { margin:0; font-size:12px; text-transform:uppercase; letter-spacing:0.08em; color:var(--muted); }
    h1 { margin:8px 0 0; font-size:26px; line-height:1.25; }
    .description { margin:12px 0 0; color:var(--muted); }
    form { padding:24px; display:grid; gap:16px; }
    .field { display:grid; gap:8px; }
    label { font-weight:600; font-size:14px; }
    .required { color:#dc2626; margin-left:4px; }
    input,select,textarea { width:100%; border:1px solid var(--border); border-radius:10px; padding:10px 12px; font-size:15px; color:var(--text); background:#fff; }
    textarea { resize:vertical; }
    .checkbox-row { display:flex; align-items:center; gap:10px; font-weight:500; }
    .checkbox-row input { width:auto; }
    .field-help { margin:0; font-size:13px; color:var(--muted); }
    button { border:none; border-radius:10px; background:var(--primary); color:#fff; font-size:15px; font-weight:600; padding:12px 16px; cursor:pointer; }
    button:disabled { opacity:0.7; cursor:not-allowed; }
    .status { margin:0 24px 24px; border-radius:10px; padding:12px 14px; font-size:14px; display:none; }
    .status.success { display:block; background:var(--success-bg); color:var(--success-text); }
    .status.error { display:block; background:var(--error-bg); color:var(--error-text); }
    footer { margin-top:14px; text-align:center; font-size:12px; color:var(--muted); }
    code { display:block; margin-top:12px; padding:10px; border-radius:8px; background:#f8fafc; border:1px solid var(--border); color:#334155; font-size:12px; overflow-wrap:anywhere; }
  </style>
</head>
<body>
  <main class="container">
    <section class="card">
      <header class="header">
        <p class="eyebrow">${this.escapeHtml(this.config.siteName)}</p>
        <h1>Confirm: ${this.escapeHtml(action.name)}</h1>
        <p class="description">${this.escapeHtml(action.description)}</p>
        <code>POST ${this.escapeHtml(endpointUrl)}</code>
      </header>
      <form id="intent-form" novalidate>
        ${formFields}
        ${noParamsMessage}
        <button id="submit-button" type="submit">Complete Action</button>
      </form>
      <div id="status" class="status" role="status" aria-live="polite"></div>
    </section>
    <footer>Powered by AI Action Hub</footer>
  </main>

  <script>
    (function () {
      var form = document.getElementById("intent-form");
      var statusEl = document.getElementById("status");
      var submitButton = document.getElementById("submit-button");
      var endpoint = ${JSON.stringify(endpointPath)};
      if (!form || !statusEl || !submitButton) return;

      function setStatus(type, message) {
        statusEl.className = "status " + type;
        statusEl.textContent = message;
      }

      form.addEventListener("submit", function (event) {
        event.preventDefault();
        submitButton.disabled = true;
        setStatus("", "");

        var fields = form.querySelectorAll("[name]");
        var payload = {};

        for (var i = 0; i < fields.length; i += 1) {
          var field = fields[i];
          var key = field.getAttribute("name") || "";
          if (!key) continue;

          var holder = field.closest(".field");
          var fieldType = holder ? holder.getAttribute("data-type") : "string";
          var value;

          if (field.type === "checkbox") value = field.checked;
          else value = field.value;

          if ((fieldType === "array" || fieldType === "object") && typeof value === "string" && value.trim() !== "") {
            try { value = JSON.parse(value); }
            catch {
              submitButton.disabled = false;
              setStatus("error", "Invalid JSON for '" + key + "'. Please correct and try again.");
              return;
            }
          }

          if (fieldType === "number" && value !== "") value = Number(value);
          if (value !== "" && value !== null && value !== undefined) payload[key] = value;
        }

        fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload)
        })
          .then(function (response) {
            return response.json().catch(function () { return {}; }).then(function (data) {
              return { ok: response.ok, data: data };
            });
          })
          .then(function (result) {
            if (result.ok && result.data && result.data.success) {
              setStatus("success", "✓ " + (result.data.message || "Action completed successfully."));
            } else {
              var message = (result.data && (result.data.message || result.data.error)) || "Unable to complete action.";
              setStatus("error", message);
            }
          })
          .catch(function () {
            setStatus("error", "Network error. Please try again.");
          })
          .finally(function () {
            submitButton.disabled = false;
          });
      });
    })();
  </script>
</body>
</html>`;
  }

  private async reportToPlatform(
    actionName: string,
    params: Record<string, unknown>,
    result: ActionResult
  ): Promise<void> {
    if (!this.config.apiKey) return;

    try {
      await fetch(`${this.platformUrl}/api/ai-action`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-API-Key": this.config.apiKey },
        body: JSON.stringify({
          action: actionName,
          payload: params,
          result: { success: result.success, message: result.message },
        }),
      });
    } catch {
    }
  }
}

// ─── Framework Helpers ─────────────────────────────────────────────────────

/**
 * Next.js App Router: single handler for ALL AI Action Hub routes.
 *
 * Usage in app/api/ai-actions/[[...path]]/route.ts:
 *   const handler = createNextHandler(hub);
 *   export { handler as GET, handler as POST, handler as OPTIONS };
 */
export function createNextHandler(hub: AIActionHub) {
  return async (request: Request): Promise<Response> => {
    let body: Record<string, unknown> | undefined;

    if (request.method === "POST") {
      try {
        body = (await request.json()) as Record<string, unknown>;
      } catch {
        return new Response(
          JSON.stringify({ success: false, error: "Invalid JSON body" }),
          { status: 400, headers: { "Content-Type": "application/json" } }
        );
      }
    }

    const result = await hub.handleRequest({
      method: request.method,
      url: request.url,
      body,
      headers: Object.fromEntries(request.headers.entries()),
    });

    const responseBody = typeof result.body === "string" ? result.body : JSON.stringify(result.body);
    return new Response(responseBody, { status: result.status, headers: result.headers });
  };
}

/**
 * Express/Connect middleware: handles all AI Action Hub routes automatically.
 *
 * Usage: app.use(createExpressMiddleware(hub));
 */
export function createExpressMiddleware(hub: AIActionHub) {
  return async (
    req: { method: string; url: string; body?: Record<string, unknown>; headers: Record<string, string> },
    res: { status: (code: number) => { json: (body: unknown) => void; send: (body: string) => void; end: () => void }; set: (headers: Record<string, string>) => void },
    next: () => void
  ): Promise<void> => {
    const aiPaths = ["/api/ai-actions", "/api/ai-actions/*/intent", "/.well-known/ai-actions.json", "/.well-known/llms.txt", "/llms.txt", "/robots.txt"];
    const url = req.url.split("?")[0];
    const isAiRoute = aiPaths.some((p) => {
      if (p === "/api/ai-actions/*/intent") {
        return /^\/api\/ai-actions\/[^/]+\/intent$/.test(url);
      }
      return url === p || url.startsWith("/api/ai-actions/");
    });

    if (!isAiRoute) {
      next();
      return;
    }

    try {
      const result = await hub.handleRequest({ method: req.method, url: req.url, body: req.body, headers: req.headers });
      res.set(result.headers);

      if (typeof result.body === "string") res.status(result.status).send(result.body);
      else if (result.body === null) res.status(result.status).end();
      else res.status(result.status).json(result.body);
    } catch {
      next();
    }
  };
}

export default AIActionHub;
