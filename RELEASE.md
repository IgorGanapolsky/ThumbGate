# Release Checklist

1. `npm test`
2. Verify `openapi/openapi.yaml` and `adapters/chatgpt/openapi.yaml` are aligned
3. Verify adapter configs load
4. Verify budget status: `npm run budget:status`
5. (Optional) Generate diagrams: `npm run diagrams:paperbanana`
6. Update `CHANGELOG.md`
7. Tag release
