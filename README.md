# Forge Search Docs Plugin

OpenSCAD documentation search plugin for the [Forge/Fabrikator](https://github.com/unforkableco/fabrikator) platform.

## Overview

This plugin provides documentation search capabilities for OpenSCAD and its libraries (BOSL2, threads-scad, etc.) using OpenAI's Assistants API with Vector Store file search.

## Features

- **Vector Store Search**: Uses OpenAI's file search to query indexed documentation
- **Structured Results**: Returns structured JSON with signature, parameters, examples, and notes
- **Result Caching**: Caches search results for 30 minutes to reduce API calls
- **Multi-Library Support**: Searches OpenSCAD core docs plus BOSL2, threads-scad, and more

## How It Works

1. **Query Received**: Receives a documentation search query from the agent
2. **Assistant Creation**: Creates/reuses an OpenAI Assistant with file search capability
3. **Vector Search**: Searches the indexed documentation using OpenAI's vector store
4. **Structured Response**: Returns structured documentation with signature, parameters, examples

## Installation

### As a Docker Container (Recommended)

```bash
docker build -t forge-search-docs .
docker run -p 8080:8080 \
  -e OPENAI_API_KEY=your-key \
  -e OPENSCAD_VECTOR_STORE_ID=vs-xxx \
  forge-search-docs
```

### Local Development

```bash
npm install
npm run build
npm start
```

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `PORT` | No | `8080` | Server port |
| `OPENAI_API_KEY` | Yes | - | OpenAI API key for Assistants API |
| `OPENSCAD_VECTOR_STORE_ID` | Yes | - | Vector Store ID containing indexed documentation |

## Setting Up the Vector Store

Before using this plugin, you need to create a Vector Store in OpenAI with your documentation:

1. Go to [OpenAI Platform](https://platform.openai.com/storage/vector_stores)
2. Create a new Vector Store
3. Upload your documentation files (Markdown, PDF, etc.)
4. Copy the Vector Store ID (starts with `vs_`)
5. Set the `OPENSCAD_VECTOR_STORE_ID` environment variable

### Recommended Documentation to Index

- OpenSCAD Language Reference
- BOSL2 Library Documentation
- threads-scad Documentation
- MCAD Documentation
- Your custom library documentation

## API Endpoints

### `GET /health`

Health check endpoint.

**Response:**
```json
{
  "status": "healthy",
  "service": "search-docs-plugin",
  "timestamp": "2024-01-01T00:00:00.000Z"
}
```

### `POST /search_docs`

Search the documentation.

**Request Body:**
```json
{
  "context": {
    "sessionId": "abc123",
    "step": 1
  },
  "args": {
    "query": "BOSL2 attach function syntax",
    "context": "I'm trying to attach a cylinder to the top of a cube"
  }
}
```

**Response:**
```json
{
  "ok": true,
  "tokensUsed": 1500,
  "artifacts": [],
  "result": {
    "query": "BOSL2 attach function syntax",
    "context": "I'm trying to attach a cylinder to the top of a cube",
    "answer": {
      "signature": "attach(anchor, [orient], [spin]) { ... }",
      "parameters": "anchor: The anchor point to attach to (e.g., TOP, BOTTOM, LEFT)...",
      "examples": "cuboid([20,20,10])\n  attach(TOP) cyl(d=5, h=10);",
      "notes": "The attach() module positions children relative to the parent's anchor point.",
      "sources": ["BOSL2/attachments.scad"]
    }
  }
}
```

## Plugin Configuration (plugin.yaml)

```yaml
plugin:
  name: OpenSCAD Documentation Search
  slug: openscad-docs
  version: 1.0.0
  author: Fabrikator Team
  description: Search OpenSCAD and BOSL2 documentation

requirements:
  apiKeys:
    - name: OPENAI_API_KEY
      required: true
      fallback: platform

capabilities:
  tools:
    - name: search_docs
      description: Search OpenSCAD documentation
      parameters:
        type: object
        properties:
          query:
            type: string
            description: Search query
        required:
          - query
      execution:
        type: docker
        config:
          image: ghcr.io/unforkableco/forge-plugins-searchdocs:latest
          port: 8080
          endpoint: /search_docs

pricing:
  model: free
```

## Development

### Project Structure

```
├── src/
│   └── index.ts          # Main Express server
├── Dockerfile            # Container build
├── package.json
├── tsconfig.json
└── README.md
```

### Building

```bash
npm run build
```

### Testing Locally

```bash
# Start the server
npm run dev

# Test health endpoint
curl http://localhost:8080/health

# Test search
curl -X POST http://localhost:8080/search_docs \
  -H "Content-Type: application/json" \
  -d '{"context":{"sessionId":"test"},"args":{"query":"BOSL2 cuboid"}}'
```

## Caching

The plugin caches search results for 30 minutes to reduce API costs. Cache keys are based on the lowercased query and optional context.

To modify cache TTL, update `CACHE_TTL_MS` in `src/index.ts`.

## License

MIT License - see [LICENSE](LICENSE) for details.

## Contributing

Contributions are welcome! Please open an issue or submit a pull request.

## Related Plugins

- [forge-plugins-vision](https://github.com/unforkableco/forge-plugins-vision) - AI-powered CAD geometry validation

