# AI Action Hub

Let AI agents (ChatGPT, Gemini, Claude, Perplexity...) execute actions on your website — directly from the chat.

Your users ask the AI to "book a demo" or "join the waitlist", and the AI does it on your site. The SDK provides a dual-mode architecture to support both browsing LLMs and tool-enabled agents.

## How It Works

1. You install the SDK and declare what actions your site supports
2. The SDK makes those actions discoverable by AI agents (meta tags, JSON-LD, llms.txt, OpenAPI)
3. When an AI visits your page, it discovers your actions and can trigger them via **Intent Links** (for browsing LLMs) or the **POST API** (for tool-enabled agents)

The SDK handles everything: discovery, routing, execution, CORS, analytics.

## Quick Start

### Step 1: Install

```bash
npm install ai-action-hub
```

### Step 2: Create your hub and declare actions

Create a file (e.g. `lib/ai-hub.ts`):

```typescript
import { AIActionHub } from 'ai-action-hub';

export const hub = new AIActionHub({
  siteUrl: 'https://your-site.com',
  siteName: 'Your Site Name',
  siteDescription: 'Short description of what your site does',
  apiKey: 'your_api_key_from_ai_action_hub_dashboard', // get it at https://ai-action-hub.com
});

hub.registerAction({
  name: 'join-waitlist',
  description: 'Join the waitlist to get early access',
  parameters: {
    email: { type: 'string', required: true, description: 'User email address', example: 'john@example.com' },
  },
  handler: async (params) => {
    await db.waitlist.create({ data: { email: params.email as string } });
    return { success: true, message: 'Added to waitlist!' };
  },
});

hub.registerAction({
  name: 'book-demo',
  description: 'Book a product demo with the team',
  parameters: {
    email: { type: 'string', required: true, description: 'Contact email' },
    date: { type: 'string', required: true, description: 'Preferred date (ISO 8601)', example: '2026-04-01T14:00:00Z' },
  },
  handler: async (params) => {
    // your booking logic here
    return { success: true, message: 'Demo booked!' };
  },
});
```

### Step 3: Wire it up (one route + one layout change)

**API Route** — create `app/api/ai-actions/[[...path]]/route.ts`:

```typescript
import { createNextHandler } from 'ai-action-hub';
import { hub } from '@/lib/ai-hub';

const handler = createNextHandler(hub);
export { handler as GET, handler as POST, handler as OPTIONS };
```

**Layout** — add two lines to your root layout:

```tsx
import { hub } from '@/lib/ai-hub';

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <div dangerouslySetInnerHTML={{ __html: hub.headTags() }} />
      </head>
      <body>
        {children}
        <div dangerouslySetInnerHTML={{ __html: hub.htmlBlock() }} />
      </body>
    </html>
  );
}
```

**That's it.** Your site is now AI-agent ready.

## What the SDK Does Automatically

Once wired up, the SDK serves all of these routes from the single catch-all handler:

| Route | What it does |
|-------|-------------|
| `GET /api/ai-actions` | Lists all available actions (JSON) with `intentUrl` per action |
| `POST /api/ai-actions/:name` | Executes an action (for tool-enabled agents) |
| `GET /api/ai-actions/:name/intent` | Serves an intent confirmation page (for browsing AI assistants) |
| `GET /.well-known/ai-actions.json` | Full OpenAPI 3.1 spec |
| `GET /.well-known/llms.txt` | llms.txt manifest |
| `GET /llms.txt` | llms.txt alias |
| `GET /robots.txt` | robots.txt with AI discovery hints |

It also injects into your HTML:
- **Meta tags** with `ai-instructions` that tell AI scrapers what actions are available
- **JSON-LD** structured data (Schema.org) for semantic discovery
- **Visible HTML block** at the bottom of the page with plain-text action descriptions. Intent links are shown prominently, while POST API details are in collapsed `<details>` blocks.

## Intent Links (for Browsing AI Assistants)

Vanilla LLMs like ChatGPT, Gemini, Claude, and Perplexity in browsing mode are read-only. They cannot execute POST requests directly. Intent links bridge this gap by providing a URL they can present to the user.

### How It Works
The SDK automatically generates a dedicated intent route for every action: `GET /api/ai-actions/:name/intent`. This route serves a self-contained, responsive HTML confirmation page.

- **Self-Contained**: The page includes inline CSS and JS for zero-dependency rendering.
- **Pre-filling**: Support for query parameters allows LLMs to pre-fill forms, e.g., `GET /api/ai-actions/join-waitlist/intent?email=user@example.com`.
- **Seamless Execution**: The page uses fetch-based submission so the user can confirm and execute the action without a page reload.

### Automatic Generation
The SDK includes these intent links in all discovery manifests, including `llms.txt`, the `htmlBlock()`, meta tags, and the primary discovery JSON response.

### Example Flow
1. User asks Perplexity to join a waitlist on your site.
2. Perplexity reads the page and finds the intent link.
3. Perplexity presents the intent link as a clickable URL to the user.
4. User clicks the link, sees the pre-filled form, and clicks confirm.
5. The action executes and the user receives immediate feedback.

## Express / Node.js

```typescript
import express from 'express';
import { AIActionHub, createExpressMiddleware } from 'ai-action-hub';

const hub = new AIActionHub({
  siteUrl: 'https://your-site.com',
  siteName: 'Your Site',
  apiKey: 'your_api_key',
});

hub.registerAction({ /* ... */ });

const app = express();
app.use(express.json());
app.use(createExpressMiddleware(hub));

app.listen(3000);
```

## API Key

Get your API key at [ai-action-hub.com](https://ai-action-hub.com). The API key enables:
- Analytics (see which AI agents call which actions)
- Action execution logs in the dashboard
- Rate limiting

The SDK works without an API key for development, but you won't get analytics.

## Configuration

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `siteUrl` | `string` | Yes | Your site's base URL (e.g. `https://example.com`) |
| `siteName` | `string` | Yes | Your site's display name |
| `siteDescription` | `string` | No | Short description — helps AI agents understand your site |
| `apiKey` | `string` | No | API key from [ai-action-hub.com](https://ai-action-hub.com) |
| `contactEmail` | `string` | No | Contact email (shown in OpenAPI spec) |

## Registering Actions

```typescript
hub.registerAction({
  name: 'action-slug',           // unique identifier
  description: 'What this does', // AI reads this to decide when to use it
  parameters: {
    email: {
      type: 'string',
      required: true,
      description: 'User email address',
      example: 'user@example.com',
    },
    plan: {
      type: 'string',
      enum: ['free', 'pro', 'enterprise'],
      default: 'free',
    },
  },
  handler: async (params) => {
    // Your logic — params are validated before this runs
    return { success: true, message: 'Done!' };
  },
  category: 'onboarding',        // optional
  tags: ['signup', 'waitlist'],   // optional
});
```

### Parameter Schema

| Field | Type | Description |
|-------|------|-------------|
| `type` | `'string' \| 'number' \| 'boolean' \| 'object' \| 'array'` | Parameter type |
| `required` | `boolean` | Is this parameter mandatory? |
| `description` | `string` | Description for the AI agent |
| `enum` | `string[]` | Allowed values |
| `default` | `unknown` | Default value |
| `example` | `unknown` | Example value (shown in manifests and docs) |

## API Reference

| Method | Description |
|--------|-------------|
| `registerAction(definition)` | Register a new action |
| `unregisterAction(name)` | Remove an action |
| `getRegisteredActions()` | List registered action names |
| `executeAction(name, params)` | Execute an action programmatically (bypassing HTTP) |
| `headTags()` | Get all `<head>` HTML (meta tags + JSON-LD) |
| `htmlBlock()` | Get the AI-readable HTML block for the page body (includes intent links) |
| `handleRequest(request)` | Low-level request handler for API and Intent routes |
| `getManifest()` | Get action definitions as JSON with intent URLs |

## How AI Discovery Works

The SDK supports two distinct interaction flows depending on the AI agent's capabilities.

### Flow 1: Browsing AI (Intent Link)
1. User asks Gemini or Perplexity: "Join the waitlist on example.com"
2. The AI visits the page, finds the action intent link, and presents it as a clickable link.
3. User clicks the link, confirms the pre-filled details, and submits.
4. The action executes and the AI is notified of the success.

### Flow 2: Tool-Enabled AI (POST API)
1. User asks a future agent with tool-calling capabilities to perform an action.
2. The agent discovers the action through `llms.txt` or JSON-LD.
3. The agent calls the POST endpoint directly: `POST https://example.com/api/ai-actions/join-waitlist`
4. Your handler runs, the user is added, and the agent confirms completion to the user.

## License

MIT
