# WordPress Article Generation API

## Environment Variables

Add these to your `.env` file:

```bash
# WordPress Credentials (required for posting articles)
WP_USERNAME=your_wordpress_username
WP_PASSWORD=your_wordpress_application_password
```

**Note:** For WordPress.com or sites with two-factor authentication, you need to create an **Application Password**:
1. Go to your WordPress admin → Users → Profile
2. Scroll to "Application Passwords"
3. Create a new application password
4. Use that password in your `.env` file

## API Endpoints

### 1. Generate Article (without posting)

```bash
POST /generate-article
Content-Type: application/json

{
  "keywords": ["climate change", "renewable energy"],
  "category": "tiede",           // optional
  "tone": "informative",          // optional: informative, conversational, formal, casual
  "length": "medium"              // optional: short, medium, long
}
```

**Response:**
```json
{
  "article": {
    "title": "The Future of Renewable Energy in Climate Action",
    "content": "...",
    "excerpt": "...",
    "sources": [
      { "title": "...", "url": "..." }
    ]
  }
}
```

### 2. Post Article to WordPress

```bash
POST /post-to-wordpress
Content-Type: application/json

{
  "article": {
    "title": "Article Title",
    "content": "Article content...",
    "excerpt": "Brief excerpt...",
    "sources": [...]
  },
  "status": "draft"  // or "publish"
}
```

**Response:**
```json
{
  "posted": {
    "id": 123,
    "url": "https://tuppu.fi/article-slug",
    "status": "draft",
    "title": "Article Title"
  }
}
```

### 3. Generate and Post (one step)

```bash
POST /generate-and-post
Content-Type: application/json

{
  "keywords": ["technology", "AI"],
  "category": "tiede",
  "tone": "conversational",
  "length": "medium",
  "status": "draft"  // or "publish"
}
```

**Response:**
```json
{
  "article": { ... },
  "post": {
    "id": 123,
    "url": "https://tuppu.fi/article-slug",
    "status": "draft"
  }
}
```

## Examples

### Using cURL

```bash
# Generate an article
curl -X POST http://localhost:3000/generate-article \
  -H "Content-Type: application/json" \
  -d '{
    "keywords": ["sustainable living", "eco-friendly"],
    "category": "luonto",
    "tone": "conversational",
    "length": "medium"
  }'

# Generate and post directly
curl -X POST http://localhost:3000/generate-and-post \
  -H "Content-Type: application/json" \
  -d '{
    "keywords": ["Finnish politics", "democracy"],
    "category": "politiikka",
    "tone": "formal",
    "length": "long",
    "status": "draft"
  }'
```

### Using the Web UI

1. Open http://localhost:3000 in your browser
2. Scroll to the "Generate AI Article" section
3. Enter keywords (comma-separated)
4. Choose category, tone, and length
5. Click "Generate Article"
6. Review the generated content
7. Click "Post to WordPress (Draft)" to publish

## How It Works

1. **Keyword Analysis**: The system searches your indexed content for relevant articles matching the keywords
2. **Context Gathering**: Top matching articles provide context and source material
3. **AI Generation**: The LLM creates original content based on the context, maintaining the specified tone and length
4. **Source Attribution**: Generated articles include links to source articles
5. **WordPress Integration**: Articles are posted via WordPress REST API with proper formatting

## Notes

- Articles are generated based on your **indexed content**, so run `/reindex` first
- Generation takes 30-90 seconds depending on article length
- Generated content is original but inspired by existing articles
- All articles include source attribution
- Default status is "draft" for review before publishing
