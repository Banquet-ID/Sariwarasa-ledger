# Image Integration Testing Rules (AI extraction endpoint)

Endpoint: POST /api/ai/extract (multipart form field `file`), owner-only, returns {"draft": transaction, "extraction": {...}}.

Rules for test images:
- Always use real images; accepted formats: JPEG, PNG, WEBP only.
- Do NOT use SVG, BMP, HEIC. Do NOT upload blank/solid-color images.
- Every image must contain real visual features (receipt text, objects, textures).
- If image is not PNG/JPEG/WEBP, transcode to PNG or JPEG first, and re-detect MIME after transformation.
- Animated images: extract first frame only.
- Resize very large images before upload (max 10MB enforced by backend).
- The endpoint calls OpenAI gpt-5.6-terra via emergentintegrations; expect 5-30s response time.
- Success: response 200 with draft.status == "draft"; draft then appears in GET /api/transactions?status=draft.
