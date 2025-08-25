Backend: Node.js + TypeScript

DB: PostgreSQL (Railway)

Background jobs: BullMQ + Redis
LLM gateway: Vercel AI SDK . [AI SDK](https://ai-sdk.dev/)

Email & inbound: Brevo (inbound parse webhooks + transactional send). [developers.brevo.com](https://developers.brevo.com/docs/inbound-parse-webhooks) [Brevo Help](https://help.brevo.com/hc/en-us/articles/24645462216466-Create-inbound-webhooks-to-receive-real-time-data-from-another-app-in-Brevo)

Document versioning: Google Docs + Drive Revisions API - We need to set important revisions to be non purgeable to avoid Google auto removing them [Google for Developers](https://developers.google.com/workspace/drive/api/guides/manage-revisions)

Task manager: Asana API + webhooks.
