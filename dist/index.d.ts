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
export declare class AIActionHub {
    private readonly config;
    private readonly actions;
    private readonly platformUrl;
    constructor(config: AIActionHubConfig);
    registerAction(definition: ActionDefinition): void;
    unregisterAction(name: string): boolean;
    getRegisteredActions(): string[];
    executeAction(name: string, params: Record<string, unknown>): Promise<ActionResult>;
    /**
     * Returns all <head> tags (meta + JSON-LD) as a single HTML string.
     * Usage: <head dangerouslySetInnerHTML={{ __html: hub.headTags() }} />
     */
    headTags(): string;
    /**
     * Returns a visible HTML block that AI scrapers will read when visiting the page.
     *
     * IMPORTANT: This block uses small, muted but VISIBLE text. AI scrapers
     * (Gemini, ChatGPT, etc.) aggressively strip CSS-hidden content
     * (display:none, position:absolute off-screen, visibility:hidden).
     * Visible DOM text is the only reliable discovery mechanism.
     */
    htmlBlock(): string;
    /**
     * Single handler that serves ALL AI Action Hub routes:
     * - GET  /api/ai-actions              → list actions
     * - POST /api/ai-actions/:name        → execute action
     * - GET  /.well-known/ai-actions.json → OpenAPI spec
     * - GET  /.well-known/llms.txt        → llms.txt manifest
     * - GET  /llms.txt                    → llms.txt alias
     * - GET  /robots.txt                  → robots.txt with AI hints
     */
    handleRequest(request: {
        method: string;
        url: string;
        body?: Record<string, unknown>;
        headers?: Record<string, string>;
    }): Promise<{
        status: number;
        headers: Record<string, string>;
        body: unknown;
    }>;
    getManifest(): Array<{
        name: string;
        description: string;
        parameters: Record<string, ActionParameterSchema>;
        category?: string;
        tags?: string[];
    }>;
    private baseUrl;
    private actionList;
    private buildMetaTags;
    private buildJsonLd;
    private buildLlmsTxt;
    private buildOpenApiSpec;
    private buildRobotsTxt;
    private buildDiscoveryResponse;
    private handleActionExecution;
    private buildIntentPrefillPattern;
    private escapeHtml;
    private buildIntentPage;
    private reportToPlatform;
}
/**
 * Next.js App Router: single handler for ALL AI Action Hub routes.
 *
 * Usage in app/api/ai-actions/[[...path]]/route.ts:
 *   const handler = createNextHandler(hub);
 *   export { handler as GET, handler as POST, handler as OPTIONS };
 */
export declare function createNextHandler(hub: AIActionHub): (request: Request) => Promise<Response>;
/**
 * Express/Connect middleware: handles all AI Action Hub routes automatically.
 *
 * Usage: app.use(createExpressMiddleware(hub));
 */
export declare function createExpressMiddleware(hub: AIActionHub): (req: {
    method: string;
    url: string;
    body?: Record<string, unknown>;
    headers: Record<string, string>;
}, res: {
    status: (code: number) => {
        json: (body: unknown) => void;
        send: (body: string) => void;
        end: () => void;
    };
    set: (headers: Record<string, string>) => void;
}, next: () => void) => Promise<void>;
export default AIActionHub;
//# sourceMappingURL=index.d.ts.map